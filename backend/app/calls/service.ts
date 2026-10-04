import { newId, nowIso } from "../shared/ids.ts";
import { redact } from "../shared/redact.ts";
import {
  COMPROMISING_SIGNALS,
  type CallRecord,
  type CallScenario,
  type Signal,
  type SimOutcome,
} from "../shared/types.ts";
import { callEvent, type EventSink } from "../sim/events.ts";
import type { SimStore } from "../sim/store.ts";
import type { AttemptsRepository } from "../training/attempts.repository.ts";
import { trainingAttempt } from "./attempt.ts";
import type { ElevenLabs, ElevenLabsConversation } from "./elevenlabs.ts";
import { toTraining } from "./outcome.ts";
import { withPreamble } from "./preamble.ts";

/** Give up waiting for ElevenLabs' post-call analysis after this long. */
const ANALYSIS_TIMEOUT_MS = 90_000;
const POLL_DELAYS_MS = [2000, 3000, 5000, 5000, 10_000];
/**
 * A call still ringing after this long was given up by the browser (tab closed, or stuck on a voice/mic error), not
 * missed: the browser's own ring timer reports real misses. It is abandoned, so it never becomes a scored attempt.
 */
const RING_ABANDON_MS = 2 * 60_000;
/** An accepted call never reported as ended (tab closed) is analyzed after max duration + this grace. */
const IN_CALL_GRACE_MS = 60_000;

/** Agent data-collection fields (see scripts/setup-agent.ts) → signals. */
const DATA_COLLECTION_SIGNALS: Record<string, Signal> = {
  shared_otp: "shared_code",
  shared_personal_info: "shared_personal_info",
  shared_payment_info: "shared_payment_info",
  agreed_to_action: "agreed_to_action",
  challenged_caller: "challenged",
  asked_to_verify: "asked_to_verify",
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Session overrides in the shape `@elevenlabs/client` / `@elevenlabs/react` `startSession` expects. */
function buildOverrides(scenario: CallScenario) {
  return {
    agent: {
      prompt: { prompt: withPreamble(scenario.systemPrompt) },
      firstMessage: scenario.firstMessage,
    },
    ...(scenario.voiceId ? { tts: { voiceId: scenario.voiceId } } : {}),
  };
}

export type CallAccept = {
  call: CallRecord;
  conversationToken: string;
  overrides: ReturnType<typeof buildOverrides>;
};

/** Binds the first conversation id reported for a call; a different id later is a mismatch. */
function bindConversation(c: CallRecord, conversationId: string) {
  c.conversationId ??= conversationId;
  return c.conversationId === conversationId;
}

function completeAs(c: CallRecord, outcome: SimOutcome) {
  c.status = "completed";
  c.outcome = outcome;
  c.training = toTraining(outcome, c.scenario.difficulty);
  c.completedAt = nowIso();
}

export interface CallServiceDeps {
  /** Completed calls are saved here as training attempts. */
  attempts: Pick<AttemptsRepository, "insert">;
  elevenLabs: Pick<ElevenLabs, "conversationToken" | "getConversation">;
  callMaxSeconds: number;
}

export class CallService {
  private analyzing = new Set<string>();
  private readonly store: SimStore;
  private readonly events: EventSink;
  private readonly deps: CallServiceDeps;

  constructor(store: SimStore, events: EventSink, deps: CallServiceDeps) {
    this.store = store;
    this.events = events;
    this.deps = deps;
  }

  async start(userId: string, scenario: CallScenario): Promise<CallRecord> {
    const call: CallRecord = {
      id: newId("call"),
      userId,
      scenario,
      status: "ringing",
      createdAt: nowIso(),
      signals: [],
    };
    await this.store.createCall(call);
    await this.events.emit(
      callEvent("call.ringing", call, {
        callerLabel: scenario.callerLabel,
        difficulty: scenario.difficulty,
        scamCategory: scenario.scamCategory,
      }),
    );
    return call;
  }

  get(callId: string) {
    return this.store.getCall(callId);
  }

  /** User picked up: fetch a fresh token so it can't expire while ringing. */
  async accept(
    callId: string,
  ): Promise<CallAccept | "not_found" | "wrong_state"> {
    const current = await this.store.getCall(callId);
    if (!current) return "not_found";
    if (current.status !== "ringing") return "wrong_state";

    const { token, conversation_id } =
      await this.deps.elevenLabs.conversationToken();
    const now = Date.now();
    const { call, result: accepted } = await this.store.updateCall(
      callId,
      (c) => {
        if (c.status !== "ringing") return false;
        c.status = "in_call";
        c.acceptedAt = new Date(now).toISOString();
        if (conversation_id) c.conversationId = conversation_id;
        return true;
      },
    );
    if (!accepted) return "wrong_state";

    await this.events.emit(
      callEvent("call.accepted", call, {
        ringMs: now - Date.parse(call.createdAt),
      }),
    );
    return {
      call,
      conversationToken: token,
      overrides: buildOverrides(call.scenario),
    };
  }

  async decline(
    callId: string,
    reason: "declined" | "missed",
  ): Promise<CallRecord | "not_found" | "wrong_state"> {
    if (!(await this.store.getCall(callId))) return "not_found";
    const now = Date.now();
    const { call, result: declined } = await this.store.updateCall(
      callId,
      (c) => {
        if (c.status !== "ringing") return false;
        completeAs(c, reason);
        return true;
      },
    );
    if (!declined) return "wrong_state";
    await this.events.emit(
      callEvent(reason === "declined" ? "call.declined" : "call.missed", call, {
        ringMs: now - Date.parse(call.createdAt),
      }),
    );
    this.report(call);
    return call;
  }

  /**
   * The browser gave up on a ringing call (switched to caption practice after a voice or microphone failure, or left
   * the page). It completes as an unscored `error` and is never saved as an attempt: nothing was practised.
   */
  async abandon(
    callId: string,
  ): Promise<CallRecord | "not_found" | "wrong_state"> {
    if (!(await this.store.getCall(callId))) return "not_found";
    const { call, result: abandoned } = await this.store.updateCall(
      callId,
      (c) => {
        if (c.status !== "ringing") return false;
        completeAs(c, "error");
        c.error = "abandoned";
        return true;
      },
    );
    if (!abandoned) return "wrong_state";
    await this.events.emit(
      callEvent("call.abandoned", call, {
        ringMs: Date.now() - Date.parse(call.createdAt),
      }),
    );
    return call;
  }

  /** The browser's voice session connected: bind its conversation id if the token didn't provide one. */
  async connected(
    callId: string,
    conversationId: string,
  ): Promise<
    CallRecord | "not_found" | "wrong_state" | "conversation_mismatch"
  > {
    if (!(await this.store.getCall(callId))) return "not_found";
    const { call, result } = await this.store.updateCall(callId, (c) => {
      if (c.conversationId === conversationId) return null;
      if (c.status !== "in_call") return "wrong_state" as const;
      return bindConversation(c, conversationId)
        ? null
        : ("conversation_mismatch" as const);
    });
    return result ?? call;
  }

  /**
   * Browser hung up (or the agent ended the call). Analysis continues in the background.
   * A mismatched conversation id leaves the call in_call, so the right `/ended` (or the sweeper) can still finish it.
   */
  async ended(
    callId: string,
    conversationId?: string,
  ): Promise<
    CallRecord | "not_found" | "wrong_state" | "conversation_mismatch"
  > {
    if (!(await this.store.getCall(callId))) return "not_found";
    const { call, result } = await this.store.updateCall(callId, (c) => {
      if (c.status !== "in_call") return "wrong_state" as const;
      if (conversationId && !bindConversation(c, conversationId))
        return "conversation_mismatch" as const;
      c.status = "analyzing";
      c.endedAt = nowIso();
      return null;
    });
    if (result) return result;
    await this.events.emit(
      callEvent("call.ended", call, { conversationId: call.conversationId }),
    );
    void this.analyze(callId);
    return call;
  }

  /** Recovers calls abandoned by a closed tab or interrupted by a restart. */
  async sweep() {
    const now = Date.now();
    for (const c of await this.store.listCallsByStatus("ringing")) {
      if (now - Date.parse(c.createdAt) >= RING_ABANDON_MS)
        await this.abandon(c.id);
    }
    for (const c of await this.store.listCallsByStatus("in_call")) {
      if (
        now - Date.parse(c.acceptedAt!) >=
        this.deps.callMaxSeconds * 1000 + IN_CALL_GRACE_MS
      )
        await this.ended(c.id);
    }
    for (const c of await this.store.listCallsByStatus("analyzing")) {
      if (!this.analyzing.has(c.id)) void this.analyze(c.id);
    }
  }

  private async analyze(callId: string) {
    if (this.analyzing.has(callId)) return;
    this.analyzing.add(callId);
    try {
      const call = await this.store.getCall(callId);
      if (!call || call.status !== "analyzing") return;
      if (!call.conversationId)
        return await this.fail(callId, "no conversation id");

      const deadline =
        Date.parse(call.endedAt ?? nowIso()) + ANALYSIS_TIMEOUT_MS;
      for (let attempt = 0; ; attempt++) {
        try {
          const conv = await this.deps.elevenLabs.getConversation(
            call.conversationId,
          );
          if (conv.status === "done" && conv.analysis)
            return await this.complete(callId, conv);
          if (conv.status === "failed")
            return await this.fail(callId, "ElevenLabs conversation failed");
        } catch (err) {
          // The conversation can briefly 404 right after hang-up; keep polling until the deadline.
          console.warn(
            `[calls] ${callId}: fetching conversation failed`,
            err instanceof Error ? err.message : err,
          );
        }
        if (Date.now() >= deadline)
          return await this.fail(callId, "timed out waiting for call analysis");
        await sleep(
          POLL_DELAYS_MS[Math.min(attempt, POLL_DELAYS_MS.length - 1)]!,
        );
      }
    } finally {
      this.analyzing.delete(callId);
    }
  }

  private async complete(callId: string, conv: ElevenLabsConversation) {
    const results = conv.analysis?.data_collection_results ?? {};
    const signals = new Set<Signal>();
    for (const [field, signal] of Object.entries(DATA_COLLECTION_SIGNALS)) {
      const value = results[field]?.value;
      if (value === true || value === "true") signals.add(signal);
    }
    const transcript = conv.transcript
      .filter((t) => t.message)
      .map((t) => ({
        role: t.role,
        message: redact(t.message!),
        timeInCallSecs: t.time_in_call_secs,
      }));
    if (transcript.some((t) => t.role === "user")) signals.add("engaged");

    const outcome: SimOutcome = [...signals].some((s) =>
      COMPROMISING_SIGNALS.includes(s),
    )
      ? "compromised"
      : "resisted";
    const dataCollection = Object.fromEntries(
      Object.entries(results).map(([k, r]) => [
        k,
        { value: r.value, rationale: r.rationale && redact(r.rationale) },
      ]),
    );

    const { call } = await this.store.updateCall(callId, (c) => {
      completeAs(c, outcome);
      c.signals = [...signals];
      c.transcript = transcript;
      c.dataCollection = dataCollection;
      c.durationSecs = conv.metadata?.call_duration_secs;
      c.summary =
        conv.analysis?.transcript_summary &&
        redact(conv.analysis.transcript_summary);
      c.resisted =
        conv.analysis?.evaluation_criteria_results?.user_resisted?.result;
    });
    await this.events.emit(
      callEvent("call.analyzed", call, {
        outcome,
        signals: call.signals,
        resisted: call.resisted,
        durationSecs: call.durationSecs,
        terminationReason: conv.metadata?.termination_reason,
        dataCollection: Object.fromEntries(
          Object.entries(dataCollection).map(([k, r]) => [k, r.value]),
        ),
        summary: call.summary,
        transcript,
      }),
    );
    this.report(call);
  }

  private async fail(callId: string, error: string) {
    const { call } = await this.store.updateCall(callId, (c) => {
      completeAs(c, "error");
      c.error = error;
    });
    await this.events.emit(callEvent("call.failed", call, { error }));
    this.report(call);
  }

  /** Best-effort and in the background: saving never holds up or breaks the call flow. Idempotent on the call id. */
  private report(call: CallRecord) {
    // ponytail: no retry, a failed insert is logged and the result stays only in the call record.
    Promise.resolve()
      .then(() => this.deps.attempts.insert(trainingAttempt(call)))
      .catch((err) =>
        console.error(
          `[calls] saving attempt ${call.id} failed:`,
          err instanceof Error ? err.message : err,
        ),
      );
  }
}
