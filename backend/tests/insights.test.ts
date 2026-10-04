import { fakeRepos, origin, testServices } from "./harness.ts";
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import supertest from "supertest";
import type { DecodedIdToken } from "firebase-admin/auth";
import { createDatabase, type Database } from "../app/db/database.ts";
import { migrate } from "../app/db/migrate.ts";
import {
  buildInsights,
  rankLocally,
  summarize,
  type AttemptRow,
  type Insights,
} from "../app/insights/analysis.ts";
import { InsightsService } from "../app/insights/service.ts";
import {
  interpret,
  Snowflake,
  snowflakeConfig,
  type SnowflakeConfig,
} from "../app/insights/snowflake.ts";
import type { Config } from "../app/config.ts";
import { createRepositories, type Repositories } from "../app/repositories.ts";
import { createApp } from "../app/server.ts";

const row = (o: Partial<AttemptRow> = {}): AttemptRow => ({
  channel: "email",
  scenarioId: "gen-email-1",
  scenarioTitle: "Parcel on hold",
  scamCategory: "shipping",
  difficulty: "easy",
  outcome: "reported_correct",
  success: true,
  tactics: [],
  completedAt: "2026-10-01T10:00:00Z",
  linkClicked: false,
  senderInspected: false,
  responseMs: null,
  ...o,
});

// Catches delivery scams and checks senders; falls for account-security and
// workplace scams that pair urgency with authority, quickly.
const history = [
  row({
    senderInspected: true,
    responseMs: 9000,
    completedAt: "2026-10-01T10:00:00Z",
  }),
  row({
    senderInspected: true,
    responseMs: 9000,
    completedAt: "2026-10-01T10:05:00Z",
  }),
  row({
    senderInspected: true,
    responseMs: 9000,
    completedAt: "2026-10-01T10:10:00Z",
    difficulty: "medium",
  }),
  row({
    scamCategory: "account_security",
    outcome: "safe_incorrect",
    success: false,
    tactics: ["urgency", "authority"],
    linkClicked: true,
    responseMs: 3000,
    completedAt: "2026-10-01T11:00:00Z",
  }),
  row({
    scamCategory: "account_security",
    outcome: "safe_incorrect",
    success: false,
    tactics: ["authority", "urgency"],
    linkClicked: true,
    responseMs: 3000,
    completedAt: "2026-10-01T11:05:00Z",
    difficulty: "hard",
  }),
  row({
    channel: "call",
    scenarioId: "exec-vendor-payment-1",
    scenarioTitle: "Executive vendor payment",
    scamCategory: null,
    outcome: "compromised",
    success: false,
    tactics: ["authority", "urgency"],
    difficulty: "hard",
    completedAt: "2026-10-01T12:00:00Z",
  }),
];

const sfConfig: SnowflakeConfig = {
  account: "myorg-acct",
  token: "pat-secret",
  warehouse: "TELLIO_WH",
  database: "TELLIO",
  schema: "PUBLIC",
  role: "TELLIO_APP",
  idSalt: "a-long-test-salt-value",
  timeoutMs: 200,
};

const result = (names: string[], data: (string | null)[][]) =>
  Response.json({
    resultSetMetaData: { rowType: names.map((name) => ({ name })) },
    data,
  });
const done = () => result(["status"], [["ok"]]);

/** A fake Snowflake SQL API: answers by statement, records every request. */
function fakeSnowflake(
  {
    cohortSize = 12,
    percentile = 0.8,
    othersMissRate = "0.4",
    cortex,
  }: {
    cohortSize?: number;
    percentile?: number;
    othersMissRate?: string | null;
    cortex?: string;
  } = {},
  config = sfConfig,
) {
  const requests: {
    url: string;
    init: RequestInit;
    body: {
      statement: string;
      bindings: Record<string, { type: string; value: string }>;
      [key: string]: unknown;
    };
  }[] = [];

  type Sent = {
    dimension: string;
    area: string;
    attempts: number;
    correct: number;
    fell_for: number;
    message_attempts: number;
    link_clicks: number;
    avg_response_ms: number | null;
  };

  const sent = () =>
    JSON.parse(
      requests.find((r) => r.body.statement.startsWith("MERGE"))!.body.bindings[
        "2"
      ].value,
    ) as Sent[];

  const fetchImpl = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    requests.push({ url, init, body });

    if (body.statement.startsWith("WITH scored")) {
      const areas = sent().filter(
        (a) => a.dimension === "category" || a.dimension === "tactic",
      );
      const ranked = rankLocally({
        areas: areas.map((a) => ({
          ...a,
          fellFor: a.fell_for,
          messageAttempts: a.message_attempts,
          linkClicks: a.link_clicks,
        })),
      } as never);

      return result(
        [
          "DIMENSION",
          "AREA",
          "ATTEMPTS",
          "ACCURACY",
          "WEAKNESS",
          "TREND",
          "COHORT_SIZE",
          "COHORT_PERCENTILE",
        ],
        ranked.map((r) => [
          r.dimension,
          r.area,
          String(r.attempts),
          r.accuracy.toFixed(6),
          r.weakness.toFixed(6),
          null,
          String(cohortSize),
          String(r.weakness >= 0.4 ? percentile : 0.1),
        ]),
      );
    }

    if (body.statement.startsWith("WITH rates")) {
      const rows = sent().filter((a) => a.dimension !== "category");
      const mean = (dimension: string) => {
        const times = rows
          .filter(
            (r) => r.dimension === dimension && r.avg_response_ms !== null,
          )
          .map((r) => r.avg_response_ms!);
        return times.reduce((a, b) => a + b, 0) / times.length;
      };

      return result(
        [
          "DIMENSION",
          "AREA",
          "ATTEMPTS",
          "MISS_RATE",
          "SPEED_RATIO",
          "COHORT_SIZE",
          "OTHERS_MISS_RATE",
        ],
        rows.map((r) => [
          r.dimension,
          r.area,
          String(r.attempts),
          String((r.attempts - r.correct) / r.attempts),
          r.avg_response_ms === null
            ? null
            : String(r.avg_response_ms / mean(r.dimension)),
          String(cohortSize),
          othersMissRate,
        ]),
      );
    }

    if (body.statement.includes("CORTEX")) {
      return result(["TEXT"], [[cortex ?? null]]);
    }

    return done();
  }) as typeof fetch;

  return { requests, snowflake: new Snowflake(config, fetchImpl) };
}

/** An in-memory insights repository over fixed rows. */
function memoryRepo(
  rows: AttemptRow[],
  lastAttemptAt: string | null = "2026-10-01T12:00:00.000Z",
) {
  let cached:
    (Insights & { lastAttemptAt: string | null; computedAt: string }) | null =
    null;
  let reads = 0;

  const repo: Repositories["insights"] = {
    async attemptRows() {
      reads++;
      return rows;
    },
    async state() {
      return { cached, lastAttemptAt };
    },
    async save(_uid, insights, last) {
      cached = {
        ...insights,
        lastAttemptAt: last,
        computedAt: new Date().toISOString(),
      };
    },
    async latestFocus() {
      return [];
    },
  };

  return { repo, reads: () => reads, cached: () => cached };
}

test("the summary aggregates per category and tactic, without text", () => {
  const summary = summarize(history);
  const area = (dimension: string, name: string) =>
    summary.areas.find((a) => a.dimension === dimension && a.area === name)!;

  assert.deepEqual(
    { ...area("category", "shipping") },
    {
      dimension: "category",
      area: "shipping",
      attempts: 3,
      correct: 3,
      fellFor: 0,
      messageAttempts: 3,
      reported: 3,
      linkClicks: 0,
      senderChecks: 3,
      avgResponseMs: 9000,
      earlierAccuracy: null,
      recentAccuracy: null,
    },
  );
  assert.equal(
    area("category", "workplace").attempts,
    1,
    "a missing category is inferred from the scenario",
  );
  assert.equal(area("tactic", "urgency").fellFor, 3);
  assert.deepEqual(summary.missedPair, ["authority", "urgency"]);
  assert.deepEqual(summary.repeatedMistakes.sort(), [
    "account_security",
    "authority",
    "urgency",
  ]);
  assert.deepEqual(summary.byDifficulty, {
    easy: { attempts: 3, correct: 2 },
    medium: { attempts: 1, correct: 1 },
    hard: { attempts: 2, correct: 0 },
  });
  assert.deepEqual(summary.responseMs, { correct: 9000, fellFor: 3000 });
  assert.deepEqual(
    [summary.overall.earlierAccuracy, summary.overall.recentAccuracy],
    [1, 0],
  );
  assert.equal(JSON.stringify(summary).includes("Parcel"), false);
});

test("the built-in analysis picks strengths, weaknesses, focus and writes the pattern", () => {
  const summary = summarize(history);
  const insights = buildInsights(
    summary,
    rankLocally(summary),
    "fallback",
    new Date("2026-10-04T00:00:00Z"),
  );

  assert.deepEqual(insights.strongestAreas, [
    "Delivery scams",
    "Checking who a message is really from",
  ]);
  assert.deepEqual(insights.weakAreas, [
    "Authority pressure",
    "Urgency pressure",
    "Account security scams",
  ]);
  assert.deepEqual(insights.nextTrainingFocus, [
    "account_security",
    "workplace",
    "banking",
  ]);
  assert.equal(
    insights.behavioralPattern,
    "You consistently see through delivery scams, but you struggle when authority and urgency are combined. You decide faster on the ones that fool you, so slowing down is your best defence.",
  );
  assert.match(
    insights.recommendation,
    /^Your next training should focus on account security scams and workplace scams\. A big title is not proof/,
  );
  assert.deepEqual(
    {
      source: insights.source,
      generatedAt: insights.generatedAt,
      basedOn: insights.basedOn,
    },
    {
      source: "fallback",
      generatedAt: "2026-10-04T00:00:00.000Z",
      basedOn: { attempts: 6 },
    },
  );

  // All right, nothing weak: the focus moves to untried categories.
  const good = summarize([row(), row({ scamCategory: "banking" })]);
  const strong = buildInsights(good, rankLocally(good), "fallback");
  assert.deepEqual(strong.weakAreas, []);
  assert.deepEqual(strong.nextTrainingFocus, [
    "government",
    "account_security",
    "workplace",
  ]);
  assert.match(
    strong.recommendation,
    /^Next, try government impersonation and account security scams/,
  );
});

test("empty history is a friendly empty analysis, not an error, and is not cached", async () => {
  const memory = memoryRepo([], null);
  const insights = await new InsightsService(memory.repo, null).get("alex");
  assert.deepEqual(
    { ...insights, generatedAt: "" },
    {
      strongestAreas: [],
      weakAreas: [],
      behavioralPattern: "chatisthisreal hasn't seen you handle a scam yet.",
      recommendation:
        "Try a few scenarios and you'll see what you catch, and what catches you.",
      nextTrainingFocus: [],
      source: "fallback",
      generatedAt: "",
      basedOn: { attempts: 0 },
    },
  );
  assert.equal(memory.cached(), null);
});

test("without Snowflake the analysis is built in, cached until a newer attempt", async () => {
  const memory = memoryRepo(history);
  const service = new InsightsService(memory.repo, null);
  const [first, concurrent] = await Promise.all([
    service.get("alex"),
    service.get("alex"),
  ]);

  assert.equal(first.source, "fallback");
  assert.deepEqual(concurrent, first);
  assert.equal(memory.reads(), 1, "concurrent requests share one computation");
  assert.deepEqual(await service.get("alex"), first);
  assert.equal(memory.reads(), 1, "served from the cache");
  assert.deepEqual(Object.keys(await service.get("alex")).sort(), [
    "basedOn",
    "behavioralPattern",
    "generatedAt",
    "nextTrainingFocus",
    "recommendation",
    "source",
    "strongestAreas",
    "weakAreas",
  ]);
});

test("Snowflake gets pseudonymous aggregates over bound variables and ranks against the cohort", async () => {
  const { requests, snowflake } = fakeSnowflake();
  const insights = await new InsightsService(
    memoryRepo(history).repo,
    snowflake,
  ).get("firebase-uid-alex");

  assert.equal(insights.source, "snowflake");
  // Snowflake's interpretation: the tactic pair's miss rate against other
  // trainees, and cohort placement.
  assert.equal(
    insights.behavioralPattern,
    "You consistently see through delivery scams, but authority combined with urgency still causes mistakes: 3 of 3 times, against 40% for other trainees. " +
      "Compared with other trainees, you're weaker than most on authority pressure. You decide faster on the ones that fool you, so slowing down is your best defence.",
  );
  // The focus stays the deterministic built-in pick.
  assert.deepEqual(
    insights.nextTrainingFocus,
    buildInsights(
      summarize(history),
      rankLocally(summarize(history)),
      "fallback",
    ).nextTrainingFocus,
  );

  assert.deepEqual(
    requests.map((r) => r.body.statement.split(/\s/)[0]),
    ["CREATE", "MERGE", "WITH", "WITH"],
  );
  for (const { url, init, body } of requests) {
    assert.equal(
      url,
      "https://myorg-acct.snowflakecomputing.com/api/v2/statements",
    );
    const headers = init.headers as Record<string, string>;
    assert.equal(headers.Authorization, "Bearer pat-secret");
    assert.equal(
      headers["X-Snowflake-Authorization-Token-Type"],
      "PROGRAMMATIC_ACCESS_TOKEN",
    );
    assert.deepEqual(
      [body.warehouse, body.database, body.schema, body.role],
      ["TELLIO_WH", "TELLIO", "PUBLIC", "TELLIO_APP"],
    );
    assert.equal(
      body.statement.includes(snowflake.trainee("firebase-uid-alex")),
      false,
      "values are bound, never concatenated",
    );
  }

  const [, merge, analyse, interpret] = requests.map((r) => r.body);
  assert.match(merge.bindings["1"].value, /^[0-9a-f]{64}$/);
  assert.deepEqual(analyse.bindings, {
    1: { type: "TEXT", value: merge.bindings["1"].value },
  });
  assert.deepEqual(interpret.bindings, analyse.bindings);

  const areas = JSON.parse(merge.bindings["2"].value) as {
    dimension: string;
    area: string;
  }[];
  assert.deepEqual(
    areas
      .filter((a) => a.dimension === "pair" || a.dimension === "channel")
      .map((a) => `${a.dimension}:${a.area}`)
      .sort(),
    ["channel:call", "channel:email", "pair:authority+urgency"],
  );

  const sent = JSON.stringify(requests.map((r) => r.body));
  for (const secret of [
    "firebase-uid-alex",
    "@",
    "Parcel",
    "Executive",
    "exec-vendor",
    "gen-email",
  ]) {
    assert.equal(sent.includes(secret), false, secret);
  }

  assert.deepEqual(
    Object.keys(JSON.parse(merge.bindings["2"].value)[0]).sort(),
    [
      "area",
      "attempts",
      "avg_response_ms",
      "correct",
      "dimension",
      "earlier_accuracy",
      "fell_for",
      "link_clicks",
      "message_attempts",
      "recent_accuracy",
      "reported",
    ],
  );

  // The table is created once per process.
  await new InsightsService(memoryRepo(history).repo, snowflake).get(
    "firebase-uid-sam",
  );
  assert.equal(
    requests.filter((r) => r.body.statement.startsWith("CREATE")).length,
    1,
  );
});

test("Cortex wording is used only when it is valid", async () => {
  const text = {
    behavioralPattern:
      "You spot delivery scams, but urgency plus authority still gets you.",
    recommendation:
      "Practise account security scams next and pause before acting.",
  };

  const good = fakeSnowflake(
    { cortex: `Sure!\n${JSON.stringify(text)}` },
    { ...sfConfig, cortexModel: "mistral-large2" },
  );
  const cortexed = await new InsightsService(
    memoryRepo(history).repo,
    good.snowflake,
  ).get("alex");
  assert.deepEqual(
    [cortexed.source, cortexed.behavioralPattern, cortexed.recommendation],
    ["cortex", text.behavioralPattern, text.recommendation],
  );

  const cortexCall = good.requests.find((r) =>
    r.body.statement.includes("CORTEX"),
  )!.body;
  assert.equal(cortexCall.bindings["1"].value, "mistral-large2");
  assert.equal(cortexCall.bindings["2"].value.includes("alex"), false);

  // Cortex reads Snowflake's interpretation and the deterministic focus with
  // its reason.
  const data = JSON.parse(cortexCall.bindings["2"].value.split("Data: ")[1]);
  assert.deepEqual(data.weakestCombination, {
    tactics: "authority combined with urgency",
    missed: 3,
    of: 3,
    otherTraineesMissRate: 0.4,
  });
  assert.deepEqual(data.practiseNext, {
    area: "account security scams",
    why: "right on 0 of 2",
  });

  for (const reply of [
    "not json",
    JSON.stringify({ behavioralPattern: "short", recommendation: "x" }),
    JSON.stringify({
      ...text,
      recommendation: `${text.recommendation} https://evil.example`,
    }),
  ]) {
    const fallbackText = await new InsightsService(
      memoryRepo(history).repo,
      fakeSnowflake({ cortex: reply }, { ...sfConfig, cortexModel: "m" })
        .snowflake,
    ).get("alex");
    assert.equal(
      fallbackText.source,
      "snowflake",
      "invalid Cortex text is never labelled as Cortex",
    );
    assert.match(
      fallbackText.behavioralPattern,
      /^You consistently see through delivery scams/,
    );
  }
});

test("a failed interpretation keeps the Snowflake ranking; a small cohort gets no comparison", async () => {
  const broken = fakeSnowflake({ othersMissRate: "not a number" });
  const warn = console.warn;
  console.warn = () => {};
  try {
    const ranked = await new InsightsService(
      memoryRepo(history).repo,
      broken.snowflake,
    ).get("alex");
    assert.equal(ranked.source, "snowflake");
    assert.match(
      ranked.behavioralPattern,
      /but you struggle when authority and urgency are combined\./,
    );
  } finally {
    console.warn = warn;
  }

  const small = await new InsightsService(
    memoryRepo(history).repo,
    fakeSnowflake({ cohortSize: 3 }).snowflake,
  ).get("alex");
  assert.match(
    small.behavioralPattern,
    /urgency still causes mistakes: 3 of 3 times\. /,
  );
});

test("interpret picks the most-missed tactic pair and a quick catch from Snowflake rows", () => {
  const r = (
    DIMENSION: string,
    AREA: string,
    ATTEMPTS: number,
    MISS_RATE: number,
    SPEED_RATIO: number | null,
    COHORT_SIZE = 8,
    OTHERS_MISS_RATE: number | null = 0.25,
  ) => ({
    DIMENSION,
    AREA,
    ATTEMPTS: String(ATTEMPTS),
    MISS_RATE: String(MISS_RATE),
    SPEED_RATIO: SPEED_RATIO === null ? null : String(SPEED_RATIO),
    COHORT_SIZE: String(COHORT_SIZE),
    OTHERS_MISS_RATE:
      OTHERS_MISS_RATE === null ? null : String(OTHERS_MISS_RATE),
  });

  assert.deepEqual(
    interpret([
      r("pair", "authority+urgency", 4, 0.75, 1.1),
      r("pair", "fear+urgency", 1, 1, 0.9), // one attempt is not a pattern
      r("pair", "reward+suspicious_link", 3, 0, 0.5),
      r("tactic", "suspicious_link", 3, 0, 0.6),
      r("channel", "email", 5, 0, 0.8),
      r("tactic", "urgency", 4, 0.5, 0.2), // fast but missed
    ]),
    {
      weakPair: {
        tactics: ["authority", "urgency"],
        attempts: 4,
        missed: 3,
        cohortMissRate: 0.25,
      },
      quickCatch: { dimension: "tactic", area: "suspicious_link" },
    },
  );
  assert.deepEqual(
    interpret([
      r("pair", "authority+urgency", 2, 0.5, null, 4),
      r("channel", "sms", 2, 0, 0.95),
    ]),
    {
      weakPair: {
        tactics: ["authority", "urgency"],
        attempts: 2,
        missed: 1,
        cohortMissRate: null,
      },
      quickCatch: null,
    },
  );

  const summary = summarize(history);
  const text = buildInsights(
    summary,
    rankLocally(summary),
    "snowflake",
    new Date(),
    {
      weakPair: null,
      quickCatch: { dimension: "tactic", area: "suspicious_link" },
    },
  );
  assert.match(
    text.behavioralPattern,
    /^You catch suspicious links quickly, but you struggle when authority and urgency are combined\./,
  );
});

test("any Snowflake failure falls back to the built-in analysis, and retries soon", async () => {
  const failures: [string, typeof fetch][] = [
    [
      "HTTP error",
      (async () =>
        Response.json(
          { message: "Incorrect username or password" },
          { status: 401 },
        )) as typeof fetch,
    ],
    [
      "still running (202)",
      (async () =>
        Response.json(
          { statementHandle: "x" },
          { status: 202 },
        )) as typeof fetch,
    ],
    [
      "malformed result",
      (async () => Response.json({ data: "nope" })) as typeof fetch,
    ],
    [
      "wrong rows",
      (async (_u: string, init: RequestInit) =>
        JSON.parse(String(init.body)).statement.startsWith("WITH")
          ? result(
              [
                "DIMENSION",
                "AREA",
                "ATTEMPTS",
                "ACCURACY",
                "WEAKNESS",
                "TREND",
                "COHORT_SIZE",
                "COHORT_PERCENTILE",
              ],
              [["category", "crypto", "1", "2", "0.5", null, "3", "0.5"]],
            )
          : done()) as typeof fetch,
    ],
    [
      "network error",
      (async () => {
        throw new TypeError("fetch failed");
      }) as typeof fetch,
    ],
    // A real request holds the event loop open; AbortSignal.timeout's timer
    // alone doesn't.
    [
      "timeout",
      ((_u: string, init: RequestInit) =>
        new Promise((_, reject) => {
          const open = setTimeout(() => {}, 5000);
          init.signal!.addEventListener("abort", () => {
            clearTimeout(open);
            reject(init.signal!.reason);
          });
        })) as typeof fetch,
    ],
  ];

  const warn = console.warn;
  const logged: string[] = [];
  console.warn = (...args: unknown[]) => {
    logged.push(args.join(" "));
  };
  try {
    for (const [name, fetchImpl] of failures) {
      const memory = memoryRepo(history);
      const started = Date.now();
      const insights = await new InsightsService(
        memory.repo,
        new Snowflake(sfConfig, fetchImpl),
      ).get("alex");
      assert.equal(insights.source, "fallback", name);
      assert.ok(
        Date.now() - started < 1000,
        `${name} is bounded by the timeout`,
      );
      assert.equal(memory.cached()?.source, "fallback");
    }
  } finally {
    console.warn = warn;
  }

  assert.equal(
    logged.filter((line) => line.includes("using the built-in analysis"))
      .length,
    failures.length,
  );
  assert.equal(
    logged.some((line) => line.includes("pat-secret")),
    false,
  );
});

test("Snowflake is only used with every required setting, and the account is normalised", () => {
  const base = {
    SNOWFLAKE_ACCOUNT: "myorg-acct.snowflakecomputing.com",
    SNOWFLAKE_PAT: "p",
    SNOWFLAKE_WAREHOUSE: "W",
    SNOWFLAKE_DATABASE: "D",
    SNOWFLAKE_SCHEMA: "PUBLIC",
    SNOWFLAKE_ID_SALT: "s".repeat(16),
  } as Config;

  assert.equal(snowflakeConfig(base)?.account, "myorg-acct");
  for (const key of [
    "SNOWFLAKE_ACCOUNT",
    "SNOWFLAKE_PAT",
    "SNOWFLAKE_WAREHOUSE",
    "SNOWFLAKE_DATABASE",
    "SNOWFLAKE_ID_SALT",
  ] as const) {
    assert.equal(snowflakeConfig({ ...base, [key]: undefined }), null, key);
  }
});

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

const appWith = (repos: Repositories, snowflake: Snowflake | null = null) =>
  createApp({
    repos,
    services: testServices(repos).services,
    origin,
    verifyToken,
    snowflake,
  });

test("GET /api/training/insights needs a signed-in user", async () => {
  const app = appWith(fakeRepos());
  await supertest(app).get("/api/training/insights").expect(401);
  const body = (
    await supertest(app)
      .get("/api/training/insights")
      .set("Authorization", "Bearer alex")
      .expect(200)
  ).body;
  assert.equal(body.basedOn.attempts, 0);
});

const url = process.env.TEST_DATABASE_URL;
describe("Postgres insights", { skip: !url }, () => {
  let db: Database;
  let repos: Repositories;

  const attempt = (id: string, uid: string, o: Record<string, unknown> = {}) =>
    db.query(
      `INSERT INTO training_attempts(id,firebase_uid,channel,scenario_id,scenario_title,difficulty,outcome,success,tactics,signals,completed_at,scam_category,metadata)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'{}',$10,$11,'{}')`,
      [
        id,
        uid,
        o.channel ?? "email",
        o.scenarioId ?? "gen-email-1",
        o.title ?? "Parcel on hold",
        o.difficulty ?? "easy",
        o.outcome ?? "reported_correct",
        "success" in o ? o.success : true,
        o.tactics ?? [],
        o.at ?? "2026-10-01T10:00:00Z",
        o.category ?? "shipping",
      ],
    );

  const event = (
    uid: string,
    attemptId: string,
    type: string,
    responseMs: number | null = null,
  ) =>
    db.query(
      `INSERT INTO behavior_events(firebase_uid,event_type,channel,scenario_id,attempt_id,response_time_ms) VALUES($1,$2,'email','gen-email-1',$3,$4)`,
      [uid, type, attemptId, responseMs],
    );

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
      "TRUNCATE training_attempts, behavior_events, vulnerability_insights",
    );
  });
  after(async () => {
    await db?.end();
  });

  test("the summary query reads only the requesting user's attempts and events", async () => {
    await attempt("a1", "alex");
    await event("alex", "a1", "sender_inspected");
    await event("alex", "a1", "scenario_completed", 8000);
    await attempt("s1", "sam", {
      outcome: "safe_incorrect",
      success: false,
      category: "banking",
    });
    await event("sam", "s1", "link_clicked");
    // Another user's event on the same attempt id must not leak in.
    await event("sam", "a1", "link_clicked");
    await event("sam", "a1", "scenario_completed", 1);
    await attempt("a2", "alex", {
      outcome: "error",
      success: null,
      at: "2026-10-01T11:00:00Z",
    });

    const rows = await repos.insights.attemptRows("alex");
    assert.deepEqual(rows, [
      {
        channel: "email",
        scenarioId: "gen-email-1",
        scenarioTitle: "Parcel on hold",
        scamCategory: "shipping",
        difficulty: "easy",
        outcome: "reported_correct",
        success: true,
        tactics: [],
        completedAt: "2026-10-01T10:00:00.000Z",
        linkClicked: false,
        senderInspected: true,
        responseMs: 8000,
      },
    ]);
    assert.equal(
      (await repos.insights.attemptRows("sam"))[0].linkClicked,
      true,
    );
    assert.deepEqual(await repos.insights.attemptRows("nobody"), []);
  });

  test("the analysis is cached per user and recomputed after a newer attempt", async () => {
    const app = appWith(repos);
    const get = async (user: string) =>
      (
        await supertest(app)
          .get("/api/training/insights")
          .set("Authorization", `Bearer ${user}`)
          .expect(200)
      ).body;

    await attempt("a1", "alex", {
      outcome: "safe_incorrect",
      success: false,
      category: "account_security",
      tactics: ["urgency"],
    });

    const first = await get("alex");
    assert.deepEqual(
      [first.source, first.basedOn.attempts, first.nextTrainingFocus[0]],
      ["fallback", 1, "account_security"],
    );
    assert.deepEqual(
      (
        await db.query(
          "SELECT firebase_uid, source FROM vulnerability_insights",
        )
      ).rows,
      [{ firebase_uid: "alex", source: "fallback" }],
    );
    assert.deepEqual(await get("alex"), first, "served from the cache");
    assert.equal(
      (await get("sam")).basedOn.attempts,
      0,
      "never another user's analysis",
    );

    await attempt("a2", "alex", { at: "2026-10-01T11:00:00Z" });
    assert.equal((await get("alex")).basedOn.attempts, 2);
    assert.deepEqual(
      await repos.insights.latestFocus("alex"),
      (await get("alex")).nextTrainingFocus,
    );

    await attempt("a3", "alex", {
      category: "banking",
      outcome: "safe_incorrect",
      success: false,
      at: "2026-10-01T12:00:00Z",
    });
    await attempt("a4", "alex", {
      category: "banking",
      outcome: "safe_incorrect",
      success: false,
      at: "2026-10-01T12:05:00Z",
    });
    assert.equal(
      (await repos.insights.latestFocus("alex"))[0],
      "banking",
      "a stale cache is recomputed locally, without Snowflake",
    );
    assert.deepEqual(await repos.insights.latestFocus("sam"), []);
  });

  test("a Snowflake result is stored with its source", async () => {
    await attempt("a1", "alex");
    const { snowflake } = fakeSnowflake();
    const body = (
      await supertest(appWith(repos, snowflake))
        .get("/api/training/insights")
        .set("Authorization", "Bearer alex")
        .expect(200)
    ).body;
    assert.equal(body.source, "snowflake");
    assert.equal(
      (await db.query("SELECT source FROM vulnerability_insights")).rows[0]
        .source,
      "snowflake",
    );
  });
});
