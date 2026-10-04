import type { DecodedIdToken } from "firebase-admin/auth";
import { fileURLToPath } from "node:url";
import supertest from "supertest";
import { createElevenLabs } from "../app/calls/elevenlabs.ts";
import { CallService } from "../app/calls/service.ts";
import type { VerifyToken } from "../app/http/auth.ts";
import type { Repositories } from "../app/repositories.ts";
import { ScenarioCatalog } from "../app/scenarios/catalog.ts";
import { createApp } from "../app/server.ts";
import type { CallScenario } from "../app/shared/types.ts";
import { MemoryEventSink, type EventSink } from "../app/sim/events.ts";
import { MemoryStore, type SimStore } from "../app/sim/store.ts";
import type { AttemptInput } from "../app/training/attempts.schema.ts";
import { StubProvider } from "../app/texts/provider.ts";
import { TextService } from "../app/texts/service.ts";
import type { User } from "../app/users/users.schema.ts";

export const origin = "http://localhost:5173";

export const identity = (uid: string) =>
  ({
    uid,
    sub: uid,
    aud: "test-project",
    iss: "https://securetoken.google.com/test-project",
    auth_time: 0,
    iat: 0,
    exp: 9999999999,
    firebase: { identities: {}, sign_in_provider: "password" },
    email: `${uid}@example.test`,
    email_verified: true,
  }) as DecodedIdToken;

/**
 * Accepts `valid:<uid>`; anything else fails the way firebase-admin does for a
 * bad token.
 */
export const fakeVerify: VerifyToken = async (token) => {
  if (token.startsWith("valid:")) return identity(token.slice("valid:".length));
  throw Object.assign(new Error("Decoding Firebase ID token failed"), {
    code: "auth/argument-error",
  });
};

// Outbound fetch (ElevenLabs) goes to the current handler; nothing real ever
// leaves the process.
export const realFetch = globalThis.fetch;
type Outbound = (
  url: string,
  init: RequestInit,
) => Response | Promise<Response>;
let outbound: Outbound = (url) => {
  throw new Error(`unexpected outbound request: ${url}`);
};
export const mockOutbound = (handler: Outbound) => {
  outbound = handler;
};
globalThis.fetch = async (input, init = {}) => outbound(String(input), init);

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

/**
 * Same contract as the SQL repositories, kept in memory so route tests run
 * without a database.
 */
export function fakeRepos() {
  const attempts = new Map<string, AttemptInput>();
  const scenarios = new Map<string, { uid: string; scenario: CallScenario }>();
  const generations: { uid: string; at: number }[] = [];
  const messages = new Map<string, { uid: string; scenario: unknown }>();

  const summary = (a: AttemptInput) => ({
    id: a.attemptId,
    channel: a.channel,
    scenarioId: a.scenarioId,
    scenarioTitle: a.scenarioTitle,
    difficulty: a.difficulty,
    scamCategory: a.scamCategory,
    outcome: a.outcome,
    success: a.success,
    tactics: a.tactics,
    completedAt: new Date(a.completedAt).toISOString(),
  });

  return {
    users: {
      async ensureUser(token: DecodedIdToken) {
        return {
          id: token.uid,
          uid: token.uid,
          email: token.email!,
          emailVerified: true,
          name: null,
          phone: null,
          profession: "accountant",
          interests: [],
          onboardingComplete: false,
          createdAt: "",
          updatedAt: "",
        } satisfies User;
      },
      async updateProfile(): Promise<User> {
        throw new Error("unused");
      },
    },
    attempts: {
      async insert(a: AttemptInput) {
        if (attempts.has(a.attemptId)) return false;
        attempts.set(a.attemptId, a);
        return true;
      },
      async list(uid: string, limit: number) {
        return [...attempts.values()]
          .filter((a) => a.firebaseUid === uid)
          .map(summary)
          .sort((a, b) => b.completedAt.localeCompare(a.completedAt))
          .slice(0, limit);
      },
      async get(uid: string, id: string) {
        const a = attempts.get(id);
        return a && a.firebaseUid === uid
          ? {
              ...summary(a),
              signals: a.signals,
              startedAt: a.startedAt,
              durationSecs: a.durationSecs,
              summary: a.summary,
              transcript: a.transcript,
            }
          : null;
      },
    },
    insights: {
      async attemptRows() {
        return [];
      },
      async state() {
        return { cached: null, lastAttemptAt: null };
      },
      async save() {},
      async latestFocus() {
        return [];
      },
    },
    scenarios: {
      async save(uid: string, scenario: CallScenario) {
        scenarios.set(scenario.id, { uid, scenario });
      },
      async get(uid: string, id: string) {
        const stored = scenarios.get(id);
        return stored?.uid === uid ? stored.scenario : null;
      },
      async saveMessage(uid: string, scenario: { id: string }) {
        messages.set(scenario.id, { uid, scenario });
      },
      async getMessage(uid: string, id: string) {
        const stored = messages.get(id);
        return stored?.uid === uid ? stored.scenario : null;
      },
      async claimGeneration(uid: string, perMinute: number, perDay: number) {
        const now = Date.now();
        const mine = generations.filter(
          (g) => g.uid === uid && now - g.at < 86_400_000,
        );
        if (
          mine.length >= perDay ||
          mine.filter((g) => now - g.at < 60_000).length >= perMinute
        ) {
          return false;
        }
        generations.push({ uid, at: now });
        return true;
      },
    },
    // Behaviour events need SQL (tests/behavior.test.ts runs them on Postgres);
    // wrap `record` to observe writes.
    behavior: {
      async record() {},
      async metrics(): Promise<never> {
        throw new Error("unused");
      },
      async storage() {
        return "postgres" as const;
      },
    },
  } satisfies Repositories;
}

/**
 * The simulation services as main.ts builds them (in memory unless given a
 * store), with a test ElevenLabs key unless `elevenLabs: false`.
 */
export function testServices(
  repos: Repositories,
  {
    elevenLabs = true,
    store = new MemoryStore() as SimStore,
    events = new MemoryEventSink() as EventSink,
  } = {},
) {
  const services = {
    // The hand-written scenarios these tests were written against; the app
    // ships the library-built ones.
    catalog: new ScenarioCatalog(
      repos.scenarios,
      fileURLToPath(new URL("./fixtures/scenarios/", import.meta.url)),
    ),
    texts: new TextService(store, events, new StubProvider(), {
      appOrigin: origin,
      followUpSec: 120,
      idleEndSec: 600,
    }),
    calls: new CallService(store, events, {
      attempts: repos.attempts,
      elevenLabs: createElevenLabs(
        elevenLabs ? { apiKey: "test-key", agentId: "agent_test" } : {},
      ),
      callMaxSeconds: 180,
    }),
  };

  return { services, store };
}

/**
 * The whole API with simulation services; `api` calls `/api/comms/*` the way
 * the browser client does.
 */
export function startApp({
  verify = fakeVerify,
  repos = fakeRepos() as Repositories,
  elevenLabs = true,
}: { verify?: VerifyToken; repos?: Repositories; elevenLabs?: boolean } = {}) {
  const { services, store } = testServices(repos, { elevenLabs });
  const app = createApp({ repos, services, origin, verifyToken: verify });

  /**
   * `token: null` sends no Authorization header. POSTs always carry the app
   * Origin and a JSON body.
   */
  const api = async (
    method: "GET" | "POST",
    path: string,
    {
      token = "valid:alice",
      body,
    }: { token?: string | null; body?: unknown } = {},
  ) => {
    let req =
      method === "GET"
        ? supertest(app).get(`/api/comms${path}`)
        : supertest(app).post(`/api/comms${path}`).set("Origin", origin);
    if (token) req = req.set("Authorization", `Bearer ${token}`);
    const res =
      method === "GET" ? await req : await req.send((body ?? {}) as object);
    return { status: res.status, body: res.body, headers: res.headers };
  };

  return { app, api, repos, services, store };
}
