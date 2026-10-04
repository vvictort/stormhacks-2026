import './env.ts';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAuth, type VerifyToken } from '../src/auth.ts';
import { backendClient, type Backend } from '../src/backend.ts';
import { CallService } from '../src/calls/service.ts';
import { JsonlEventSink } from '../src/events.ts';
import { StubProvider } from '../src/provider.ts';
import { createApp } from '../src/router.ts';
import { SampleCatalog } from '../src/samples.ts';
import { JsonFileStore } from '../src/store.ts';
import { TextService } from '../src/texts/service.ts';

export const BACKEND_URL = 'http://backend.test';
export const INTERNAL_TOKEN = 'test-internal-token';

/** Accepts `valid:<uid>`; anything else fails the way firebase-admin does for a bad token. */
export const fakeVerify: VerifyToken = async (token) => {
  if (token.startsWith('valid:')) return { uid: token.slice('valid:'.length) };
  throw Object.assign(new Error('Decoding Firebase ID token failed'), { code: 'auth/argument-error' });
};

// Outbound fetch (ElevenLabs, backend) goes to the current handler; nothing real ever leaves the process.
const realFetch = globalThis.fetch;
type Outbound = (url: string, init: RequestInit) => Response | Promise<Response>;
let outbound: Outbound = (url) => {
  throw new Error(`unexpected outbound request: ${url}`);
};
export const mockOutbound = (handler: Outbound) => {
  outbound = handler;
};
globalThis.fetch = async (input, init = {}) => outbound(String(input), init);

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

interface AppOptions {
  allowDevUser?: boolean;
  verify?: VerifyToken;
  backend?: Backend;
}

export async function startApp({ allowDevUser = false, verify = fakeVerify, backend = backendClient(BACKEND_URL, INTERNAL_TOKEN, 0) }: AppOptions = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'comms-test-'));
  const store = new JsonFileStore(dir);
  const events = new JsonlEventSink(dir);
  const app = createApp({
    texts: new TextService(store, events, new StubProvider()),
    calls: new CallService(store, events, backend),
    samples: new SampleCatalog(),
    backend,
    getUserId: createAuth({ verify, allowDevUser }),
    devPages: allowDevUser,
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/comms`;

  /** `token: null` sends no Authorization header. */
  const api = async (method: string, path: string, { token = 'valid:alice', body }: { token?: string | null; body?: unknown } = {}) => {
    const headers: Record<string, string> = {};
    if (token) headers.authorization = `Bearer ${token}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await realFetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: (await res.json().catch(() => null)) as any };
  };

  const close = async () => {
    server.closeAllConnections();
    server.close();
    // Let in-flight event writes land before the temp dir goes.
    await new Promise((r) => setTimeout(r, 20));
    store.flush();
    rmSync(dir, { recursive: true, force: true });
  };
  return { api, close };
}
