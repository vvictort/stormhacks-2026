import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { newId, nowIso } from './lib/ids.ts';
import type { CallRecord, CommsEvent, CommsEventType, TextThread } from './types.ts';

/** Where comms reports what happened. Kelvin swaps this for a TigerData sink later. */
export interface EventSink {
  /** Must never throw into the simulation flows. */
  emit(event: CommsEvent): Promise<void>;
}

/** Appends one JSON event per line to data/events.jsonl and logs a short line to the console. */
export class JsonlEventSink implements EventSink {
  private readonly file: string;
  private ready: Promise<unknown>;

  constructor(dir: string) {
    this.file = join(dir, 'events.jsonl');
    this.ready = mkdir(dir, { recursive: true });
  }

  async emit(event: CommsEvent) {
    console.log(`[event] ${event.type} ${event.simulationId}`);
    try {
      await this.ready;
      await appendFile(this.file, JSON.stringify(event) + '\n');
    } catch (err) {
      console.error('[events] failed to write event', err);
    }
  }
}

export function textEvent(type: CommsEventType, thread: TextThread, data: Record<string, unknown> = {}): CommsEvent {
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

export function callEvent(type: CommsEventType, call: CallRecord, data: Record<string, unknown> = {}): CommsEvent {
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
