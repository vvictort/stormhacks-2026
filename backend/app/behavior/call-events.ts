import { toTraining } from "../calls/outcome.ts";
import {
  difficultyName,
  type SimEvent,
  type SimEventType,
  type SimOutcome,
} from "../shared/types.ts";
import { ScamCategory, type BehaviorEventType } from "../shared/vocabulary.ts";
import type { EventSink } from "../sim/events.ts";
import type { SimStore } from "../sim/store.ts";
import { inferCategory } from "../training/progress.ts";
import type {
  BehaviorEvent,
  BehaviorRepository,
} from "./behavior.repository.ts";

// Call lifecycle → behaviour events. Abandoned and failed calls aren't scored,
// so they add nothing.
const MAPPED: Partial<Record<SimEventType, BehaviorEventType>> = {
  "call.ringing": "call_received",
  "call.accepted": "call_answered",
  "call.declined": "call_declined",
  "call.missed": "call_missed",
  "call.ended": "call_ended",
};

/** Events that finish a scored call, with its raw outcome. */
const COMPLETES: Partial<Record<SimEventType, (e: SimEvent) => SimOutcome>> = {
  "call.declined": () => "declined",
  "call.missed": () => "missed",
  "call.analyzed": (e) => e.data.outcome as SimOutcome,
};

/**
 * Forwards every simulation event to `inner`, and records call behaviour in
 * TigerData. Never throws.
 */
export class CallBehaviorSink implements EventSink {
  private readonly inner: EventSink;
  private readonly behavior: Pick<BehaviorRepository, "record">;
  private readonly store: Pick<SimStore, "getCall">;

  constructor(
    inner: EventSink,
    behavior: Pick<BehaviorRepository, "record">,
    store: Pick<SimStore, "getCall">,
  ) {
    this.inner = inner;
    this.behavior = behavior;
    this.store = store;
  }

  async emit(event: SimEvent) {
    await this.inner.emit(event);
    if (
      event.channel !== "call" ||
      !(MAPPED[event.type] || COMPLETES[event.type])
    ) {
      return;
    }
    try {
      const call = await this.store.getCall(event.simulationId);
      if (!call) return;

      // Time since the phone started ringing: to answer, to decline, or to the
      // end of the call.
      const sinceRing =
        typeof event.data.ringMs === "number"
          ? event.data.ringMs
          : Math.max(0, Date.parse(event.at) - Date.parse(call.createdAt));
      const base = {
        at: event.at,
        uid: call.userId,
        channel: "call" as const,
        scenarioId: call.scenario.id,
        attemptId: call.id,
        scamCategory:
          ScamCategory.safeParse(
            (call.scenario as { scamCategory?: unknown }).scamCategory,
          ).data ?? inferCategory(call.scenario),
        difficulty: difficultyName[call.scenario.difficulty] ?? null,
        responseTimeMs: Math.round(sinceRing),
        metadata: {},
      };

      const rows: BehaviorEvent[] = [];
      const type = MAPPED[event.type];
      if (type) rows.push({ ...base, type, outcome: null });
      const raw = COMPLETES[event.type]?.(event);
      if (raw) {
        const { outcome } = toTraining(raw, call.scenario.difficulty);
        if (outcome && outcome !== "error") {
          rows.push({ ...base, type: "scenario_completed", outcome });
        }
      }
      await this.behavior.record(rows);
    } catch (err) {
      console.error(
        "[behavior] failed to record call event",
        err instanceof Error ? err.message : err,
      );
    }
  }
}
