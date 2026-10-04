import { fakeRepos, json, mockOutbound, origin, startApp, testServices } from './harness.ts';
import supertest from 'supertest';
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { trainingAttempt } from '../app/calls/attempt.ts';
import { toTraining } from '../app/calls/outcome.ts';
import type { Repositories } from '../app/repositories.ts';
import type { CallRecord } from '../app/shared/types.ts';
import type { AttemptInput } from '../app/training/attempts.schema.ts';

const ELEVENLABS = 'https://api.elevenlabs.io';

/** ElevenLabs stub: issues tokens (optionally with a conversation id) and serves finished conversations. */
function elevenLabs(url: string, { tokenConversationId, conversation }: { tokenConversationId?: string; conversation?: object } = {}) {
  if (url.startsWith(`${ELEVENLABS}/v1/convai/conversation/token`)) {
    return json({ token: 'webrtc-token', ...(tokenConversationId ? { conversation_id: tokenConversationId } : {}) });
  }
  const id = /\/v1\/convai\/conversations\/([^/?]+)/.exec(url)?.[1];
  if (url.startsWith(ELEVENLABS) && id) {
    return json(conversation ? { conversation_id: id, ...conversation } : {
      conversation_id: id,
      status: 'done',
      transcript: [
        { role: 'agent', message: 'Please read me the code we just sent.', time_in_call_secs: 2 },
        { role: 'user', message: 'Sure, it is 123456, and my email is me@example.com', time_in_call_secs: 9 },
      ],
      metadata: { call_duration_secs: 42 },
      analysis: {
        transcript_summary: 'The user read out 654321.',
        data_collection_results: { shared_otp: { value: true, rationale: 'said 123456' } },
      },
    });
  }
  return null;
}

beforeEach(() => mockOutbound((url) => elevenLabs(url) ?? json({ error: 'unexpected' }, 500)));

/** Repositories whose attempt inserts are recorded, resolving `saved` on each one. */
function recordingRepos() {
  const repos = fakeRepos();
  const inserted: AttemptInput[] = [];
  let notify = () => {};
  const insert = repos.attempts.insert;
  repos.attempts.insert = async (a) => { inserted.push(a); notify(); return insert(a); };
  const nextSave = () => new Promise<void>((r) => { notify = r; });
  return { repos, inserted, nextSave };
}

/** Rings a call and accepts it, returning its id. */
async function inCall(app: ReturnType<typeof startApp>, tokenConversationId?: string) {
  mockOutbound((url) => elevenLabs(url, { tokenConversationId }) ?? json({}, 500));
  const { body } = await app.api('POST', '/calls', { body: { scenarioId: 'bank-fraud-dept-otp-1' } });
  const accepted = await app.api('POST', `/calls/${body.callId}/accept`);
  assert.equal(accepted.status, 200);
  return body.callId as string;
}

test('unknown scenario ids are 404 scenario_not_found', async () => {
  const app = startApp();
  for (const scenarioId of ['nope', 'gen-abc']) {
    const res = await app.api('POST', '/calls', { body: { scenarioId } });
    assert.deepEqual([res.status, res.body.error.code], [404, 'scenario_not_found'], scenarioId);
  }
  assert.equal((await app.api('POST', '/texts', { body: { scenarioId: 'nope' } })).status, 404);
});

test('a client-supplied scenario (or any extra key) is a 400', async () => {
  const app = startApp();
  const scenario = { id: 'x', title: 'x', tactics: ['urgency'], difficulty: 1, callerLabel: 'x', systemPrompt: 'x', firstMessage: 'x' };
  for (const path of ['/calls', '/texts']) {
    assert.equal((await app.api('POST', path, { body: { scenario } })).status, 400, path);
    assert.equal((await app.api('POST', path, { body: { scenarioId: 'bank-fraud-dept-otp-1', scenario } })).status, 400, path);
    assert.equal((await app.api('POST', path, { body: { userId: 'someone-else' } })).status, 400, path);
  }
});

test('generated scenarios resolve only for their owner', async () => {
  const app = startApp();
  const generated = { id: 'gen-1', title: 'Generated', tactics: ['urgency'], difficulty: 3, callerLabel: 'Someone', systemPrompt: 'Be a scammer.', firstMessage: 'Hello.' } as const;
  await app.repos.scenarios.save('alice', { ...generated, tactics: [...generated.tactics] }, 'fallback');
  const res = await app.api('POST', '/calls', { token: 'valid:alice', body: { scenarioId: 'gen-1' } });
  assert.equal(res.status, 201);
  assert.equal(res.body.call.scenario.id, 'gen-1');
  const other = await app.api('POST', '/calls', { token: 'valid:bob', body: { scenarioId: 'gen-1' } });
  assert.deepEqual([other.status, other.body.error.code], [404, 'scenario_not_found']);
});

test('a generated gen-call- scenario runs end to end with server-owned outcomes', async () => {
  const { repos, inserted, nextSave } = recordingRepos();
  const app = startApp({ repos });
  const generated = await supertest(app.app).post('/api/training/call-scenarios').set('Origin', origin).set('Authorization', 'Bearer valid:alice').send({});
  const { scenarioId } = generated.body;
  assert.match(scenarioId, /^gen-call-/);

  /** Rings the generated call, answers it, and hangs up after a conversation that went like `conversation`. */
  const run = async (conversation?: object) => {
    mockOutbound((url) => elevenLabs(url, { tokenConversationId: 'conv_gen', conversation }) ?? json({}, 500));
    const { callId, call } = (await app.api('POST', '/calls', { body: { scenarioId } })).body;
    assert.equal(call.scenario.id, scenarioId);
    assert.equal((await app.api('POST', `/calls/${callId}/accept`)).status, 200);
    const saved = nextSave();
    assert.equal((await app.api('POST', `/calls/${callId}/ended`, { body: { conversationId: 'conv_gen' } })).status, 202);
    await saved;
    return (await app.api('GET', `/calls/${callId}`)).body as CallRecord;
  };
  const done = (results: Record<string, boolean>) => ({
    status: 'done',
    transcript: [{ role: 'agent', message: 'Read me the code.', time_in_call_secs: 2 }, { role: 'user', message: 'No, I will call IT myself.', time_in_call_secs: 6 }],
    analysis: { transcript_summary: 'The user refused.', data_collection_results: Object.fromEntries(Object.entries(results).map(([k, value]) => [k, { value }])) },
  });

  const resisted = await run(done({ shared_otp: false, challenged_caller: true, asked_to_verify: true }));
  assert.deepEqual(resisted.training, { outcome: 'resisted', success: true, difficulty: 'easy' });
  assert.deepEqual(resisted.signals.sort(), ['asked_to_verify', 'challenged', 'engaged']);

  const compromised = await run(done({ shared_payment_info: false, agreed_to_action: true, challenged_caller: true }));
  assert.deepEqual(compromised.training, { outcome: 'compromised', success: false, difficulty: 'easy' });

  const failed = await run({ status: 'failed', transcript: [], analysis: null });
  assert.deepEqual([failed.training, failed.error], [{ outcome: 'error', success: null, difficulty: 'easy' }, 'ElevenLabs conversation failed']);

  const { callId } = (await app.api('POST', '/calls', { body: { scenarioId } })).body;
  const saved = nextSave();
  assert.deepEqual((await app.api('POST', `/calls/${callId}/decline`)).body.training, { outcome: 'declined', success: true, difficulty: 'easy' });
  await saved;

  assert.deepEqual(inserted.map((a) => [a.scenarioId, a.outcome, a.success, a.scamCategory]), [
    [scenarioId, 'resisted', true, 'workplace'],
    [scenarioId, 'compromised', false, 'workplace'],
    [scenarioId, 'error', null, 'workplace'],
    [scenarioId, 'declined', true, 'workplace'],
  ]);
});

test('the token conversation id is bound on accept; a different one is 409', async () => {
  const app = startApp();
  const callId = await inCall(app, 'conv_token');
  assert.equal((await app.api('POST', `/calls/${callId}/connected`, { body: { conversationId: 'conv_token' } })).status, 200);
  const res = await app.api('POST', `/calls/${callId}/connected`, { body: { conversationId: 'conv_other' } });
  assert.deepEqual([res.status, res.body.error.code], [409, 'conversation_mismatch']);
});

test('/connected binds the first id; mismatched /ended is 409 and the call stays in_call', async () => {
  const app = startApp();
  const ringing = (await app.api('POST', '/calls', { body: { scenarioId: 'bank-fraud-dept-otp-1' } })).body.callId;
  const early = await app.api('POST', `/calls/${ringing}/connected`, { body: { conversationId: 'conv_A' } });
  assert.deepEqual([early.status, early.body.error.code], [409, 'not_in_call']);

  const callId = await inCall(app);
  const bound = await app.api('POST', `/calls/${callId}/connected`, { body: { conversationId: 'conv_A' } });
  assert.equal(bound.status, 200);
  assert.equal(bound.body.conversationId, 'conv_A');
  assert.equal((await app.api('POST', `/calls/${callId}/connected`, { body: { conversationId: 'conv_B' } })).status, 409);

  const wrong = await app.api('POST', `/calls/${callId}/ended`, { body: { conversationId: 'conv_B' } });
  assert.deepEqual([wrong.status, wrong.body.error.code], [409, 'conversation_mismatch']);
  assert.equal((await app.api('GET', `/calls/${callId}`)).body.status, 'in_call');

  assert.equal((await app.api('POST', `/calls/${callId}/ended`, { body: { conversationId: 'conv_A' } })).status, 202);
});

test('canonical outcome mapping matches the contract table', () => {
  const table = [
    ['compromised', 'compromised', false],
    ['resisted', 'resisted', true],
    ['reported', 'resisted', true],
    ['declined', 'declined', true],
    ['ignored', 'missed', true],
    ['missed', 'missed', true],
    ['error', 'error', null],
  ] as const;
  for (const [raw, outcome, success] of table) {
    assert.deepEqual(toTraining(raw, 2), { outcome, success, difficulty: 'medium' }, raw);
  }
  assert.equal(toTraining('resisted', 1).difficulty, 'easy');
  assert.equal(toTraining('resisted', 3).difficulty, 'hard');
});

test('an analysed call is saved as a training attempt with a redacted transcript', async () => {
  const { repos, inserted, nextSave } = recordingRepos();
  const app = startApp({ repos });
  const callId = await inCall(app, 'conv_1');

  const saved = nextSave();
  assert.equal((await app.api('POST', `/calls/${callId}/ended`, { body: { conversationId: 'conv_1' } })).status, 202);
  await saved;

  const [body] = inserted;
  assert.equal(body.attemptId, callId);
  assert.equal(body.firebaseUid, 'alice');
  assert.equal(body.channel, 'call');
  assert.equal(body.scenarioId, 'bank-fraud-dept-otp-1');
  assert.equal(body.difficulty, 'medium');
  assert.deepEqual([body.outcome, body.success], ['compromised', false]);
  assert.ok(body.signals.includes('shared_code'));
  assert.equal(body.durationSecs, 42);
  const text = JSON.stringify(body);
  for (const secret of ['123456', '654321', 'me@example.com']) assert.ok(!text.includes(secret), secret);
  assert.match(body.transcript[1].message, /\[NUMBER:6 digits\].*\[EMAIL\]/);

  const record = (await app.api('GET', `/calls/${callId}`)).body as CallRecord;
  assert.deepEqual(record.training, { outcome: 'compromised', success: false, difficulty: 'medium' });
  // The stored attempt is what the debrief reads back.
  assert.equal((await repos.attempts.get('alice', callId))?.outcome, 'compromised');
});

test('a declined call carries its training result and is saved as a success', async () => {
  const { repos, inserted, nextSave } = recordingRepos();
  const app = startApp({ repos });
  const { body } = await app.api('POST', '/calls', { body: { scenarioId: 'courier-customs-fee-1' } });
  const saved = nextSave();
  const declined = await app.api('POST', `/calls/${body.callId}/decline`, { body: { reason: 'declined' } });
  assert.deepEqual(declined.body.training, { outcome: 'declined', success: true, difficulty: 'easy' });
  await saved;
  assert.equal(inserted.length, 1);
  assert.deepEqual([inserted[0].outcome, inserted[0].success, inserted[0].transcript], ['declined', true, []]);
});

test('a database error while saving is logged and never breaks the call', async () => {
  const repos = fakeRepos();
  let failed!: () => void;
  const attempted = new Promise<void>((r) => { failed = r; });
  repos.attempts.insert = async () => { failed(); throw new Error('connection refused'); };
  const app = startApp({ repos });
  const { body } = await app.api('POST', '/calls', { body: { scenarioId: 'courier-customs-fee-1' } });
  const missed = await app.api('POST', `/calls/${body.callId}/decline`, { body: { reason: 'missed' } });
  assert.equal(missed.status, 200);
  assert.deepEqual(missed.body.training, { outcome: 'missed', success: true, difficulty: 'easy' });
  await attempted;
  assert.equal((await app.api('GET', `/calls/${body.callId}`)).body.status, 'completed');
});

test('without ElevenLabs keys calls still ring and score; only accept is 503 elevenlabs_not_configured', async () => {
  mockOutbound((url) => { throw new Error(`unexpected outbound request: ${url}`); });
  const { repos, inserted, nextSave } = recordingRepos();
  const app = startApp({ repos, elevenLabs: false });
  const ringing = (await app.api('POST', '/calls', { body: { scenarioId: 'bank-fraud-dept-otp-1' } })).body.callId;
  const accept = await app.api('POST', `/calls/${ringing}/accept`);
  assert.deepEqual([accept.status, accept.body.error.code], [503, 'elevenlabs_not_configured']);
  assert.equal((await app.api('GET', `/calls/${ringing}`)).body.status, 'ringing');
  const saved = nextSave();
  assert.equal((await app.api('POST', `/calls/${ringing}/decline`, { body: { reason: 'missed' } })).status, 200);
  await saved;
  assert.equal(inserted[0].outcome, 'missed');
});

test('abandoning a ringing call completes it unscored and saves nothing', async () => {
  const { repos, inserted } = recordingRepos();
  const app = startApp({ repos });
  const { body } = await app.api('POST', '/calls', { body: { scenarioId: 'bank-fraud-dept-otp-1' } });

  assert.equal((await app.api('POST', `/calls/${body.callId}/abandon`, { token: 'valid:bob' })).status, 404, 'owner only');
  const abandoned = await app.api('POST', `/calls/${body.callId}/abandon`);
  assert.equal(abandoned.status, 200);
  assert.equal(abandoned.body.status, 'completed');
  assert.equal(abandoned.body.error, 'abandoned');
  assert.deepEqual(abandoned.body.training, { outcome: 'error', success: null, difficulty: 'medium' });
  // Over: it can't be abandoned again, declined into a scored result, or answered.
  for (const action of ['abandon', 'decline', 'accept']) {
    const res = await app.api('POST', `/calls/${body.callId}/${action}`);
    assert.deepEqual([res.status, res.body.error.code], [409, 'not_ringing'], action);
  }
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(inserted, [], 'nothing is saved');

  // A call already answered isn't ringing either.
  const answered = await inCall(app);
  assert.deepEqual((await app.api('POST', `/calls/${answered}/abandon`)).body.error.code, 'not_ringing');
});

test('the sweeper abandons a stale ringing call instead of saving a missed attempt', async () => {
  const { repos, inserted } = recordingRepos();
  const { services, store } = testServices(repos as Repositories);
  const call = await services.calls.start('alice', (await services.catalog.pickCall('courier-customs-fee-1', 'alice'))!);
  await store.updateCall(call.id, (c) => { c.createdAt = new Date(Date.now() - 3 * 60_000).toISOString(); });

  await services.calls.sweep();
  const swept = (await services.calls.get(call.id))!;
  assert.deepEqual([swept.status, swept.error, swept.training?.success], ['completed', 'abandoned', null]);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(inserted.length, 0);
});

test('attempts are clipped to the schema limits instead of being rejected', () => {
  const long = 'x'.repeat(5000);
  const call = {
    id: 'call_long', userId: 'u', status: 'completed', signals: ['engaged'],
    createdAt: '2026-10-03T10:00:00.000Z', completedAt: '2026-10-03T10:02:00.000Z', durationSecs: 120,
    scenario: { id: 'gen-1', title: 't'.repeat(300), tactics: ['urgency'], difficulty: 1 },
    summary: long,
    transcript: [{ role: 'agent', message: long, timeInCallSecs: 1 }, { role: 'user', message: 'short', timeInCallSecs: 2 }, ...Array.from({ length: 250 }, () => ({ role: 'user', message: long, timeInCallSecs: 3 }))],
    training: toTraining('resisted', 1),
  } as unknown as CallRecord;
  const body = trainingAttempt(call);
  assert.equal(body.summary!.length, 4000);
  assert.ok(body.summary!.endsWith('…'));
  assert.equal(body.transcript.length, 200);
  assert.equal(body.transcript[0]!.message.length, 4000);
  assert.equal(body.transcript[1]!.message, 'short');
  assert.equal(body.scenarioTitle.length, 200);
  assert.equal(call.summary, long, 'the stored record is untouched');
});
