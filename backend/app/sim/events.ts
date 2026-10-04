import { newId, nowIso } from "../shared/ids.ts";
import type {
  CallRecord,
  SimEvent,
  SimEventType,
  TextThread,
} from "../shared/types.ts";

/** Where simulations report what happened: `PgEventSink` (sim.repository.ts) in production, `MemoryEventSink` in tests. */
export interface EventSink {
  /** Must never throw into the simulation flows. */
  emit(event: SimEvent): Promise<void>;
}

export class MemoryEventSink implements EventSink {
  readonly events: SimEvent[] = [];
  async emit(event: SimEvent) {
    this.events.push(event);
  }
}

export function textEvent(
  type: SimEventType,
  thread: TextThread,
  data: Record<string, unknown> = {},
): SimEvent {
  return {
    id: newId("evt"),
    type,
    at: nowIso(),
    userId: thread.userId,
    simulationId: thread.id,
    channel: "text",
    scenarioId: thread.scenario.id,
    tactics: thread.scenario.tactics,
    data,
  };
}

export function callEvent(
  type: SimEventType,
  call: CallRecord,
  data: Record<string, unknown> = {},
): SimEvent {
  return {
    id: newId("evt"),
    type,
    at: nowIso(),
    userId: call.userId,
    simulationId: call.id,
    channel: "call",
    scenarioId: call.scenario.id,
    tactics: call.scenario.tactics,
    data,
  };
}
