import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { newId, nowIso } from '../shared/ids.ts';
import type { CallRecord, SimEvent, SimEventType, TextThread } from '../shared/types.ts';

/** Where simulations report what happened. Kelvin swaps this for a TigerData sink later. */
export interface EventSink {
  /** Must never throw into the simulation flows. */
  emit(event: SimEvent): Promise<void>;
}

/** Appends one JSON event per line to data/events.jsonl and logs a short line to the console. */
export class JsonlEventSink implements EventSink {
  private readonly file: string;
  private ready: Promise<unknown>;

  constructor(dir: string) {
    this.file = join(dir, 'events.jsonl');
    this.ready = mkdir(dir, { recursive: true });
  }

  async emit(event: SimEvent) {
    console.log(`[event] ${event.type} ${event.simulationId}`);
    try {
      await this.ready;
      await appendFile(this.file, JSON.stringify(event) + '\n');
    } catch (err) {
      console.error('[events] failed to write event', err);
    }
  }
}

export function textEvent(type: SimEventType, thread: TextThread, data: Record<string, unknown> = {}): SimEvent {
  return {
    id: newId('evt'),
    type,
    at: nowIso(),
    userId: thread.userId,
    simulationId: thread.id,
    channel: 'text',
    scenarioId: thread.scenario.id,
    tactics: thread.scenario.tactics,
    data,
  };
}

export function callEvent(type: SimEventType, call: CallRecord, data: Record<string, unknown> = {}): SimEvent {
  return {
    id: newId('evt'),
    type,
    at: nowIso(),
    userId: call.userId,
    simulationId: call.id,
    channel: 'call',
    scenarioId: call.scenario.id,
    tactics: call.scenario.tactics,
    data,
  };
}
