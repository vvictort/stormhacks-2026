import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CallRecord, TextThread } from '../shared/types.ts';

/**
 * Persistence for in-progress simulations (text threads, calls). Async so it can later move to Postgres.
 * `update*` applies `fn` to a copy atomically and returns the updated copy plus `fn`'s return value;
 * returned objects are always copies, so mutate only inside `update*`.
 */
export interface SimStore {
  createThread(thread: TextThread): Promise<void>;
  getThread(id: string): Promise<TextThread | null>;
  updateThread<R>(id: string, fn: (thread: TextThread) => R): Promise<{ thread: TextThread; result: R }>;
  listActiveThreads(): Promise<TextThread[]>;
  findActiveThreadByUser(userId: string): Promise<TextThread | null>;
  findThreadByLinkToken(token: string): Promise<TextThread | null>;

  createCall(call: CallRecord): Promise<void>;
  getCall(id: string): Promise<CallRecord | null>;
  updateCall<R>(id: string, fn: (call: CallRecord) => R): Promise<{ call: CallRecord; result: R }>;
  listCallsByStatus(status: CallRecord['status']): Promise<CallRecord[]>;
}

interface Snapshot {
  threads: Record<string, TextThread>;
  calls: Record<string, CallRecord>;
}

/** In-memory maps snapshotted to a JSON file so dev restarts keep in-flight threads, links and calls. */
export class JsonFileStore implements SimStore {
  private threads = new Map<string, TextThread>();
  private calls = new Map<string, CallRecord>();
  private readonly file: string;
  private writeTimer: NodeJS.Timeout | null = null;

  constructor(dir: string) {
    mkdirSync(dir, { recursive: true });
    this.file = join(dir, 'store.json');
    try {
      const snap = JSON.parse(readFileSync(this.file, 'utf8')) as Snapshot;
      this.threads = new Map(Object.entries(snap.threads ?? {}));
      this.calls = new Map(Object.entries(snap.calls ?? {}));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }

  async createThread(thread: TextThread) {
    this.threads.set(thread.id, structuredClone(thread));
    this.schedulePersist();
  }

  async getThread(id: string) {
    const t = this.threads.get(id);
    return t ? structuredClone(t) : null;
  }

  async updateThread<R>(id: string, fn: (thread: TextThread) => R) {
    const current = this.threads.get(id);
    if (!current) throw new Error(`thread not found: ${id}`);
    const next = structuredClone(current);
    const result = fn(next);
    this.threads.set(id, next);
    this.schedulePersist();
    return { thread: structuredClone(next), result };
  }

  async listActiveThreads() {
    return [...this.threads.values()].filter((t) => t.status === 'active').map((t) => structuredClone(t));
  }

  async findActiveThreadByUser(userId: string) {
    const t = [...this.threads.values()].find((t) => t.userId === userId && t.status === 'active');
    return t ? structuredClone(t) : null;
  }

  async findThreadByLinkToken(token: string) {
    const t = [...this.threads.values()].find((t) => t.linkToken === token);
    return t ? structuredClone(t) : null;
  }

  async createCall(call: CallRecord) {
    this.calls.set(call.id, structuredClone(call));
    this.schedulePersist();
  }

  async getCall(id: string) {
    const c = this.calls.get(id);
    return c ? structuredClone(c) : null;
  }

  async updateCall<R>(id: string, fn: (call: CallRecord) => R) {
    const current = this.calls.get(id);
    if (!current) throw new Error(`call not found: ${id}`);
    const next = structuredClone(current);
    const result = fn(next);
    this.calls.set(id, next);
    this.schedulePersist();
    return { call: structuredClone(next), result };
  }

  async listCallsByStatus(status: CallRecord['status']) {
    return [...this.calls.values()].filter((c) => c.status === status).map((c) => structuredClone(c));
  }

  /** Write any pending snapshot synchronously (call on shutdown). */
  flush() {
    if (this.writeTimer) clearTimeout(this.writeTimer);
    this.writeTimer = null;
    const snap: Snapshot = {
      threads: Object.fromEntries(this.threads),
      calls: Object.fromEntries(this.calls),
    };
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(snap, null, 2));
    renameSync(tmp, this.file);
  }

  private schedulePersist() {
    if (this.writeTimer) return;
    this.writeTimer = setTimeout(() => {
      try {
        this.flush();
      } catch (err) {
        console.error('[store] failed to persist snapshot', err);
      }
    }, 100);
  }
}
