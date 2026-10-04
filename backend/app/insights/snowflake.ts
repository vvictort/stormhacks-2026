import { createHmac } from "node:crypto";
import { z } from "zod";
import type { Config } from "../config.ts";
import { ScamCategory, Tactic } from "../shared/vocabulary.ts";
import {
  areaLabel,
  type RankedArea,
  type TrainingSummary,
} from "./analysis.ts";

/*
 * Snowflake's job: hold every trainee's pseudonymous per-area aggregates and analyse them together. Each refresh
 * MERGEs this trainee's rows, then one query scores every row, ranks this trainee's areas and places each one in
 * the cohort (PERCENT_RANK over all trainees). Optional: Cortex writes the text from those results.
 * The same objects, for a one-off setup by hand: backend/scripts/snowflake-setup.sql.
 */
const TABLE_DDL = `CREATE TABLE IF NOT EXISTS TELLIO_SKILL_STATS (
  TRAINEE STRING NOT NULL, DIMENSION STRING NOT NULL, AREA STRING NOT NULL,
  ATTEMPTS INTEGER NOT NULL, CORRECT INTEGER NOT NULL, FELL_FOR INTEGER NOT NULL,
  MESSAGE_ATTEMPTS INTEGER NOT NULL, REPORTED INTEGER NOT NULL, LINK_CLICKS INTEGER NOT NULL,
  AVG_RESPONSE_MS FLOAT, RECENT_ACCURACY FLOAT, EARLIER_ACCURACY FLOAT,
  UPDATED_AT TIMESTAMP_LTZ NOT NULL DEFAULT CURRENT_TIMESTAMP())`;

const columns = [
  "ATTEMPTS",
  "CORRECT",
  "FELL_FOR",
  "MESSAGE_ATTEMPTS",
  "REPORTED",
  "LINK_CLICKS",
  "AVG_RESPONSE_MS",
  "RECENT_ACCURACY",
  "EARLIER_ACCURACY",
];
const types = [
  "INTEGER",
  "INTEGER",
  "INTEGER",
  "INTEGER",
  "INTEGER",
  "INTEGER",
  "FLOAT",
  "FLOAT",
  "FLOAT",
];
const UPSERT = `MERGE INTO TELLIO_SKILL_STATS t USING (
  SELECT ? AS TRAINEE, f.value:dimension::STRING AS DIMENSION, f.value:area::STRING AS AREA,
    ${columns.map((c, i) => `f.value:${c.toLowerCase()}::${types[i]} AS ${c}`).join(", ")}
  FROM TABLE(FLATTEN(INPUT => PARSE_JSON(?))) f
) s ON t.TRAINEE = s.TRAINEE AND t.DIMENSION = s.DIMENSION AND t.AREA = s.AREA
WHEN MATCHED THEN UPDATE SET ${columns.map((c) => `${c} = s.${c}`).join(", ")}, UPDATED_AT = CURRENT_TIMESTAMP()
WHEN NOT MATCHED THEN INSERT (TRAINEE, DIMENSION, AREA, ${columns.join(", ")}, UPDATED_AT)
  VALUES (s.TRAINEE, s.DIMENSION, s.AREA, ${columns.map((c) => `s.${c}`).join(", ")}, CURRENT_TIMESTAMP())`;

// Same weakness formula as analysis.ts. The cohort is every trainee active in the last 180 days.
const ANALYSE = `WITH scored AS (
  SELECT TRAINEE, DIMENSION, AREA, ATTEMPTS, CORRECT / ATTEMPTS AS ACCURACY,
    0.6 * (1 - (CORRECT + 1) / (ATTEMPTS + 2)) + 0.3 * FELL_FOR / ATTEMPTS
      + 0.1 * IFF(MESSAGE_ATTEMPTS > 0, LINK_CLICKS / MESSAGE_ATTEMPTS, 0) AS WEAKNESS,
    RECENT_ACCURACY - EARLIER_ACCURACY AS TREND
  FROM TELLIO_SKILL_STATS
  WHERE ATTEMPTS > 0 AND UPDATED_AT > DATEADD(day, -180, CURRENT_TIMESTAMP())
), cohort AS (
  SELECT *, PERCENT_RANK() OVER (PARTITION BY DIMENSION, AREA ORDER BY WEAKNESS) AS COHORT_PERCENTILE,
    COUNT(*) OVER (PARTITION BY DIMENSION, AREA) AS COHORT_SIZE
  FROM scored
)
SELECT DIMENSION, AREA, ATTEMPTS, ACCURACY, WEAKNESS, TREND, COHORT_SIZE, COHORT_PERCENTILE
FROM cohort WHERE TRAINEE = ? ORDER BY WEAKNESS DESC`;

export interface SnowflakeConfig {
  account: string;
  token: string;
  warehouse: string;
  database: string;
  schema: string;
  role?: string;
  cortexModel?: string;
  /** HMAC key: Snowflake only ever sees HMAC(uid), never the Firebase uid. */
  idSalt: string;
  timeoutMs?: number;
}

/** Null (built-in analysis) unless every required SNOWFLAKE_* value is set. */
export function snowflakeConfig(c: Config): SnowflakeConfig | null {
  const {
    SNOWFLAKE_ACCOUNT: account,
    SNOWFLAKE_PAT: token,
    SNOWFLAKE_WAREHOUSE: warehouse,
    SNOWFLAKE_DATABASE: database,
    SNOWFLAKE_ID_SALT: idSalt,
  } = c;
  if (!account || !token || !warehouse || !database || !idSalt) return null;
  return {
    account: account.replace(/\.snowflakecomputing\.com$/i, ""),
    token,
    warehouse,
    database,
    idSalt,
    schema: c.SNOWFLAKE_SCHEMA,
    role: c.SNOWFLAKE_ROLE,
    cortexModel: c.SNOWFLAKE_CORTEX_MODEL,
  };
}

const resultSchema = z.object({
  resultSetMetaData: z.object({
    rowType: z.array(z.object({ name: z.string() })),
  }),
  data: z.array(z.array(z.string().nullable())),
});
const unit = z.coerce.number().min(0).max(1);
const rowSchema = z
  .object({
    DIMENSION: z.enum(["category", "tactic"]),
    AREA: z.string(),
    ATTEMPTS: z.coerce.number().int().positive(),
    ACCURACY: unit,
    WEAKNESS: unit,
    TREND: z.coerce.number().min(-1).max(1).nullable(),
    COHORT_SIZE: z.coerce.number().int().positive(),
    COHORT_PERCENTILE: unit,
  })
  .refine(
    (r) =>
      (r.DIMENSION === "category" ? ScamCategory : Tactic).safeParse(r.AREA)
        .success,
  );
const textSchema = z.object({
  behavioralPattern: z.string().trim().min(20).max(320),
  recommendation: z.string().trim().min(20).max(320),
});

export class Snowflake {
  private ready?: Promise<unknown>;
  private readonly config: SnowflakeConfig;
  private readonly fetch: typeof fetch;
  constructor(
    config: SnowflakeConfig,
    fetchImpl: typeof fetch = (...args) => fetch(...args),
  ) {
    this.config = config;
    this.fetch = fetchImpl;
  }

  get timeoutMs() {
    return this.config.timeoutMs ?? 8000;
  }

  /** The pseudonymous trainee id. */
  trainee(uid: string) {
    return createHmac("sha256", this.config.idSalt).update(uid).digest("hex");
  }

  /** One statement over the SQL API, with positional text bindings. Rows are keyed by column name. */
  async query(statement: string, binds: string[], signal: AbortSignal) {
    const { account, token, warehouse, database, schema, role } = this.config;
    const res = await this.fetch(
      `https://${account}.snowflakecomputing.com/api/v2/statements`,
      {
        method: "POST",
        signal,
        headers: {
          Authorization: `Bearer ${token}`,
          "X-Snowflake-Authorization-Token-Type": "PROGRAMMATIC_ACCESS_TOKEN",
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          statement,
          timeout: Math.ceil(this.timeoutMs / 1000),
          warehouse,
          database,
          schema,
          role,
          bindings: Object.fromEntries(
            binds.map((value, i) => [String(i + 1), { type: "TEXT", value }]),
          ),
        }),
      },
    );
    // 202 means still running: too slow for us, so the caller falls back.
    if (res.status !== 200)
      throw new Error(`Snowflake SQL API returned ${res.status}`);
    const { resultSetMetaData, data } = resultSchema.parse(await res.json());
    const names = resultSetMetaData.rowType.map((c) => c.name.toUpperCase());
    return data.map((row) =>
      Object.fromEntries(names.map((name, i) => [name, row[i]])),
    );
  }

  /** Uploads this trainee's aggregates and returns Snowflake's ranking of their areas, with cohort placement. */
  async analyse(
    uid: string,
    summary: TrainingSummary,
    signal: AbortSignal,
  ): Promise<RankedArea[]> {
    this.ready ??= this.query(TABLE_DDL, [], signal).catch((error) => {
      this.ready = undefined;
      throw error;
    });
    await this.ready;
    const trainee = this.trainee(uid);
    const rows = summary.areas.map((a) => ({
      dimension: a.dimension,
      area: a.area,
      attempts: a.attempts,
      correct: a.correct,
      fell_for: a.fellFor,
      message_attempts: a.messageAttempts,
      reported: a.reported,
      link_clicks: a.linkClicks,
      avg_response_ms: a.avgResponseMs,
      recent_accuracy: a.recentAccuracy,
      earlier_accuracy: a.earlierAccuracy,
    }));
    await this.query(UPSERT, [trainee, JSON.stringify(rows)], signal);
    const result = z
      .array(rowSchema)
      .parse(await this.query(ANALYSE, [trainee], signal));
    if (result.length !== summary.areas.length)
      throw new Error("Snowflake analysis is missing areas");
    return result.map((r) => ({
      dimension: r.DIMENSION,
      area: r.AREA,
      attempts: r.ATTEMPTS,
      accuracy: r.ACCURACY,
      weakness: r.WEAKNESS,
      trend: r.TREND,
      cohortSize: r.COHORT_SIZE,
      cohortPercentile: r.COHORT_PERCENTILE,
    }));
  }

  /** Cortex text over the computed results only (labels and rates). Null when unset, invalid or failed. */
  async cortexText(
    ranked: RankedArea[],
    focus: ScamCategory[],
    signal: AbortSignal,
  ) {
    const model = this.config.cortexModel;
    if (!model) return null;
    const results = ranked.map((r) => ({
      area: areaLabel(r),
      attempts: r.attempts,
      accuracy: Math.round(r.accuracy * 100) / 100,
      weakness: Math.round(r.weakness * 100) / 100,
      weakerThanMostTrainees:
        (r.cohortSize ?? 0) >= 5 && (r.cohortPercentile ?? 0) >= 0.6,
    }));
    const prompt =
      "You coach someone practising how to spot scams in a training app. From these aggregate results, reply with only JSON " +
      '{"behavioralPattern": string, "recommendation": string}. Second person, warm and plain, no greeting, at most two short ' +
      "sentences each, no numbers or facts beyond the data. behavioralPattern: what they catch and what catches them. " +
      `recommendation: what to practise next and one habit.\nResults: ${JSON.stringify(results)}\nPractise next: ${JSON.stringify(focus.map((area) => areaLabel({ dimension: "category", area })))}`;
    try {
      const [row] = await this.query(
        "SELECT SNOWFLAKE.CORTEX.COMPLETE(?, ?) AS TEXT",
        [model, prompt],
        signal,
      );
      const json = /\{[\s\S]*\}/.exec(String(row?.TEXT ?? ""))?.[0];
      const text = json ? textSchema.safeParse(JSON.parse(json)) : null;
      return text?.success &&
        !/https?:|</i.test(
          text.data.behavioralPattern + text.data.recommendation,
        )
        ? text.data
        : null;
    } catch {
      return null;
    }
  }
}
