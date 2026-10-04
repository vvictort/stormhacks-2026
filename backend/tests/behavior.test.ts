import { fakeRepos, json, mockOutbound, origin, testServices } from './harness.ts';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, test } from 'node:test';
import supertest from 'supertest';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { BehaviorRepository, mostImproved, type BehaviorEvent } from '../app/behavior/behavior.repository.ts';
import { clampTime, MAX_EVENT_AGE_MS } from '../app/behavior/behavior.routes.ts';
import { CallBehaviorSink } from '../app/behavior/call-events.ts';
import { createElevenLabs } from '../app/calls/elevenlabs.ts';
import { CallService } from '../app/calls/service.ts';
import { createDatabase, type Database } from '../app/db/database.ts';
import { migrate } from '../app/db/migrate.ts';
import { createRepositories, type Repositories } from '../app/repositories.ts';
import { createApp } from '../app/server.ts';
import type { CallScenario } from '../app/shared/types.ts';
import { MemoryEventSink } from '../app/sim/events.ts';
import { MemoryStore } from '../app/sim/store.ts';

const identity = (uid: string) => ({ uid, sub: uid, aud: 'test-project', iss: 'https://securetoken.google.com/test-project', auth_time: 0, iat: 0, exp: 9999999999, firebase: { identities: {}, sign_in_provider: 'password' }, email: `${uid}@example.test`, email_verified: true }) as DecodedIdToken;
const verifyToken = async (token: string) => {
  if (token === 'alex' || token === 'sam') return identity(token);
  throw Object.assign(new Error('invalid'), { code: 'auth/invalid-id-token' });
};

const event = (overrides: Record<string, unknown> = {}) => ({
  type: 'scenario_started', channel: 'email', scenarioId: 'bank-sign-in', scenarioTitle: 'Your bank account is locked', attemptId: '6f1c1b1e-8d43-4c55-9a0e-2f5d7c1a9b01',
  difficulty: 'medium', ...overrides,
});
const completed = (overrides: Record<string, unknown> = {}) => event({ type: 'scenario_completed', outcome: 'reported_correct', responseTimeMs: 9000, ...overrides });

/** Routes over the given repositories; `recorded` collects every behaviour row written. */
function routes(repos: Repositories = fakeRepos()) {
  const recorded: BehaviorEvent[] = [];
  const record = repos.behavior.record.bind(repos.behavior);
  repos.behavior.record = async (rows) => { recorded.push(...rows); return record(rows); };
  const app = createApp({ repos, services: testServices(repos).services, origin, verifyToken });
  return {
    recorded,
    post: (events: unknown, user: string | null = 'alex') => {
      const req = supertest(app).post('/api/training/events').set('Origin', origin);
      return (user ? req.set('Authorization', `Bearer ${user}`) : req).send({ events } as object);
    },
    metrics: (user = 'alex') => supertest(app).get('/api/training/metrics').set('Authorization', `Bearer ${user}`),
    progress: (user = 'alex') => supertest(app).get('/api/training/progress').set('Authorization', `Bearer ${user}`),
  };
}

test('invalid batches are rejected whole with a 400', async () => {
  const { post, recorded } = routes();
  const bad = [
    [], // empty
    Array.from({ length: 51 }, () => event()), // oversize
    [event({ type: 'nope' })],
    [event({ type: 'call_answered' })], // call events only come from the server
    [event({ channel: 'call' })],
    [event({ attemptId: 'call_123' })], // must be a browser UUID
    [event({ scamCategory: 'romance' })],
    [event({ outcome: 'reported_correct' })], // outcome only on scenario_completed
    [completed({ outcome: 'compromised' })], // a call outcome
    [completed({ outcome: undefined })],
    [event({ metadata: Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`k${i}`, 1])) })],
    [event({ metadata: { site: 'x'.repeat(201) } })],
    [event({ metadata: { a: 'x'.repeat(190), b: 'x'.repeat(190), c: 'x'.repeat(190) } })], // over 512 bytes
    [event({ metadata: { nested: { a: 1 } } })],
    [event({ responseTimeMs: -1 })],
    [event(), event({ type: 'nope' })], // one bad event fails the batch
  ];
  for (const events of bad) assert.equal((await post(events)).status, 400, JSON.stringify(events).slice(0, 120));
  assert.equal(recorded.length, 0);
  assert.equal((await post([event()], null)).status, 401);
  assert.equal((await post(Array.from({ length: 50 }, () => event()))).status, 202);
});

test('the uid comes from the token; metadata is capped to safe keys and redacted', async () => {
  const { post, recorded } = routes();
  const res = await post([{ ...event({ type: 'link_clicked', metadata: { site: 'bank-secure.example', replyText: 'my code is 123456', note: 'call 4111 1111 1111 1111' } }), uid: 'sam', firebaseUid: 'sam' }]);
  assert.deepEqual([res.status, res.body], [202, { accepted: 1 }]);
  const [row] = recorded;
  assert.equal(row.uid, 'alex');
  assert.equal(row.type, 'link_clicked');
  assert.equal(row.scamCategory, 'banking', 'inferred from id and title');
  assert.deepEqual(row.metadata, { site: 'bank-secure.example', note: 'call [NUMBER:16 digits]' });
  await post([event({ scamCategory: 'government' })]);
  assert.equal(recorded[1].scamCategory, 'government', 'a given category wins');
});

test('timestamps are clamped to the last few minutes; missing means server time', async () => {
  const now = Date.parse('2026-10-04T12:00:00Z');
  assert.equal(clampTime(undefined, now), '2026-10-04T12:00:00.000Z');
  assert.equal(clampTime('2026-10-04T11:59:30Z', now), '2026-10-04T11:59:30.000Z');
  assert.equal(clampTime('2027-01-01T00:00:00Z', now), '2026-10-04T12:00:00.000Z');
  assert.equal(clampTime('2020-01-01T00:00:00Z', now), new Date(now - MAX_EVENT_AGE_MS).toISOString());

  const { post, recorded } = routes();
  const before = Date.now();
  await post([event({ at: '2099-01-01T00:00:00Z' }), event({ at: '2001-01-01T00:00:00+02:00' }), event()]).expect(202);
  const [future, old, none] = recorded.map((r) => Date.parse(r.at));
  assert.ok(future >= before && future <= Date.now());
  assert.ok(Math.abs(old - (before - MAX_EVENT_AGE_MS)) < 5000);
  assert.ok(none >= before && none <= Date.now());
  assert.equal((await post([event({ at: 'yesterday' })])).status, 400);
});

test('a finished text or email is also saved once as a training attempt', async () => {
  const repos = fakeRepos();
  const { post, progress } = routes(repos);
  await post([event(), completed({ outcome: 'safe_incorrect', responseTimeMs: 12_400 })]).expect(202);
  await post([completed({ outcome: 'safe_incorrect', responseTimeMs: 12_400 })]).expect(202); // a retried batch
  const { attempts, stats, vulnerability } = (await progress().expect(200)).body;
  assert.equal(attempts.length, 1);
  assert.deepEqual([attempts[0].id, attempts[0].channel, attempts[0].outcome, attempts[0].success, attempts[0].scamCategory, attempts[0].difficulty],
    ['6f1c1b1e-8d43-4c55-9a0e-2f5d7c1a9b01', 'email', 'safe_incorrect', false, 'banking', 'medium']);
  assert.deepEqual(stats, { total: 1, successes: 0, compromised: 1 });
  assert.deepEqual(vulnerability.weakCategories, ['banking']);
  const detail = await repos.attempts.get('alex', attempts[0].id);
  assert.equal(detail?.durationSecs, 12);
  assert.equal(Date.parse(detail!.completedAt) - Date.parse(detail!.startedAt!), 12_400);
  assert.equal((await progress('sam').expect(200)).body.attempts.length, 0);
});

test('a finished message stores its tactics on the attempt, so missed tactics reach the vulnerability profile', async () => {
  const repos = fakeRepos();
  const { post, progress } = routes(repos);
  assert.equal((await post([completed({ tactics: ['bribery'] })])).status, 400, 'tactics are the shared vocabulary');
  await post([completed({ outcome: 'safe_incorrect', tactics: ['urgency', 'suspicious_link', 'urgency'] })]).expect(202);
  await post([completed({ attemptId: '6f1c1b1e-8d43-4c55-9a0e-2f5d7c1a9b02', scenarioId: 'book-order', scenarioTitle: 'Order confirmation', outcome: 'safe_correct' })]).expect(202);
  assert.deepEqual((await repos.attempts.get('alex', '6f1c1b1e-8d43-4c55-9a0e-2f5d7c1a9b01'))?.tactics, ['urgency', 'suspicious_link']);
  assert.deepEqual((await repos.attempts.get('alex', '6f1c1b1e-8d43-4c55-9a0e-2f5d7c1a9b02'))?.tactics, [], 'no tactics: none stored');
  assert.deepEqual((await progress().expect(200)).body.vulnerability.vulnerableTactics, ['urgency', 'suspicious_link']);
});

test('most improved needs a real gain: accuracy first, then speed', () => {
  const c = (category: string, then: [number, number | null], now: [number, number | null]) =>
    ({ category: category as 'banking', then: { accuracy: then[0], avgDetectionMs: then[1] }, now: { accuracy: now[0], avgDetectionMs: now[1] } });
  assert.equal(mostImproved([]), null);
  assert.equal(mostImproved([c('banking', [100, 5000], [100, 6000]), c('shipping', [100, 4000], [50, 2000])]), null);
  assert.equal(mostImproved([c('banking', [0, 9000], [100, 9000]), c('shipping', [50, 9000], [100, 1000])])?.category, 'banking');
  assert.equal(mostImproved([c('banking', [100, 5000], [100, 4000]), c('shipping', [100, 9000], [100, 3000])])?.category, 'shipping');
  assert.equal(mostImproved([c('banking', [0, 9000], [0, 900])]), null, 'falling for it faster is not an improvement');
});

// ---------- Calls: behaviour derived from the call lifecycle ----------

const scenario: CallScenario = { id: 'courier-customs-fee-1', title: 'Courier customs fee', tactics: ['urgency'], difficulty: 2, callerLabel: 'Courier', systemPrompt: 'x', firstMessage: 'Hello.' };

function callRig(record: (rows: BehaviorEvent[]) => Promise<void> = async () => {}) {
  const rows: BehaviorEvent[] = [];
  const store = new MemoryStore();
  const inner = new MemoryEventSink();
  let notify = () => {};
  const behavior = { record: async (r: BehaviorEvent[]) => { rows.push(...r); notify(); return record(r); } };
  const calls = new CallService(store, new CallBehaviorSink(inner, behavior, store), {
    attempts: fakeRepos().attempts,
    elevenLabs: createElevenLabs({ apiKey: 'test-key', agentId: 'agent_test' }),
    callMaxSeconds: 180,
  });
  const completedRow = () => new Promise<void>((r) => { notify = () => { if (rows.some((x) => x.type === 'scenario_completed')) r(); }; });
  return { calls, rows, inner, completedRow };
}

test('call lifecycle maps to behaviour events; declining is a completed, timed decision', async () => {
  const { calls, rows, inner } = callRig();
  const call = await calls.start('alex', scenario);
  await calls.decline(call.id, 'declined');
  assert.deepEqual(inner.events.map((e) => e.type), ['call.ringing', 'call.declined'], 'the original sink still gets everything');
  assert.deepEqual(rows.map((r) => [r.type, r.outcome]), [['call_received', null], ['call_declined', null], ['scenario_completed', 'declined']]);
  for (const r of rows) {
    assert.deepEqual([r.uid, r.channel, r.attemptId, r.scenarioId, r.scamCategory, r.difficulty], ['alex', 'call', call.id, scenario.id, 'shipping', 'medium']);
    assert.ok(r.responseTimeMs !== null && r.responseTimeMs >= 0 && r.responseTimeMs < 5000);
  }

  const missed = await calls.start('alex', scenario);
  await calls.decline(missed.id, 'missed');
  assert.deepEqual(rows.slice(3).map((r) => [r.type, r.outcome]), [['call_received', null], ['call_missed', null], ['scenario_completed', 'missed']]);

  const abandoned = await calls.start('alex', scenario);
  await calls.abandon(abandoned.id);
  assert.deepEqual(rows.slice(6).map((r) => r.type), ['call_received'], 'abandoned calls are never scored');
});

test('an answered call records answer, end and its analysed outcome', async () => {
  mockOutbound((url) => {
    if (url.includes('/conversation/token')) return json({ token: 't', conversation_id: 'conv_1' });
    return json({ conversation_id: 'conv_1', status: 'done', transcript: [{ role: 'user', message: 'No thanks, I will call the courier myself.', time_in_call_secs: 3 }],
      metadata: { call_duration_secs: 20 }, analysis: { data_collection_results: { challenged_caller: { value: true } } } });
  });
  const { calls, rows, completedRow } = callRig();
  const call = await calls.start('alex', scenario);
  assert.notEqual(await calls.accept(call.id), 'wrong_state');
  const done = completedRow();
  await calls.ended(call.id, 'conv_1');
  await done;
  assert.deepEqual(rows.map((r) => [r.type, r.outcome]), [['call_received', null], ['call_answered', null], ['call_ended', null], ['scenario_completed', 'resisted']]);
  assert.ok(rows.every((r) => r.attemptId === call.id && JSON.stringify(r.metadata) === '{}'), 'no transcript or summary reaches the events');
});

test('a behaviour write failure never breaks the call flow', async () => {
  const { calls, inner } = callRig(async () => { throw new Error('connection refused'); });
  const call = await calls.start('alex', scenario);
  const declined = await calls.decline(call.id, 'declined');
  assert.equal(typeof declined === 'object' && declined.status, 'completed');
  assert.equal(inner.events.length, 2);
});

test('storage is a TimescaleDB hypertable only when the extension and the hypertable both exist; cached, retried after an error', async () => {
  const repoOver = (answers: (boolean | Error)[]) => {
    const asked: string[] = [];
    const db = { async query(sql: string) {
      asked.push(sql);
      const answer = answers.shift();
      if (answer instanceof Error) throw answer;
      return { rows: [{ found: answer }] };
    } };
    return { repo: new BehaviorRepository(db as never), asked };
  };
  const plain = repoOver([false]);
  assert.equal(await plain.repo.storage(), 'postgres');
  assert.equal(plain.asked.length, 1, 'timescaledb_information is never queried without the extension');
  assert.equal(await repoOver([true, false]).repo.storage(), 'postgres');
  const tiger = repoOver([true, true]);
  assert.equal(await tiger.repo.storage(), 'timescale');
  assert.equal(await tiger.repo.storage(), 'timescale');
  assert.equal(tiger.asked.length, 2, 'cached per process');
  const flaky = repoOver([new Error('connection refused'), true, true]);
  await assert.rejects(flaky.repo.storage());
  assert.equal(await flaky.repo.storage(), 'timescale');
});

// ---------- On Postgres (PGlite in tests, a TimescaleDB hypertable on TigerData) ----------

const url = process.env.TEST_DATABASE_URL;
describe('behaviour events and metrics on Postgres', { skip: !url }, () => {
  let db: Database;
  let repo: Repositories;
  before(async () => {
    assert.match(new URL(url!).pathname, /_test$/, 'Use a dedicated test database.');
    db = createDatabase(url!);
    repo = createRepositories(db);
    await migrate(db);
  });
  beforeEach(async () => { await db.query('TRUNCATE behavior_events, training_attempts'); });
  after(async () => { await db?.end(); });

  /** A completed attempt `day` days and `minute` minutes into the history. */
  const done = (uid: string, n: number, outcome: BehaviorEvent['outcome'], category: BehaviorEvent['scamCategory'], ms: number | null, channel: BehaviorEvent['channel'] = 'email'): BehaviorEvent => ({
    at: new Date(Date.parse('2026-10-01T09:00:00Z') + n * 6 * 3600_000).toISOString(), uid, type: 'scenario_completed', channel, scenarioId: `s${n}`,
    attemptId: randomUUID(), scamCategory: category, difficulty: 'easy', outcome, responseTimeMs: ms, metadata: {},
  });

  test('empty history is all nulls and empty lists', async () => {
    assert.deepEqual((await routes(repo).metrics().expect(200)).body,
      { attempts: 0, accuracy: null, reportRate: null, avgDetectionMs: null, trend: null, categories: [], mostImproved: null, timeline: [], recent: [], storage: 'postgres' });
  });

  test('metrics on sample data: accuracy, report rate, detection time, then vs now, categories, timeline', async () => {
    const history = [
      done('alex', 0, 'safe_incorrect', 'shipping', 20_000), // fell for it
      done('alex', 1, 'reported_correct', 'banking', 16_000),
      done('alex', 2, 'safe_incorrect', 'shipping', 14_000), // fell for it again
      done('alex', 3, 'safe_correct', 'banking', 10_000), // genuine, rightly trusted
      done('alex', 4, 'reported_correct', 'shipping', 8000),
      done('alex', 5, 'declined', 'shipping', 3000, 'call'), // detection: time to decline
      done('alex', 6, 'resisted', 'banking', 90_000, 'call'), // answered: no detection time
      done('alex', 7, 'reported_correct', 'shipping', 6000),
    ];
    const noise = [{ ...done('alex', 0, 'error', 'banking', 1000, 'call') }, { ...done('alex', 1, null, 'banking', 500), type: 'link_clicked' as const }];
    const duplicate = { ...history[7], at: new Date(Date.parse(history[7].at) + 1000).toISOString() };
    await repo.behavior.record([...history, ...noise, duplicate, done('sam', 0, 'safe_incorrect', 'workplace', 1000), done('sam', 1, 'safe_incorrect', 'workplace', 1000)]);

    const m = (await routes(repo).metrics().expect(200)).body;
    assert.equal(m.attempts, 8);
    assert.equal(m.accuracy, 75); // 6 of 8
    assert.equal(m.reportRate, 60); // 3 reported of 5 scam messages
    assert.equal(m.avgDetectionMs, Math.round((20_000 + 16_000 + 14_000 + 10_000 + 8000 + 3000 + 6000) / 7));
    // First 4 vs latest 4.
    assert.deepEqual(m.trend, { window: 4, then: { accuracy: 50, avgDetectionMs: 15_000 }, now: { accuracy: 100, avgDetectionMs: Math.round((8000 + 3000 + 6000) / 3) } });
    assert.deepEqual(m.categories, [
      { category: 'shipping', attempts: 5, accuracy: 60, avgDetectionMs: Math.round((20_000 + 14_000 + 8000 + 3000 + 6000) / 5) },
      { category: 'banking', attempts: 3, accuracy: 100, avgDetectionMs: 13_000 },
    ]);
    // Shipping: first 2 (both missed) vs latest 2 (both right).
    assert.deepEqual(m.mostImproved, { category: 'shipping', then: { accuracy: 0, avgDetectionMs: 17_000 }, now: { accuracy: 100, avgDetectionMs: 4500 } });
    assert.deepEqual(m.timeline, [
      { day: '2026-10-01', attempts: 3, correct: 1, avgDetectionMs: Math.round((20_000 + 16_000 + 14_000) / 3) },
      { day: '2026-10-02', attempts: 4, correct: 4, avgDetectionMs: 7000 },
      { day: '2026-10-03', attempts: 1, correct: 1, avgDetectionMs: 6000 },
    ]);
    assert.deepEqual(m.recent.map((r: { correct: boolean; detectionMs: number | null }) => [r.correct, r.detectionMs]),
      [[false, 20_000], [true, 16_000], [false, 14_000], [true, 10_000], [true, 8000], [true, 3000], [true, null], [true, 6000]]);
    assert.equal(m.recent[0].at, history[0].at);

    const sam = (await routes(repo).metrics('sam').expect(200)).body;
    assert.deepEqual([sam.attempts, sam.accuracy, sam.categories.length, sam.trend.window], [2, 0, 1, 1]);
    assert.equal(sam.mostImproved, null);
  });

  test('posted events land in behavior_events and a finished email in training_attempts, once', async () => {
    const { post, metrics } = routes(repo);
    const attemptId = randomUUID();
    await post([event({ attemptId }), event({ attemptId, type: 'sender_inspected' }), event({ attemptId, type: 'link_clicked', metadata: { site: 'x.example' } })]).expect(202);
    await Promise.all([post([completed({ attemptId, tactics: ['urgency', 'fear'] })]).expect(202), post([completed({ attemptId, tactics: ['urgency', 'fear'] })]).expect(202)]);
    await post([event({ attemptId, type: 'debrief_viewed' })], 'sam').expect(202);

    const { rows } = await db.query('SELECT firebase_uid, event_type, scam_category, metadata FROM behavior_events ORDER BY event_time, event_type');
    assert.equal(rows.length, 6);
    assert.deepEqual(rows.filter((r) => r.event_type === 'link_clicked')[0].metadata, { site: 'x.example' });
    assert.equal((await db.query('SELECT count(*)::int AS n FROM training_attempts WHERE id=$1', [attemptId])).rows[0].n, 1);
    assert.deepEqual((await db.query('SELECT tactics FROM training_attempts WHERE id=$1', [attemptId])).rows[0].tactics, ['urgency', 'fear']);
    const m = (await metrics().expect(200)).body;
    assert.deepEqual([m.attempts, m.accuracy, m.reportRate, m.avgDetectionMs, m.trend], [1, 100, 100, 9000, null]);
    assert.equal((await metrics('sam').expect(200)).body.attempts, 0);
  });

  test('a declined call reaches behavior_events through the real app wiring', async () => {
    const store = new MemoryStore();
    const calls = new CallService(store, new CallBehaviorSink(new MemoryEventSink(), repo.behavior, store), {
      attempts: repo.attempts, elevenLabs: createElevenLabs({}), callMaxSeconds: 180,
    });
    const call = await calls.start('alex', scenario);
    await calls.decline(call.id, 'declined');
    const { rows } = await db.query('SELECT event_type, outcome, attempt_id FROM behavior_events ORDER BY event_time, event_type');
    assert.deepEqual(rows.map((r) => [r.event_type, r.outcome]), [['call_received', null], ['call_declined', null], ['scenario_completed', 'declined']]);
    const m = (await routes(repo).metrics().expect(200)).body;
    assert.deepEqual([m.attempts, m.accuracy, m.reportRate, m.categories[0].category], [1, 100, null, 'shipping']);
  });
});
