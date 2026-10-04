import { json, mockOutbound, origin, realFetch, startApp } from "./harness.ts";
import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { after, test } from "node:test";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import type { VerifyToken } from "../app/http/auth.ts";

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
const now = Math.floor(Date.now() / 1000);
// Claims that would pass a decode-only check: right project, a uid, not expired.
const claims = {
  iss: "https://securetoken.google.com/tellio-test",
  aud: "tellio-test",
  sub: "mallory",
  user_id: "mallory",
  email: "mallory@example.test",
  iat: now,
  auth_time: now,
  exp: now + 3600,
};

test("the real Firebase verifier rejects unsigned and forged tokens offline", async () => {
  const firebase = getAuth(
    initializeApp({ projectId: "tellio-test" }, "auth-test"),
  );
  const app = startApp({ verify: (token) => firebase.verifyIdToken(token) });
  const unsigned = `${b64({ alg: "none", typ: "JWT" })}.${b64(claims)}.`;
  const forged = `${b64({ alg: "RS256", typ: "JWT" })}.${b64(claims)}.${Buffer.from("not-a-signature").toString("base64url")}`;
  const hmac = `${b64({ alg: "HS256", typ: "JWT", kid: "k1" })}.${b64(claims)}.${Buffer.from("sig").toString("base64url")}`;
  for (const token of [unsigned, forged, hmac, "not.a.jwt", "garbage"]) {
    const res = await app.api("POST", "/calls", {
      token,
      body: { scenarioId: "bank-fraud-dept-otp-1" },
    });
    assert.deepEqual(
      [res.status, res.body.error.code],
      [401, "INVALID_TOKEN"],
      token,
    );
  }
});

test("a verified token is accepted and its uid is the only identity used", async () => {
  const app = startApp();
  const res = await app.api("POST", "/calls", {
    token: "valid:alice",
    body: { scenarioId: "bank-fraud-dept-otp-1" },
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.call.userId, "alice");
  // Another verified user can't see it.
  assert.equal(
    (await app.api("GET", `/calls/${res.body.callId}`, { token: "valid:bob" }))
      .status,
    404,
  );
  assert.equal((await app.api("GET", `/calls/${res.body.callId}`)).status, 200);
});

test("missing, invalid and expired tokens are 401", async () => {
  const expired: VerifyToken = async () => {
    throw Object.assign(new Error("Firebase ID token has expired"), {
      code: "auth/id-token-expired",
    });
  };
  const app = startApp();
  const expiredApp = startApp({ verify: expired });

  const missing = await app.api("POST", "/calls", { token: null });
  assert.deepEqual(
    [missing.status, missing.body.error.code],
    [401, "UNAUTHENTICATED"],
  );
  const invalid = await app.api("POST", "/calls", {
    token: "forged.token.here",
  });
  assert.deepEqual(
    [invalid.status, invalid.body.error.code],
    [401, "INVALID_TOKEN"],
  );
  const old = await expiredApp.api("POST", "/calls", { token: "whatever" });
  assert.deepEqual([old.status, old.body.error.code], [401, "INVALID_TOKEN"]);
  // The old dev-only call page is gone.
  assert.equal(
    (await app.api("GET", "/dev/call", { token: null })).status,
    404,
  );
});

test("?access_token= is verified the same way and accepted only on the SSE stream", async () => {
  const app = startApp();
  const bad = await app.api("GET", "/texts/txt_x/stream?access_token=forged", {
    token: null,
  });
  assert.deepEqual([bad.status, bad.body.error.code], [401, "INVALID_TOKEN"]);
  // Verified, so it reaches the ownership check.
  assert.equal(
    (
      await app.api("GET", "/texts/txt_x/stream?access_token=valid:alice", {
        token: null,
      })
    ).status,
    404,
  );
  // Everywhere else the query token is ignored.
  assert.equal(
    (
      await app.api("GET", "/texts/txt_x?access_token=valid:alice", {
        token: null,
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await app.api("GET", "/calls/call_x?access_token=valid:alice", {
        token: null,
      })
    ).status,
    401,
  );
});

test("browser writes need the app Origin and JSON; the scenario list and tracked links need no token", async () => {
  const app = startApp();
  const { default: supertest } = await import("supertest");
  const post = () =>
    supertest(app.app)
      .post("/api/comms/calls")
      .set("Authorization", "Bearer valid:alice");
  assert.equal((await post().send({})).status, 403);
  assert.equal(
    (await post().set("Origin", origin).send("x").type("text/plain")).status,
    415,
  );
  // The same dev server under its other loopback name passes the origin check; another port doesn't.
  const plain = (from: string) =>
    post().set("Origin", from).send("x").type("text/plain");
  assert.equal((await plain("http://127.0.0.1:5173")).status, 415);
  assert.equal((await plain("http://localhost:5174")).status, 403);
  assert.equal((await post().set("Origin", origin).send({})).status, 201);

  const list = await app.api("GET", "/scenarios", { token: null });
  assert.equal(list.status, 200);
  assert.deepEqual(
    [
      list.body.scenarios.filter(
        (s: { channel: string }) => s.channel === "call",
      ).length,
      list.body.scenarios.length,
    ],
    [5, 7],
  );
  const link = await supertest(app.app).get("/api/comms/l/unknown");
  assert.deepEqual([link.status, link.text], [404, "This link has expired."]);
});

test("the SSE stream replays the thread through the real middleware, and a tracked link redirects", async () => {
  const app = startApp();
  const server = app.app.listen(0, "127.0.0.1");
  await once(server, "listening");
  after(async () => {
    server.closeAllConnections();
    server.close();
  });
  mockOutbound(() => json({}, 500));

  const started = await app.api("POST", "/texts", {
    body: { scenarioId: "pkg-redelivery-fee-1" },
  });
  assert.equal(started.status, 201);
  assert.equal(
    started.body.streamUrl,
    `/api/comms/texts/${started.body.threadId}/stream`,
  );
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const res = await realFetch(
    `${base}${started.body.streamUrl}?access_token=valid:alice`,
  );
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "text/event-stream");
  assert.equal(res.headers.get("content-encoding"), null);
  const reader = res.body!.getReader();
  let text = "";
  while (!text.includes("event: message")) {
    text += new TextDecoder().decode((await reader.read()).value);
  }
  await reader.cancel();
  assert.match(text, /^retry: 3000/);

  const href = started.body.thread.messages[0].links[0].href as string;
  assert.match(href, /^\/api\/comms\/l\/[\w-]+$/);
  const click = await realFetch(`${base}${href}`, { redirect: "manual" });
  assert.equal(click.status, 302);
  assert.equal(
    click.headers.get("location"),
    `${origin}/caught?sim=${started.body.threadId}`,
  );
});
