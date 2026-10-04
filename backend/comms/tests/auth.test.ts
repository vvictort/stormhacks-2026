import { startApp } from './harness.ts';
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { firebaseVerifier, type VerifyToken } from '../src/auth.ts';
import { parseConfig } from '../src/config.ts';

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
// Claims that would pass the old decode-only check: right project, a uid, not expired.
const claims = {
  iss: 'https://securetoken.google.com/tellio-test',
  aud: 'tellio-test',
  sub: 'mallory',
  user_id: 'mallory',
  iat: now,
  auth_time: now,
  exp: now + 3600,
};

test('config refuses the dev user in production and needs a Firebase project otherwise', () => {
  assert.throws(
    () => parseConfig({ NODE_ENV: 'production', COMMS_ALLOW_DEV_USER: 'true', FIREBASE_PROJECT_ID: 'p' }),
    /COMMS_ALLOW_DEV_USER/,
  );
  assert.throws(() => parseConfig({ NODE_ENV: 'development' }), /FIREBASE_PROJECT_ID/);
  assert.equal(parseConfig({ FIREBASE_PROJECT_ID: 'p' }).COMMS_ALLOW_DEV_USER, false);
  assert.equal(parseConfig({ COMMS_ALLOW_DEV_USER: 'true' }).COMMS_ALLOW_DEV_USER, true);
});

test('config errors name the variable, never its value', () => {
  assert.throws(
    () => parseConfig({ NODE_ENV: 'production', COMMS_ALLOW_DEV_USER: 'true', INTERNAL_API_TOKEN: 'super-secret-value' }),
    (err: Error) => !err.message.includes('super-secret-value'),
  );
});

test('the real Firebase verifier rejects unsigned and forged tokens offline', async () => {
  const verifyReal = firebaseVerifier('tellio-test');
  const app = await startApp({ verify: verifyReal });
  after(app.close);
  const unsigned = `${b64({ alg: 'none', typ: 'JWT' })}.${b64(claims)}.`;
  const forged = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64(claims)}.${Buffer.from('not-a-signature').toString('base64url')}`;
  const hmac = `${b64({ alg: 'HS256', typ: 'JWT', kid: 'k1' })}.${b64(claims)}.${Buffer.from('sig').toString('base64url')}`;
  for (const token of [unsigned, forged, hmac, 'not.a.jwt', 'garbage']) {
    const res = await app.api('POST', '/calls', { token, body: { scenarioId: 'bank-fraud-dept-otp-1' } });
    assert.equal(res.status, 401, token);
    assert.equal(res.body.error, 'unauthorized');
  }
});

test('a verified token is accepted and its uid is the only identity used', async () => {
  const app = await startApp();
  after(app.close);
  const res = await app.api('POST', '/calls', { token: 'valid:alice', body: { scenarioId: 'bank-fraud-dept-otp-1' } });
  assert.equal(res.status, 201);
  assert.equal(res.body.call.userId, 'alice');
  // Another verified user can't see it.
  assert.equal((await app.api('GET', `/calls/${res.body.callId}`, { token: 'valid:bob' })).status, 404);
  assert.equal((await app.api('GET', `/calls/${res.body.callId}`)).status, 200);
});

test('invalid, expired and malformed tokens are 401', async () => {
  const expired: VerifyToken = async () => {
    throw Object.assign(new Error('Firebase ID token has expired'), { code: 'auth/id-token-expired' });
  };
  const app = await startApp();
  const expiredApp = await startApp({ verify: expired });
  after(app.close);
  after(expiredApp.close);

  const invalid = await app.api('POST', '/calls', { token: 'forged.token.here', body: {} });
  assert.deepEqual([invalid.status, invalid.body.reason], [401, 'invalid_token']);
  const old = await expiredApp.api('POST', '/calls', { token: 'whatever', body: {} });
  assert.deepEqual([old.status, old.body.reason], [401, 'token_expired']);
});

test('the SSE ?access_token= path uses the same verification', async () => {
  const app = await startApp();
  after(app.close);
  const bad = await app.api('GET', '/texts/txt_x/stream?access_token=forged', { token: null });
  assert.deepEqual([bad.status, bad.body.reason], [401, 'invalid_token']);
  // Verified, so it reaches the ownership check.
  assert.equal((await app.api('GET', '/texts/txt_x/stream?access_token=valid:alice', { token: null })).status, 404);
});

test('without the dev user flag there is no anonymous fallback and no dev page', async () => {
  const app = await startApp({ allowDevUser: false });
  after(app.close);
  const res = await app.api('POST', '/calls', { token: null, body: {} });
  assert.deepEqual([res.status, res.body.reason], [401, 'missing_token']);
  assert.equal((await app.api('GET', '/dev/call', { token: null })).status, 404);
});

test('with the dev user flag, token-less requests run as dev-user but bad tokens still fail', async () => {
  const app = await startApp({ allowDevUser: true });
  after(app.close);
  const res = await app.api('POST', '/calls', { token: null, body: {} });
  assert.equal(res.status, 201);
  assert.equal(res.body.call.userId, 'dev-user');
  assert.equal((await app.api('POST', '/calls', { token: 'forged', body: {} })).status, 401);
});
