import { BACKEND_URL, INTERNAL_TOKEN, json, mockOutbound, startApp } from './harness.ts';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, beforeEach, test } from 'node:test';
import { backendClient, trainingAttempt } from '../src/backend.ts';
import { toTraining } from '../src/calls/outcome.ts';
import { CallService } from '../src/calls/service.ts';
import { JsonlEventSink } from '../src/events.ts';
import { SampleCatalog } from '../src/scenarios/catalog.ts';
import { JsonFileStore } from '../src/store.ts';
import type { CallRecord } from '../src/types.ts';

const ELEVENLABS = 'https://api.elevenlabs.io';

/** ElevenLabs stub: issues tokens (optionally with a conversation id) and serves finished conversations. */
function elevenLabs(url: string, { tokenConversationId }: { tokenConversationId?: string } = {}) {
  if (url.startsWith(`${ELEVENLABS}/v1/convai/conversation/token`)) {
    return json({ token: 'webrtc-token', ...(tokenConversationId ? { conversation_id: tokenConversationId } : {}) });
  }
  const id = /\/v1\/convai\/conversations\/([^/?]+)/.exec(url)?.[1];
  if (url.startsWith(ELEVENLABS) && id) {
    return json({
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

/** Rings a call and accepts it, returning its id. */
async function inCall(app: Awaited<ReturnType<typeof startApp>>, tokenConversationId?: string) {
  mockOutbound((url) => elevenLabs(url, { tokenConversationId }) ?? json({}, 500));
  const { body } = await app.api('POST', '/calls', { body: { scenarioId: 'bank-fraud-dept-otp-1' } });
  const accepted = await app.api('POST', `/calls/${body.callId}/accept`);
  assert.equal(accepted.status, 200);
  return body.callId as string;
}

test('unknown scenario ids are 404 scenario_not_found', async () => {
  const app = await startApp({ backend: backendClient(undefined, undefined) });
  after(app.close);
  for (const scenarioId of ['nope', 'gen-abc']) {
    const res = await app.api('POST', '/calls', { body: { scenarioId } });
    assert.deepEqual([res.status, res.body.error], [404, 'scenario_not_found'], scenarioId);
  }
  assert.equal((await app.api('POST', '/texts', { body: { scenarioId: 'nope' } })).status, 404);
});

test('a client-supplied scenario (or any extra key) is a 400', async () => {
  const app = await startApp();
  after(app.close);
  const scenario = { id: 'x', title: 'x', tactics: ['urgency'], difficulty: 1, callerLabel: 'x', systemPrompt: 'x', firstMessage: 'x' };
  for (const path of ['/calls', '/texts']) {
    assert.equal((await app.api('POST', path, { body: { scenario } })).status, 400, path);
    assert.equal((await app.api('POST', path, { body: { scenarioId: 'bank-fraud-dept-otp-1', scenario } })).status, 400, path);
    assert.equal((await app.api('POST', path, { body: { userId: 'someone-else' } })).status, 400, path);
  }
});

test('generated scenarios resolve through the backend for the verified uid', async () => {
  const app = await startApp();
  after(app.close);
  const generated = {
    id: 'gen-1',
    title: 'Generated',
    tactics: ['urgency'],
    difficulty: 3,
    callerLabel: 'Someone',
    systemPrompt: 'Be a scammer.',
    firstMessage: 'Hello.',
  };
  const seen: { url: string; token: string | null }[] = [];
  mockOutbound((url, init) => {
    seen.push({ url, token: new Headers(init.headers).get('x-internal-token') });
    return url.includes('/gen-1?') ? json(generated) : json({ error: 'not_found' }, 404);
  });
  const res = await app.api('POST', '/calls', { token: 'valid:alice', body: { scenarioId: 'gen-1' } });
  assert.equal(res.status, 201);
  assert.equal(res.body.call.scenario.id, 'gen-1');
  assert.deepEqual(seen[0], { url: `${BACKEND_URL}/api/internal/call-scenarios/gen-1?uid=alice`, token: INTERNAL_TOKEN });
  assert.equal((await app.api('POST', '/calls', { body: { scenarioId: 'gen-other' } })).status, 404);
});

test('the token conversation id is bound on accept; a different one is 409', async () => {
  const app = await startApp();
  after(app.close);
  const callId = await inCall(app, 'conv_token');
  assert.equal((await app.api('POST', `/calls/${callId}/connected`, { body: { conversationId: 'conv_token' } })).status, 200);
  const res = await app.api('POST', `/calls/${callId}/connected`, { body: { conversationId: 'conv_other' } });
  assert.deepEqual([res.status, res.body.error], [409, 'conversation_mismatch']);
});

test('/connected binds the first id; mismatched /ended is 409 and the call stays in_call', async () => {
  const app = await startApp();
  after(app.close);
  const callId = await inCall(app);

  const bound = await app.api('POST', `/calls/${callId}/connected`, { body: { conversationId: 'conv_A' } });
  assert.equal(bound.status, 200);
  assert.equal(bound.body.conversationId, 'conv_A');
  assert.equal((await app.api('POST', `/calls/${callId}/connected`, { body: { conversationId: 'conv_B' } })).status, 409);

  const wrong = await app.api('POST', `/calls/${callId}/ended`, { body: { conversationId: 'conv_B' } });
  assert.deepEqual([wrong.status, wrong.body.error], [409, 'conversation_mismatch']);
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
  for (const [comms, outcome, success] of table) {
    assert.deepEqual(toTraining(comms, 2), { outcome, success, difficulty: 'medium' }, comms);
  }
  assert.equal(toTraining('resisted', 1).difficulty, 'easy');
  assert.equal(toTraining('resisted', 3).difficulty, 'hard');
});

test('an analysed call posts the training attempt with the secret header and a redacted transcript', async () => {
  const app = await startApp();
  after(app.close);
  const callId = await inCall(app, 'conv_1');

  let resolvePosted!: (v: { headers: Headers; body: any }) => void;
  const posted = new Promise<{ headers: Headers; body: any }>((r) => (resolvePosted = r));
  mockOutbound((url, init) => {
    if (url === `${BACKEND_URL}/api/internal/training-attempts`) {
      resolvePosted({ headers: new Headers(init.headers), body: JSON.parse(String(init.body)) });
      return json({ id: 'a1' }, 201);
    }
    return elevenLabs(url) ?? json({}, 500);
  });
  assert.equal((await app.api('POST', `/calls/${callId}/ended`, { body: { conversationId: 'conv_1' } })).status, 202);

  const { headers, body } = await posted;
  assert.equal(headers.get('x-internal-token'), INTERNAL_TOKEN);
  assert.equal(headers.get('content-type'), 'application/json');
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
});

test('a declined call carries its training result and is posted too', async () => {
  const app = await startApp();
  after(app.close);
  const bodies: any[] = [];
  mockOutbound((url, init) => (bodies.push({ url, body: JSON.parse(String(init.body)) }), json({ id: 'a2' }, 201)));
  const { body } = await app.api('POST', '/calls', { body: { scenarioId: 'courier-customs-fee-1' } });
  const declined = await app.api('POST', `/calls/${body.callId}/decline`, { body: { reason: 'declined' } });
  assert.deepEqual(declined.body.training, { outcome: 'declined', success: true, difficulty: 'easy' });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(bodies.length, 1);
  assert.deepEqual([bodies[0].body.outcome, bodies[0].body.transcript], ['declined', []]);
});

test('posting retries once on a server error, and is skipped when unconfigured', async () => {
  const call = { id: 'call_x', userId: 'u', scenario: { id: 's', title: 't', tactics: ['urgency'], difficulty: 1 }, status: 'completed', createdAt: 'a', completedAt: 'b', signals: [], training: toTraining('missed', 1) } as unknown as CallRecord;
  let calls = 0;
  mockOutbound(() => (++calls === 1 ? json({}, 503) : json({ id: 'a3' }, 201)));
  await backendClient(BACKEND_URL, INTERNAL_TOKEN, 0).postAttempt(call);
  assert.equal(calls, 2);

  calls = 0;
  await backendClient(undefined, INTERNAL_TOKEN).postAttempt(call);
  await backendClient(BACKEND_URL, undefined).postAttempt(call);
  assert.equal(calls, 0);
});

test('abandoning a ringing call completes it unscored and posts nothing', async () => {
  const app = await startApp();
  after(app.close);
  const posted: string[] = [];
  mockOutbound((url) => (posted.push(url), elevenLabs(url) ?? json({ id: 'x' }, 201)));
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
    assert.deepEqual([res.status, res.body.error], [409, 'not_ringing'], action);
  }
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(posted.filter((url) => url.startsWith(BACKEND_URL)), [], 'nothing reaches the backend');

  // A call already answered isn't ringing either.
  const answered = await inCall(app);
  assert.deepEqual((await app.api('POST', `/calls/${answered}/abandon`)).body.error, 'not_ringing');
});

test('the sweeper abandons a stale ringing call instead of posting a missed attempt', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'comms-sweep-'));
  after(() => rmSync(dir, { recursive: true, force: true }));
  const store = new JsonFileStore(dir);
  const posted: CallRecord[] = [];
  const calls = new CallService(store, new JsonlEventSink(dir), { postAttempt: async (call) => void posted.push(call) });
  const call = await calls.start('alice', new SampleCatalog().pickCall('courier-customs-fee-1')!);
  await store.updateCall(call.id, (c) => { c.createdAt = new Date(Date.now() - 3 * 60_000).toISOString(); });

  await calls.sweep();
  const swept = (await calls.get(call.id))!;
  assert.deepEqual([swept.status, swept.error, swept.training?.success], ['completed', 'abandoned', null]);
  assert.equal(posted.length, 0);
  store.flush();
});

test('attempt payloads are clipped to the backend limits instead of being rejected', () => {
  const long = 'x'.repeat(5000);
  const call = {
    id: 'call_long', userId: 'u', status: 'completed', createdAt: 'a', completedAt: 'b', signals: [],
    scenario: { id: 'gen-1', title: 't'.repeat(300), tactics: ['urgency'], difficulty: 1 },
    summary: long,
    transcript: [{ role: 'agent', message: long, timeInCallSecs: 1 }, { role: 'user', message: 'short', timeInCallSecs: 2 }],
    training: toTraining('resisted', 1),
  } as unknown as CallRecord;
  const body = trainingAttempt(call);
  assert.equal(body.summary!.length, 4000);
  assert.ok(body.summary!.endsWith('…'));
  assert.equal(body.transcript[0]!.message.length, 4000);
  assert.equal(body.transcript[1]!.message, 'short');
  assert.equal(body.scenarioTitle.length, 200);
  assert.equal(call.summary, long, 'the stored record is untouched');
});
