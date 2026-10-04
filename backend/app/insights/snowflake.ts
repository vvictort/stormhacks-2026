import { createHmac } from "node:crypto";
import { z } from "zod";
import type { Config } from "../config.ts";
import { ScamCategory, Tactic } from "../shared/vocabulary.ts";
import {
  areaLabel,
  COHORT_MIN,
  pairLabel,
  type Insights,
  type Interpretation,
  type RankedArea,
  type TrainingSummary,
} from "./analysis.ts";

/*
 * Snowflake's job: hold every trainee's pseudonymous aggregates and analyse them together. Each refresh MERGEs this
 * trainee's rows (per category and tactic, plus per tactic pair and channel), then two queries run in parallel:
 * ANALYSE scores and ranks this trainee's categories and tactics and places each in the cohort (PERCENT_RANK over
 * all trainees); INTERPRET reads what the built-in analysis can't: how often tactic combinations fool this trainee
 * against everyone else, and where they decide faster than their own average. Optional: Cortex writes the text.
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
  WHERE ATTEMPTS > 0 AND DIMENSION IN ('category', 'tactic') AND UPDATED_AT > DATEADD(day, -180, CURRENT_TIMESTAMP())
), cohort AS (
  SELECT *, PERCENT_RANK() OVER (PARTITION BY DIMENSION, AREA ORDER BY WEAKNESS) AS COHORT_PERCENTILE,
    COUNT(*) OVER (PARTITION BY DIMENSION, AREA) AS COHORT_SIZE
  FROM scored
)
SELECT DIMENSION, AREA, ATTEMPTS, ACCURACY, WEAKNESS, TREND, COHORT_SIZE, COHORT_PERCENTILE
FROM cohort WHERE TRAINEE = ? ORDER BY WEAKNESS DESC`;

// Pair, channel and tactic rows: miss rate against every other trainee's, and decision time against this trainee's own average for that
// dimension. QUALIFY keeps only the rows this refresh wrote (the MERGE stamps them all with one timestamp).
const INTERPRET = `WITH rates AS (
  SELECT TRAINEE, DIMENSION, AREA, ATTEMPTS, (ATTEMPTS - CORRECT) / ATTEMPTS AS MISS_RATE, AVG_RESPONSE_MS, UPDATED_AT
  FROM TELLIO_SKILL_STATS
  WHERE ATTEMPTS > 0 AND DIMENSION IN ('pair', 'channel', 'tactic') AND UPDATED_AT > DATEADD(day, -180, CURRENT_TIMESTAMP())
), cohort AS (
  SELECT *, COUNT(*) OVER (PARTITION BY DIMENSION, AREA) AS COHORT_SIZE,
    (SUM(MISS_RATE) OVER (PARTITION BY DIMENSION, AREA) - MISS_RATE) / NULLIF(COUNT(*) OVER (PARTITION BY DIMENSION, AREA) - 1, 0) AS OTHERS_MISS_RATE,
    AVG_RESPONSE_MS / NULLIF(AVG(AVG_RESPONSE_MS) OVER (PARTITION BY TRAINEE, DIMENSION), 0) AS SPEED_RATIO
  FROM rates
)
SELECT DIMENSION, AREA, ATTEMPTS, MISS_RATE, SPEED_RATIO, COHORT_SIZE, OTHERS_MISS_RATE
FROM cohort WHERE TRAINEE = ? QUALIFY UPDATED_AT = MAX(UPDATED_AT) OVER ()`;

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
const patternSchema = z.object({
  DIMENSION: z.enum(["pair", "channel", "tactic"]),
  AREA: z.string(),
  ATTEMPTS: z.coerce.number().int().positive(),
  MISS_RATE: unit,
  SPEED_RATIO: z.coerce.number().nonnegative().nullable(),
  COHORT_SIZE: z.coerce.number().int().positive(),
  OTHERS_MISS_RATE: unit.nullable(),
});
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

  /**
   * Uploads this trainee's aggregates, then returns Snowflake's ranking of their areas (with cohort placement) and its
   * interpretation. The ranking is required; a failed interpretation is just null.
   */
  async analyse(
    uid: string,
    summary: TrainingSummary,
    signal: AbortSignal,
  ): Promise<{ ranked: RankedArea[]; interp: Interpretation | null }> {
    this.ready ??= this.query(TABLE_DDL, [], signal).catch((error) => {
      this.ready = undefined;
      throw error;
    });
    await this.ready;
    const trainee = this.trainee(uid);
    const rows = [...summary.areas, ...summary.patterns].map((a) => ({
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
    const [ranking, interp] = await Promise.all([
      this.query(ANALYSE, [trainee], signal),
      this.query(INTERPRET, [trainee], signal)
        .then(interpret)
        .catch((error) => {
          console.warn(
            "[insights] Snowflake interpretation failed; ranking only:",
            error instanceof Error
              ? `${error.name}: ${error.message.slice(0, 160)}`
              : "unknown",
          );
          return null;
        }),
    ]);
    const result = z.array(rowSchema).parse(ranking);
    if (result.length !== summary.areas.length)
      throw new Error("Snowflake analysis is missing areas");
    return {
      ranked: result.map((r) => ({
        dimension: r.DIMENSION,
        area: r.AREA,
        attempts: r.ATTEMPTS,
        accuracy: r.ACCURACY,
        weakness: r.WEAKNESS,
        trend: r.TREND,
        cohortSize: r.COHORT_SIZE,
        cohortPercentile: r.COHORT_PERCENTILE,
      })),
      interp,
    };
  }

  /**
   * Cortex's reading of the computed results only (labels, rates, the deterministic next focus and why). Null when
   * unset, invalid or failed, so the caller keeps the Snowflake-computed text.
   */
  async cortexText(
    summary: TrainingSummary,
    ranked: RankedArea[],
    interp: Interpretation | null,
    insights: Insights,
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
        (r.cohortSize ?? 0) >= COHORT_MIN && (r.cohortPercentile ?? 0) >= 0.6,
    }));
    const focus = insights.nextTrainingFocus[0];
    const record =
      focus &&
      summary.areas.find((a) => a.dimension === "category" && a.area === focus);
    const facts = {
      strongest: insights.strongestAreas,
      weakest: insights.weakAreas,
      weakestCombination: interp?.weakPair && {
        tactics: pairLabel(interp.weakPair.tactics),
        missed: interp.weakPair.missed,
        of: interp.weakPair.attempts,
        otherTraineesMissRate:
          interp.weakPair.cohortMissRate === null
            ? null
            : Math.round(interp.weakPair.cohortMissRate * 100) / 100,
      },
      catchesQuickly: interp?.quickCatch && areaLabel(interp.quickCatch),
      practiseNext: focus && {
        area: areaLabel({ dimension: "category", area: focus }),
        why: record
          ? `right on ${record.correct} of ${record.attempts}`
          : "not practised yet",
      },
      results,
    };
    const prompt =
      "You coach someone practising how to spot scams in a training app. From these aggregate results, reply with only JSON " +
      '{"behavioralPattern": string, "recommendation": string}. Second person, warm and plain, no greeting, no numbers or facts beyond the data. ' +
      "behavioralPattern: one or two short sentences on what they catch (their strongest area, or what they catch quickly) and the pattern that " +
      'still fools them (prefer the weakest combination when there is one). recommendation: start with "Next: " and the practise-next area, ' +
      "say in a few words why it was chosen from the data, then one habit to use. At most two short sentences each.\n" +
      `Data: ${JSON.stringify(facts)}`;
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

  /** Cortex gets less time than the SQL: its text is optional and the user is waiting. */
  get cortexTimeoutMs() {
    return Math.min(this.timeoutMs, 6000);
  }
}

/** The weakest tactic pair and a quick catch, from INTERPRET's rows. */
export function interpret(rows: Record<string, unknown>[]): Interpretation {
  const parsed = z.array(patternSchema).parse(rows);
  const pair = parsed
    .filter((r) => r.DIMENSION === "pair" && r.ATTEMPTS >= 2 && r.MISS_RATE > 0)
    .sort((a, b) => b.MISS_RATE - a.MISS_RATE || b.ATTEMPTS - a.ATTEMPTS)[0];
  const tactics = pair?.AREA.split("+");
  const quick = parsed
    .filter(
      (r) =>
        r.DIMENSION !== "pair" &&
        r.ATTEMPTS >= 2 &&
        r.MISS_RATE === 0 &&
        r.SPEED_RATIO !== null &&
        r.SPEED_RATIO < 0.9,
    )
    .sort((a, b) => a.SPEED_RATIO! - b.SPEED_RATIO!)[0];
  return {
    weakPair:
      pair &&
      tactics?.length === 2 &&
      tactics.every((t) => Tactic.safeParse(t).success)
        ? {
            tactics: tactics as [Tactic, Tactic],
            attempts: pair.ATTEMPTS,
            missed: Math.round(pair.MISS_RATE * pair.ATTEMPTS),
            cohortMissRate:
              pair.COHORT_SIZE >= COHORT_MIN ? pair.OTHERS_MISS_RATE : null,
          }
        : null,
    quickCatch:
      quick &&
      (quick.DIMENSION === "tactic"
        ? Tactic
        : z.enum(["sms", "email", "call"])
      ).safeParse(quick.AREA).success
        ? {
            dimension: quick.DIMENSION as "tactic" | "channel",
            area: quick.AREA,
          }
        : null,
  };
}
