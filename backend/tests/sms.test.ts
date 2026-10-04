import assert from "node:assert/strict";
import { test } from "node:test";
import type { DecodedIdToken } from "firebase-admin/auth";
import supertest from "supertest";
import type { Repositories } from "../app/repositories.ts";
import {
  generateSmsScenario,
  SmsScenario,
} from "../app/scenarios/sms-generator.ts";
import { createApp } from "../app/server.ts";
import { fakeRepos, origin, testServices } from "./harness.ts";

const identity = (uid: string) =>
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

const verifyToken = async (token: string) => {
  if (token === "alex" || token === "sam") return identity(token);
  throw Object.assign(new Error("invalid"), { code: "auth/invalid-id-token" });
};

function routes(repos: Repositories = fakeRepos()) {
  const app = createApp({
    repos,
    services: testServices(repos).services,
    origin,
    verifyToken,
  });

  return {
    generate: (user = "alex", body: object = {}) =>
      supertest(app)
        .post("/api/training/sms-scenarios")
        .set("Origin", origin)
        .set("Authorization", `Bearer ${user}`)
        .send(body),
    read: (id: string, user = "alex") =>
      supertest(app)
        .get(`/api/training/sms-scenarios/${id}`)
        .set("Authorization", `Bearer ${user}`),
    app,
  };
}

test("generateSmsScenario returns fallback when no model is configured", async () => {
  const { scenario, source } = await generateSmsScenario({
    difficulty: "medium",
    weakCategories: ["banking"],
  });
  assert.equal(source, "fallback");
  assert.equal(scenario.type, "sms");
  assert.match(scenario.id, /^gen-sms-[0-9a-f-]{36}$/);
  assert.equal(SmsScenario.safeParse(scenario).success, true);
});

test("POST /api/training/sms-scenarios creates a scenario and only the owner can read it", async () => {
  const repos = fakeRepos();
  const { generate, read } = routes(repos);

  const res = await generate("alex").expect(201);
  const { scenario } = res.body;
  assert.match(scenario.id, /^gen-sms-[0-9a-f-]{36}$/);
  assert.equal(scenario.type, "sms");
  assert.equal(SmsScenario.safeParse(scenario).success, true);

  const fetched = await read(scenario.id, "alex").expect(200);
  assert.equal(fetched.body.id, scenario.id);

  await read(scenario.id, "sam").expect(404);
  await read("gen-sms-not-a-uuid", "alex").expect(404);
});

test("POST /api/training/sms-scenarios enforces rate limiting", async () => {
  const { generate } = routes();
  for (let i = 0; i < 6; i++) {
    await generate().expect(201);
  }
  await generate().expect(429);
});
