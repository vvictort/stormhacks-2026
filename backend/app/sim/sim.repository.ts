import { transaction, type Database } from "../db/database.ts";
import type { CallRecord, SimEvent, TextThread } from "../shared/types.ts";
import type { EventSink } from "./events.ts";
import type { SimStore } from "./store.ts";

// jsonb can't hold U+0000, which a user's reply could contain; drop it rather
// than fail the write.
const json = (value: unknown) =>
  JSON.stringify(value, (_key, v) =>
    typeof v === "string" ? v.replaceAll("\0", "") : v,
  );

/**
 * Simulations as jsonb documents (migration 003). Every process shares them, so
 * restarts and replicas see the same state.
 */
export class PgSimStore implements SimStore {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  async createThread(t: TextThread) {
    const { rowCount } = await this.db.query(
      `INSERT INTO sim_text_threads(id,user_id,status,link_token,doc,created_at) VALUES($1,$2,$3,$4,$5,$6)
       ON CONFLICT (user_id) WHERE status = 'active' DO NOTHING`,
      [t.id, t.userId, t.status, t.linkToken ?? null, json(t), t.createdAt],
    );
    return rowCount === 1;
  }

  async getThread(id: string) {
    return this.one<TextThread>(
      "SELECT doc FROM sim_text_threads WHERE id=$1",
      [id],
    );
  }

  /**
   * Row-locked read-modify-write: concurrent updates (other requests, other
   * processes) apply one after another.
   */
  async updateThread<R>(id: string, fn: (thread: TextThread) => R) {
    return transaction(this.db, async (client) => {
      const {
        rows: [row],
      } = await client.query(
        "SELECT doc FROM sim_text_threads WHERE id=$1 FOR UPDATE",
        [id],
      );
      if (!row) throw new Error(`thread not found: ${id}`);
      const thread = row.doc as TextThread;
      const result = fn(thread);
      await client.query(
        "UPDATE sim_text_threads SET status=$2, link_token=$3, doc=$4, updated_at=now() WHERE id=$1",
        [id, thread.status, thread.linkToken ?? null, json(thread)],
      );
      return { thread, result };
    });
  }

  async listActiveThreads() {
    return this.all<TextThread>(
      "SELECT doc FROM sim_text_threads WHERE status='active' ORDER BY created_at",
      [],
    );
  }

  async findActiveThreadByUser(userId: string) {
    return this.one<TextThread>(
      "SELECT doc FROM sim_text_threads WHERE user_id=$1 AND status='active'",
      [userId],
    );
  }

  async findThreadByLinkToken(token: string) {
    return this.one<TextThread>(
      "SELECT doc FROM sim_text_threads WHERE link_token=$1",
      [token],
    );
  }

  async createCall(c: CallRecord) {
    await this.db.query(
      "INSERT INTO sim_calls(id,user_id,status,doc,created_at) VALUES($1,$2,$3,$4,$5)",
      [c.id, c.userId, c.status, json(c), c.createdAt],
    );
  }

  async getCall(id: string) {
    return this.one<CallRecord>("SELECT doc FROM sim_calls WHERE id=$1", [id]);
  }

  async updateCall<R>(id: string, fn: (call: CallRecord) => R) {
    return transaction(this.db, async (client) => {
      const {
        rows: [row],
      } = await client.query(
        "SELECT doc FROM sim_calls WHERE id=$1 FOR UPDATE",
        [id],
      );
      if (!row) throw new Error(`call not found: ${id}`);
      const call = row.doc as CallRecord;
      const result = fn(call);
      await client.query(
        "UPDATE sim_calls SET status=$2, doc=$3, updated_at=now() WHERE id=$1",
        [id, call.status, json(call)],
      );
      return { call, result };
    });
  }

  async listCallsByStatus(status: CallRecord["status"]) {
    return this.all<CallRecord>(
      "SELECT doc FROM sim_calls WHERE status=$1 ORDER BY created_at",
      [status],
    );
  }

  private async one<T>(sql: string, params: unknown[]) {
    const {
      rows: [row],
    } = await this.db.query(sql, params);
    return (row?.doc as T | undefined) ?? null;
  }

  private async all<T>(sql: string, params: unknown[]) {
    const { rows } = await this.db.query(sql, params);
    return rows.map((row) => row.doc as T);
  }
}

/**
 * Appends every event to `sim_events` and logs a short line. A failed write is
 * logged, never thrown.
 */
export class PgEventSink implements EventSink {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  async emit(event: SimEvent) {
    console.log(`[event] ${event.type} ${event.simulationId}`);
    try {
      await this.db.query(
        "INSERT INTO sim_events(id,type,at,user_id,simulation_id,channel,event) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [
          event.id,
          event.type,
          event.at,
          event.userId,
          event.simulationId,
          event.channel,
          json(event),
        ],
      );
    } catch (err) {
      console.error(
        "[events] failed to write event",
        err instanceof Error ? err.message : err,
      );
    }
  }
}
