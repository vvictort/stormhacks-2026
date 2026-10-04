import { newId, newLinkToken, nowIso } from "../shared/ids.ts";
import { redact } from "../shared/redact.ts";
import {
  COMPROMISING_SIGNALS,
  type Signal,
  type SimOutcome,
  type TextMessage,
  type TextScenario,
  type TextThread,
  type ThreadEndReason,
} from "../shared/types.ts";
import { textEvent, type EventSink } from "../sim/events.ts";
import type { SimStore } from "../sim/store.ts";
import { classifyReply } from "./classify.ts";
import { caughtUrl, renderScammerText } from "./links.ts";
import type { ScenarioProvider, TextTurnResult } from "./provider.ts";
import * as sse from "./sse.ts";

/** Rapid user replies within this window are answered together. */
const REPLY_DEBOUNCE_MS = 3000;

const union = (...lists: Signal[][]) => [...new Set(lists.flat())];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Human-ish "typing" time proportional to message length. */
const typingDelayMs = (text: string) =>
  Math.min(8000, Math.max(2000, 1500 + text.length * 35));

const userMessages = (t: TextThread) =>
  t.messages.filter((m) => m.from === "user");
/** User messages not yet passed to the provider. */
const unhandled = (t: TextThread) =>
  userMessages(t).slice(t.userMessagesHandled);

function textOutcome(t: TextThread, reason: ThreadEndReason): SimOutcome {
  if (t.signals.some((s) => COMPROMISING_SIGNALS.includes(s)))
    return "compromised";
  if (reason === "reported") return "reported";
  if (userMessages(t).length === 0) return "ignored";
  return "resisted";
}

export interface TextServiceOptions {
  /** The frontend origin; tracked links redirect to its "this was a simulation" page. */
  appOrigin: string;
  /** Nudge after this much silence. */
  followUpSec: number;
  /** End the thread after this much inactivity. */
  idleEndSec: number;
}

export class TextService {
  private turnTimers = new Map<string, NodeJS.Timeout>();
  private turnsInFlight = new Set<string>();
  private sweeping = false;
  private readonly store: SimStore;
  private readonly events: EventSink;
  private readonly provider: ScenarioProvider;
  private readonly options: TextServiceOptions;

  constructor(
    store: SimStore,
    events: EventSink,
    provider: ScenarioProvider,
    options: TextServiceOptions,
  ) {
    this.store = store;
    this.events = events;
    this.provider = provider;
    this.options = options;
  }

  async start(
    userId: string,
    scenario: TextScenario,
  ): Promise<{ thread: TextThread } | { conflict: TextThread }> {
    const existing = await this.store.findActiveThreadByUser(userId);
    if (existing) return { conflict: existing };

    const at = nowIso();
    const thread: TextThread = {
      id: newId("txt"),
      userId,
      scenario,
      status: "active",
      messages: [],
      signals: [],
      scammerTurns: 0,
      userMessagesHandled: 0,
      linkToken: scenario.linkDisplayUrl ? newLinkToken() : undefined,
      createdAt: at,
    };
    const opening: TextMessage = {
      id: newId("msg"),
      from: "scammer",
      at,
      ...renderScammerText(scenario.openingMessage, thread),
    };
    thread.messages.push(opening);
    if (opening.links) thread.linkFirstSentAt = at;

    // Another request (or process) started one since the check above: report that one instead.
    if (!(await this.store.createThread(thread)))
      return this.start(userId, scenario);
    await this.events.emit(
      textEvent("text.thread_started", thread, {
        senderLabel: scenario.senderLabel,
        difficulty: scenario.difficulty,
      }),
    );
    await this.events.emit(
      textEvent("text.message_sent", thread, {
        messageId: opening.id,
        body: opening.body,
        hasLink: !!opening.links,
        turn: 0,
      }),
    );
    return { thread };
  }

  get(threadId: string) {
    return this.store.getThread(threadId);
  }

  async reply(
    threadId: string,
    raw: string,
  ): Promise<TextMessage | "not_found" | "ended"> {
    const current = await this.store.getThread(threadId);
    if (!current) return "not_found";

    const now = Date.now();
    const lastScammer = current.messages.findLast((m) => m.from === "scammer");
    const preSignals = classifyReply(raw);
    const message: TextMessage = {
      id: newId("msg"),
      from: "user",
      body: redact(raw),
      at: new Date(now).toISOString(),
      latencyMs: lastScammer ? now - Date.parse(lastScammer.at) : undefined,
      signals: preSignals,
    };

    const { thread, result: accepted } = await this.store.updateThread(
      threadId,
      (t) => {
        if (t.status !== "active") return false;
        t.messages.push(message);
        delete t.followUpSentAt;
        return true;
      },
    );
    if (!accepted) return "ended";

    sse.publish(threadId, "message", message, message.id);
    await this.events.emit(
      textEvent("text.reply_received", thread, {
        messageId: message.id,
        body: message.body,
        latencyMs: message.latencyMs,
        preSignals,
      }),
    );
    this.scheduleTurn(threadId);
    return message;
  }

  async report(threadId: string): Promise<TextThread | "not_found" | "ended"> {
    if (!(await this.store.getThread(threadId))) return "not_found";
    const { thread, result: accepted } = await this.store.updateThread(
      threadId,
      (t) => {
        if (t.status !== "active") return false;
        t.signals = union(t.signals, ["reported"]);
        return true;
      },
    );
    if (!accepted) return "ended";
    await this.events.emit(textEvent("text.reported", thread));
    return (await this.end(threadId, "reported")) ?? thread;
  }

  /** Records a tracked-link tap and returns the URL to redirect to, or null for an unknown token. */
  async handleLinkClick(token: string): Promise<string | null> {
    const found = await this.store.findThreadByLinkToken(token);
    if (!found) return null;

    const now = Date.now();
    const { thread, result: click } = await this.store.updateThread(
      found.id,
      (t) => {
        if (t.firstClickAt) return null;
        const wasActive = t.status === "active";
        t.firstClickAt = new Date(now).toISOString();
        t.signals = union(t.signals, ["clicked_link"]);
        // A late tap after the thread ended still counts as falling for it.
        if (!wasActive) t.outcome = "compromised";
        return { wasActive };
      },
    );

    if (click) {
      const timeToClickMs = thread.linkFirstSentAt
        ? now - Date.parse(thread.linkFirstSentAt)
        : undefined;
      await this.events.emit(
        textEvent("link.clicked", thread, {
          timeToClickMs,
          afterEnd: !click.wasActive,
        }),
      );
      if (click.wasActive) await this.end(thread.id, "link_clicked");
    }
    return caughtUrl(this.options.appOrigin, thread.id);
  }

  /** Periodic pass: follow-up nudges, idle endings, and turns lost to a restart. */
  async sweep() {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      const now = Date.now();
      for (const t of await this.store.listActiveThreads()) {
        if (this.turnsInFlight.has(t.id) || this.turnTimers.has(t.id)) continue;
        const last = t.messages.at(-1)!;
        const idleMs = now - Date.parse(last.at);

        if (idleMs >= this.options.idleEndSec * 1000) {
          await this.end(t.id, "idle");
        } else if (unhandled(t).length > 0) {
          if (idleMs >= REPLY_DEBOUNCE_MS) void this.runTurn(t.id);
        } else if (
          last.from === "scammer" &&
          !t.followUpSentAt &&
          idleMs >= this.options.followUpSec * 1000
        ) {
          const text = await this.provider
            .followUp({ scenario: t.scenario, messages: t.messages })
            .catch(
              (err) => (console.error("[texts] followUp failed", err), null),
            );
          if (text) await this.sendScammerMessage(t.id, text, true);
        }
      }
    } finally {
      this.sweeping = false;
    }
  }

  private scheduleTurn(threadId: string) {
    clearTimeout(this.turnTimers.get(threadId));
    this.turnTimers.set(
      threadId,
      setTimeout(() => {
        this.turnTimers.delete(threadId);
        void this.runTurn(threadId);
      }, REPLY_DEBOUNCE_MS),
    );
  }

  private async runTurn(threadId: string) {
    if (this.turnsInFlight.has(threadId)) {
      // A turn is mid-typing; answer the newer replies after it finishes.
      this.scheduleTurn(threadId);
      return;
    }
    this.turnsInFlight.add(threadId);
    try {
      const thread = await this.store.getThread(threadId);
      if (!thread || thread.status !== "active") return;
      const pending = unhandled(thread);
      if (pending.length === 0) return;
      const preSignals = union(...pending.map((m) => m.signals ?? []));

      let result: TextTurnResult;
      try {
        result = await this.provider.nextTextTurn({
          scenario: thread.scenario,
          messages: thread.messages,
          preSignals,
        });
      } catch (err) {
        // Left unhandled; the sweeper retries and eventually ends the thread as idle.
        console.error("[texts] nextTextTurn failed", err);
        return;
      }

      const handledCount = thread.userMessagesHandled + pending.length;
      const { thread: classified } = await this.store.updateThread(
        threadId,
        (t) => {
          t.signals = union(t.signals, result.signals);
          t.userMessagesHandled = handledCount;
        },
      );
      await this.events.emit(
        textEvent("text.reply_classified", classified, {
          messageIds: pending.map((m) => m.id),
          preSignals,
          signals: result.signals,
          done: result.done,
        }),
      );

      if (result.reply) {
        sse.publish(threadId, "typing", { on: true });
        await sleep(typingDelayMs(result.reply));
        sse.publish(threadId, "typing", { on: false });
        if (!(await this.sendScammerMessage(threadId, result.reply, false)))
          return;
      }

      const latest = await this.store.getThread(threadId);
      if (result.done) await this.end(threadId, "provider_done");
      else if (latest && latest.scammerTurns >= latest.scenario.maxTurns)
        await this.end(threadId, "max_turns");
    } finally {
      this.turnsInFlight.delete(threadId);
    }
  }

  /** Appends a scammer message if the thread is still active; returns it, or null if the thread ended. */
  private async sendScammerMessage(
    threadId: string,
    raw: string,
    followUp: boolean,
  ): Promise<TextMessage | null> {
    const at = nowIso();
    const { thread, result: message } = await this.store.updateThread(
      threadId,
      (t) => {
        if (t.status !== "active") return null;
        const m: TextMessage = {
          id: newId("msg"),
          from: "scammer",
          at,
          ...renderScammerText(raw, t),
          ...(followUp ? { followUp } : {}),
        };
        t.messages.push(m);
        if (followUp) t.followUpSentAt = at;
        else t.scammerTurns++;
        if (m.links && !t.linkFirstSentAt) t.linkFirstSentAt = at;
        return m;
      },
    );
    if (!message) return null;

    sse.publish(threadId, "message", message, message.id);
    await this.events.emit(
      textEvent(
        followUp ? "text.follow_up_sent" : "text.message_sent",
        thread,
        {
          messageId: message.id,
          body: message.body,
          hasLink: !!message.links,
          turn: thread.scammerTurns,
        },
      ),
    );
    return message;
  }

  private async end(
    threadId: string,
    reason: ThreadEndReason,
  ): Promise<TextThread | null> {
    clearTimeout(this.turnTimers.get(threadId));
    this.turnTimers.delete(threadId);

    const { thread, result: ended } = await this.store.updateThread(
      threadId,
      (t) => {
        if (t.status !== "active") return false;
        // Replies the provider never saw (e.g. shared a code, then reported) still count.
        t.signals = union(
          t.signals,
          ...unhandled(t).map((m) => m.signals ?? []),
        );
        t.status = "ended";
        t.endReason = reason;
        t.endedAt = nowIso();
        t.outcome = textOutcome(t, reason);
        return true;
      },
    );
    if (!ended) return null;

    sse.publish(threadId, "ended", { outcome: thread.outcome, reason });
    await this.events.emit(
      textEvent("text.thread_ended", thread, {
        outcome: thread.outcome,
        reason,
        signals: thread.signals,
        scammerTurns: thread.scammerTurns,
        userReplies: userMessages(thread).length,
        durationMs: Date.parse(thread.endedAt!) - Date.parse(thread.createdAt),
      }),
    );
    return thread;
  }
}
