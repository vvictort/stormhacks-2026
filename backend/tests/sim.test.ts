import { fakeRepos, testServices } from "./harness.ts";
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createDatabase, type Database } from "../app/db/database.ts";
import { migrate } from "../app/db/migrate.ts";
import { callEvent } from "../app/sim/events.ts";
import { PgEventSink, PgSimStore } from "../app/sim/sim.repository.ts";
import { MemoryStore, type SimStore } from "../app/sim/store.ts";
import type { CallRecord, TextThread } from "../app/shared/types.ts";
import type { Repositories } from "../app/repositories.ts";

let seq = 0;
const thread = (userId: string, overrides: Partial<TextThread> = {}) =>
  ({
    id: `txt_${++seq}`,
    userId,
    scenario: { id: "pkg-redelivery-fee-1", tactics: ["urgency"] },
    status: "active",
    messages: [
      { id: "m1", from: "scammer", body: "hi", at: new Date().toISOString() },
    ],
    signals: [],
    scammerTurns: 0,
    userMessagesHandled: 0,
    createdAt: new Date().toISOString(),
    ...overrides,
  }) as unknown as TextThread;

const call = (userId: string, status: CallRecord["status"] = "ringing") =>
  ({
    id: `call_${++seq}`,
    userId,
    scenario: {
      id: "courier-customs-fee-1",
      tactics: ["urgency"],
      difficulty: 1,
    },
    status,
    createdAt: new Date().toISOString(),
    signals: [],
  }) as unknown as CallRecord;

/**
 * The SimStore contract the text and call services rely on, for any
 * implementation.
 */
function storeContract(name: string, make: () => SimStore) {
  test(`${name}: one active thread per user; ended threads don't count`, async () => {
    const store = make();
    const first = thread("alice");
    assert.equal(await store.createThread(first), true);
    assert.equal(await store.createThread(thread("alice")), false);
    assert.equal((await store.findActiveThreadByUser("alice"))?.id, first.id);
    assert.equal(await store.createThread(thread("bob")), true);

    await store.updateThread(first.id, (t) => {
      t.status = "ended";
    });
    assert.equal(await store.findActiveThreadByUser("alice"), null);
    assert.equal(await store.createThread(thread("alice")), true);
  });

  test(`${name}: concurrent read-modify-write updates all apply, and results are copies`, async () => {
    const store = make();
    const c = call("alice");
    await store.createCall(c);

    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        store.updateCall(c.id, (rec) => {
          rec.signals.push(`s${i}` as never);
          return rec.signals.length;
        }),
      ),
    );
    assert.deepEqual(
      results.map((r) => r.result).sort((a, b) => a - b),
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    );

    const stored = (await store.getCall(c.id))!;
    assert.equal(stored.signals.length, 10);
    stored.signals.length = 0;
    assert.equal(
      (await store.getCall(c.id))!.signals.length,
      10,
      "mutating a returned copy changes nothing",
    );

    await assert.rejects(
      store.updateCall("call_missing", () => {}),
      /call not found/,
    );
    await assert.rejects(
      store.updateThread("txt_missing", () => {}),
      /thread not found/,
    );
  });

  test(`${name}: an update whose fn throws changes nothing`, async () => {
    const store = make();
    const t = thread("carol");
    await store.createThread(t);
    await assert.rejects(
      store.updateThread(t.id, (x) => {
        x.status = "ended";
        throw new Error("boom");
      }),
      /boom/,
    );
    assert.equal((await store.getThread(t.id))!.status, "active");
  });

  test(`${name}: sweeper queries list active threads and calls by status`, async () => {
    const store = make();
    const active = thread("dave");
    const ended = thread("erin", { status: "ended" });
    await store.createThread(active);
    await store.createThread(ended);
    const ringing = call("dave");
    const inCall = call("dave", "in_call");
    await store.createCall(ringing);
    await store.createCall(inCall);

    const ids = (list: { id: string }[]) => list.map((x) => x.id);
    assert.ok(ids(await store.listActiveThreads()).includes(active.id));
    assert.ok(!ids(await store.listActiveThreads()).includes(ended.id));
    assert.ok(
      ids(await store.listCallsByStatus("ringing")).includes(ringing.id),
    );

    await store.updateCall(ringing.id, (c) => {
      c.status = "completed";
    });
    assert.ok(
      !ids(await store.listCallsByStatus("ringing")).includes(ringing.id),
    );
    assert.ok(
      ids(await store.listCallsByStatus("completed")).includes(ringing.id),
    );
    assert.ok(
      ids(await store.listCallsByStatus("in_call")).includes(inCall.id),
    );
  });

  test(`${name}: link tokens find their thread, including after it ended`, async () => {
    const store = make();
    const t = thread("frank", { linkToken: `tok_${seq}` });
    await store.createThread(t);
    assert.equal((await store.findThreadByLinkToken(t.linkToken!))?.id, t.id);

    await store.updateThread(t.id, (x) => {
      x.status = "ended";
    });
    assert.equal(
      (await store.findThreadByLinkToken(t.linkToken!))?.status,
      "ended",
    );
    assert.equal(await store.findThreadByLinkToken("tok_unknown"), null);
  });
}

storeContract("MemoryStore", () => new MemoryStore());

const url = process.env.TEST_DATABASE_URL;
describe("Postgres simulation store and events", { skip: !url }, () => {
  let db: Database;
  before(async () => {
    assert.match(
      new URL(url!).pathname,
      /_test$/,
      "Use a dedicated test database.",
    );
    db = createDatabase(url!);
    await migrate(db);
  });
  beforeEach(async () => {
    await db.query("TRUNCATE sim_text_threads, sim_calls, sim_events");
  });
  after(async () => {
    await db?.end();
  });

  storeContract("PgSimStore", () => new PgSimStore(db));

  test("a new store (another process, a restart) sees the same simulations", async () => {
    const t = thread("gina", { linkToken: "tok_restart" });
    await new PgSimStore(db).createThread(t);
    const other = new PgSimStore(db);
    assert.deepEqual(
      await other.getThread(t.id),
      JSON.parse(JSON.stringify(t)),
    );
    assert.equal((await other.findThreadByLinkToken("tok_restart"))?.id, t.id);
  });

  test("two concurrent text starts for one user create one thread; the other gets the conflict", async () => {
    const { services } = testServices(fakeRepos() as Repositories, {
      store: new PgSimStore(db),
      events: new PgEventSink(db),
    });
    const scenario = (await services.catalog.pickText("pkg-redelivery-fee-1"))!;

    const results = await Promise.all([
      services.texts.start("hank", scenario),
      services.texts.start("hank", scenario),
    ]);

    assert.deepEqual(results.map((r) => Object.keys(r)[0]).sort(), [
      "conflict",
      "thread",
    ]);
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::int AS n FROM sim_text_threads WHERE user_id='hank'",
        )
      ).rows[0].n,
      1,
    );
  });

  test("the call sweeper abandons a stale ringing call stored in Postgres", async () => {
    const store = new PgSimStore(db);
    const { services } = testServices(fakeRepos() as Repositories, {
      store,
      events: new PgEventSink(db),
    });
    const started = await services.calls.start(
      "ivy",
      (await services.catalog.pickCall("courier-customs-fee-1", "ivy"))!,
    );
    await store.updateCall(started.id, (c) => {
      c.createdAt = new Date(Date.now() - 3 * 60_000).toISOString();
    });

    await services.calls.sweep();
    const swept = (await store.getCall(started.id))!;
    assert.deepEqual([swept.status, swept.error], ["completed", "abandoned"]);

    const types = (
      await db.query(
        "SELECT type FROM sim_events WHERE simulation_id=$1 ORDER BY at, type",
        [started.id],
      )
    ).rows.map((r) => r.type);
    assert.deepEqual(types.sort(), ["call.abandoned", "call.ringing"]);
  });

  test("events are stored whole and a failed write never throws", async () => {
    const sink = new PgEventSink(db);
    const event = callEvent("call.failed", call("jo"), {
      error: "nul\u0000byte",
    });
    await sink.emit(event);
    await sink.emit(event);

    const rows = (await db.query("SELECT type, user_id, event FROM sim_events"))
      .rows;
    assert.equal(rows.length, 1);
    assert.deepEqual(
      [rows[0].type, rows[0].user_id, rows[0].event.data.error],
      ["call.failed", "jo", "nulbyte"],
    );
  });

  test("a user reply containing U+0000 is stored without it", async () => {
    const store = new PgSimStore(db);
    const t = thread("kim");
    await store.createThread(t);
    await store.updateThread(t.id, (x) => {
      x.messages.push({
        id: "m2",
        from: "user",
        body: "a\u0000b",
        at: new Date().toISOString(),
      });
    });
    assert.equal((await store.getThread(t.id))!.messages[1]!.body, "ab");
  });
});
