import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, describe, test } from "node:test";
import supertest from "supertest";
import { createDatabase, type Database } from "../app/db/database.ts";
import { migrate } from "../app/db/migrate.ts";
import { createRepositories, type Repositories } from "../app/repositories.ts";
import { createApp } from "../app/server.ts";
import { fakeRepos, fakeVerify, origin, testServices } from "./harness.ts";

/** The app as the browser sees it: every request as `valid:<uid>`, POSTs from the app origin. */
function client(repos: Repositories, uid = "jo") {
  const app = createApp({
    repos,
    services: testServices(repos).services,
    origin,
    verifyToken: fakeVerify,
  });
  const auth = `Bearer valid:${uid}`;
  const get = async (path: string) =>
    (
      await supertest(app)
        .get(`/api${path}`)
        .set("Authorization", auth)
        .expect(200)
    ).body;
  const send = (method: "post" | "put", path: string, body: object) =>
    supertest(app)
      [method](`/api${path}`)
      .set("Origin", origin)
      .set("Authorization", auth)
      .send(body);
  let clock = Date.now() - 5 * 60_000;
  /** One finished text/email run, as the browser's tracker reports it. */
  const finish = async (
    scenario: {
      id: string;
      title: string;
      difficulty: string;
      scamCategory?: string;
    },
    outcome: string,
  ) => {
    const attemptId = randomUUID();
    const base = {
      channel: "email",
      scenarioId: scenario.id,
      scenarioTitle: scenario.title,
      attemptId,
      difficulty: scenario.difficulty,
      ...(scenario.scamCategory ? { scamCategory: scenario.scamCategory } : {}),
    };
    clock += 10_000;
    await send("post", "/training/events", {
      events: [
        {
          ...base,
          type: "scenario_started",
          responseTimeMs: 0,
          at: new Date(clock - 6000).toISOString(),
        },
        {
          ...base,
          type: "scenario_completed",
          outcome,
          responseTimeMs: 6000,
          at: new Date(clock).toISOString(),
        },
      ],
    }).expect(202);
    return attemptId;
  };
  return { get, send, finish };
}

test("progress exposes the difficulty and focus the generators use", async () => {
  const body = await client(fakeRepos() as unknown as Repositories).get(
    "/training/progress",
  );
  assert.equal(body.difficulty, "easy");
  assert.deepEqual(body.focus, []);
});

const url = process.env.TEST_DATABASE_URL;
describe("the adaptive loop on Postgres", { skip: !url }, () => {
  let db: Database;
  let repos: Repositories;
  before(async () => {
    assert.match(
      new URL(url!).pathname,
      /_test$/,
      "Use a dedicated test database.",
    );
    db = createDatabase(url!);
    repos = createRepositories(db);
    await migrate(db);
  });
  beforeEach(async () => {
    await db.query(
      "TRUNCATE user_profiles, training_attempts, behavior_events, vulnerability_insights, generated_message_scenarios, generated_call_scenarios, scenario_generation_requests",
    );
  });
  after(async () => {
    await db?.end();
  });

  test("a scam the user fell for steers the next generated email and call", async () => {
    const { get, send, finish } = client(repos);
    await send("put", "/users/me", {
      name: "Jo Lee",
      phone: "+16045551234",
      profession: "teacher",
      interests: ["cycling"],
    }).expect(200);
    assert.deepEqual(
      [
        (await get("/training/progress")).difficulty,
        (await get("/training/progress")).focus,
      ],
      ["easy", []],
    );

    // Three right calls on built-in delivery texts: difficulty steps up, and both sides agree on it.
    for (let i = 0; i < 3; i++)
      await finish(
        {
          id: "parcel-redelivery",
          title: "Parcel redelivery fee",
          difficulty: "easy",
          scamCategory: "shipping",
        },
        "reported_correct",
      );
    const warmedUp = await get("/training/progress");
    assert.equal(warmedUp.difficulty, "medium");
    const first = (
      await send("post", "/training/email-scenarios", {}).expect(201)
    ).body.scenario;
    assert.equal(
      first.difficulty,
      "medium",
      "the generator uses the difficulty Home shows",
    );
    assert.equal(
      first.scamCategory,
      warmedUp.focus[0],
      "and the focus Home shows",
    );
    assert.notEqual(
      first.scamCategory,
      "shipping",
      "an untried category before a mastered one",
    );

    // The user trusts the generated email: it fooled them.
    const fooled = await finish(first, "safe_incorrect");
    const category = first.scamCategory;
    const insights = await get("/training/insights");
    assert.equal(insights.basedOn.attempts, 4);
    assert.equal(insights.nextTrainingFocus[0], category);
    const metrics = await get("/training/metrics");
    assert.deepEqual([metrics.attempts, metrics.accuracy], [4, 75]);
    assert.equal(
      metrics.categories.find(
        (c: { category: string }) => c.category === category,
      ).accuracy,
      0,
    );
    const progress = await get("/training/progress");
    assert.equal(progress.attempts[0].id, fooled);
    assert.equal(progress.focus[0], category);
    assert.deepEqual(progress.vulnerability.weakCategories, [category]);

    // The next email and call come back to that category; a second miss eases the difficulty.
    const second = (
      await send("post", "/training/email-scenarios", {}).expect(201)
    ).body.scenario;
    assert.deepEqual(
      [second.scamCategory, second.difficulty],
      [category, "medium"],
    );
    assert.match(second.generated.reason, /recent results/);
    await finish(second, "safe_incorrect");
    const eased = await get("/training/progress");
    assert.equal(eased.difficulty, "easy");
    const call = (
      await send("post", "/training/call-scenarios", {}).expect(201)
    ).body;
    assert.equal(call.difficulty, "easy");
    assert.equal(
      (await get(`/training/call-scenarios/${call.scenarioId}`)).scamCategory,
      eased.focus[0],
    );
    const third = (
      await send("post", "/training/email-scenarios", {}).expect(201)
    ).body.scenario;
    assert.deepEqual(
      [third.scamCategory, third.difficulty],
      [eased.focus[0], "easy"],
    );
    assert.equal(eased.focus[0], category);
  });
});
