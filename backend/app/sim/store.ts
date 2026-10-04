import type { CallRecord, TextThread } from '../shared/types.ts';

/**
 * Persistence for in-progress simulations (text threads, calls); `PgSimStore` in production, `MemoryStore` in tests.
 * `update*` applies `fn` to a copy atomically and returns the updated copy plus `fn`'s return value;
 * returned objects are always copies, so mutate only inside `update*`.
 */
export interface SimStore {
  /** False (nothing stored) when the user already has an active thread: one active thread per user. */
  createThread(thread: TextThread): Promise<boolean>;
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

const copy = <T>(value: T | undefined) => (value ? structuredClone(value) : null);

/** Same contract as `PgSimStore`, kept in one process's memory (tests). */
export class MemoryStore implements SimStore {
  private threads = new Map<string, TextThread>();
  private calls = new Map<string, CallRecord>();

  async createThread(thread: TextThread) {
    if (thread.status === 'active' && (await this.findActiveThreadByUser(thread.userId))) return false;
    this.threads.set(thread.id, structuredClone(thread));
    return true;
  }

  async getThread(id: string) {
    return copy(this.threads.get(id));
  }

  async updateThread<R>(id: string, fn: (thread: TextThread) => R) {
    const next = copy(this.threads.get(id));
    if (!next) throw new Error(`thread not found: ${id}`);
    const result = fn(next);
    this.threads.set(id, next);
    return { thread: structuredClone(next), result };
  }

  async listActiveThreads() {
    return [...this.threads.values()].filter((t) => t.status === 'active').map((t) => structuredClone(t));
  }

  async findActiveThreadByUser(userId: string) {
    return copy([...this.threads.values()].find((t) => t.userId === userId && t.status === 'active'));
  }

  async findThreadByLinkToken(token: string) {
    return copy([...this.threads.values()].find((t) => t.linkToken === token));
  }

  async createCall(call: CallRecord) {
    this.calls.set(call.id, structuredClone(call));
  }

  async getCall(id: string) {
    return copy(this.calls.get(id));
  }

  async updateCall<R>(id: string, fn: (call: CallRecord) => R) {
    const next = copy(this.calls.get(id));
    if (!next) throw new Error(`call not found: ${id}`);
    const result = fn(next);
    this.calls.set(id, next);
    return { call: structuredClone(next), result };
  }

  async listCallsByStatus(status: CallRecord['status']) {
    return [...this.calls.values()].filter((c) => c.status === status).map((c) => structuredClone(c));
  }
}
