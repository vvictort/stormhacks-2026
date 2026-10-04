import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import express from 'express';
import { initializeApp } from 'firebase-admin/app';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { users } from '../../app/api/users.ts';
import { errorHandler } from '../../app/core/errors.ts';
import { requireAuth } from '../../app/core/security.ts';

initializeApp({ projectId: 'test-project' });

// 'good' verifies as alex, 'down' fails like an unreachable key endpoint, anything else is a bad token.
const fakeVerify = async (idToken: string) => {
  if (idToken === 'good') return { uid: 'alex', email: 'alex@example.com', email_verified: true } as DecodedIdToken;
  if (idToken === 'down') throw Object.assign(new Error('network'), { code: 'app/network-error' });
  throw Object.assign(new Error('bad'), { code: 'auth/argument-error' });
};

function serve(verify?: Parameters<typeof requireAuth>[0]) {
  const app = express();
  app.use('/api', requireAuth(verify));
  app.use('/api/users', users);
  app.use(errorHandler);
  return app.listen(0);
}

const servers = { fake: serve(fakeVerify), firebase: serve() };
const base = (server: ReturnType<typeof serve>) => `http://localhost:${(server.address() as AddressInfo).port}/api`;
const get = (path: string, token?: string, server = servers.fake) =>
  fetch(base(server) + path, { headers: token ? { authorization: `Bearer ${token}` } : {} });

before(() => {
  console.error = () => {}; // errorHandler logs the 'down' case on purpose
});
after(() => Object.values(servers).forEach((s) => s.close()));

test('requests without a bearer token are rejected', async () => {
  assert.equal((await get('/users/me')).status, 401);
  const basic = await fetch(base(servers.fake) + '/users/me', { headers: { authorization: 'Basic good' } });
  assert.equal(basic.status, 401);
});

test('a verified token reaches the route with the caller attached', async () => {
  const res = await get('/users/me', 'good');
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { uid: 'alex', email: 'alex@example.com', emailVerified: true, name: null, picture: null });
});

test('the bearer scheme is case-insensitive', async () => {
  const res = await fetch(base(servers.fake) + '/users/me', { headers: { authorization: 'bearer good' } });
  assert.equal(res.status, 200);
});

test('invalid tokens are 401, but verifier outages are 500 so clients do not sign out', async () => {
  assert.equal((await get('/users/me', 'forged')).status, 401);
  assert.equal((await get('/users/me', 'down')).status, 500);
});

test('the real Firebase verifier rejects a forged token as 401', async () => {
  assert.equal((await get('/users/me', 'not.a.jwt', servers.firebase)).status, 401);
});

test('users can read their own record but not anyone else’s', async () => {
  assert.equal((await get('/users/alex', 'good')).status, 200);
  assert.equal((await get('/users/sam', 'good')).status, 403);
});
