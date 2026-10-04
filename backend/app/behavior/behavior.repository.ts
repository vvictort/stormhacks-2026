import type { Database } from '../db/database.ts';
import type { BehaviorEventType, Channel, Difficulty, Outcome, ScamCategory } from '../shared/vocabulary.ts';

/** One row of `behavior_events` (migration 005): a TimescaleDB hypertable on TigerData. */
export interface BehaviorEvent {
  at: string;
  uid: string;
  type: BehaviorEventType;
  channel: Channel;
  scenarioId: string;
  attemptId: string;
  scamCategory: ScamCategory | null;
  difficulty: Difficulty | null;
  outcome: Outcome | null;
  responseTimeMs: number | null;
  metadata: Record<string, unknown>;
}

/** Where behaviour events live: a TimescaleDB hypertable (TigerData) or a plain Postgres table. */
export type Storage = 'timescale' | 'postgres';

export interface Period { accuracy: number | null; avgDetectionMs: number | null }
export interface CategoryMetrics extends Period { category: ScamCategory; attempts: number }
export interface Metrics {
  /** Scored, completed attempts (errors and abandoned calls never count). */
  attempts: number;
  /** 0 to 100. */
  accuracy: number | null;
  /** Scam texts and emails reported, of all scam texts and emails seen; 0 to 100. */
  reportRate: number | null;
  /** Decision time on texts and emails, ring time on declined calls. */
  avgDetectionMs: number | null;
  /** The first `window` completed attempts against the latest `window` (min(5, half the history)); null under 2 attempts. */
  trend: { window: number; then: Period; now: Period } | null;
  categories: CategoryMetrics[];
  mostImproved: { category: ScamCategory; then: Period; now: Period } | null;
  /** Per UTC day, oldest first. */
  timeline: { day: string; attempts: number; correct: number; avgDetectionMs: number | null }[];
  /** The latest RECENT completed attempts, oldest first: one bar each on Home, since a same-day history is one day. */
  recent: { at: string; correct: boolean; detectionMs: number | null }[];
  storage: Storage;
}

const RECENT = 12;

// Completed, scored attempts, one per attempt id (a retried batch can repeat an event), each numbered overall and within
// its category so the first and latest halves can be compared. Portable SQL: the same query runs on PGlite in tests.
const SCORED = `WITH done AS (
  SELECT DISTINCT ON (attempt_id) event_time, channel, scam_category, outcome, response_time_ms
  FROM behavior_events
  WHERE firebase_uid = $1 AND event_type = 'scenario_completed' AND outcome IS NOT NULL AND outcome <> 'error'
  ORDER BY attempt_id, event_time
), scored AS (
  SELECT event_time, scam_category, outcome,
    (outcome NOT IN ('compromised', 'reported_incorrect', 'safe_incorrect'))::int AS correct,
    CASE WHEN channel <> 'call' OR outcome = 'declined' THEN response_time_ms END AS detection_ms,
    row_number() OVER (ORDER BY event_time) AS n, count(*) OVER () AS total,
    row_number() OVER (PARTITION BY scam_category ORDER BY event_time) AS cn, count(*) OVER (PARTITION BY scam_category) AS ctotal
  FROM done
)`;

/** An average as a 0–100 percentage / whole milliseconds; null over no rows. */
const where = (filter?: string) => (filter ? ` FILTER (WHERE ${filter})` : '');
const pct = (expr: string, filter?: string) => `round(100 * avg(${expr})${where(filter)})::int`;
const ms = (expr: string, filter?: string) => `round(avg(${expr})${where(filter)})::int`;
/** The first k and the latest k rows by `n` (numbered 1..total), k = min(5, total / 2). */
const halves = (n: string, total: string) => {
  const k = `least(5, ${total} / 2)`;
  const first = `${n} <= ${k}`, latest = `${n} > ${total} - ${k}`;
  return `max(${k})::int AS k,
    ${pct('correct', first)} AS then_accuracy, ${ms('detection_ms', first)} AS then_detection,
    ${pct('correct', latest)} AS now_accuracy, ${ms('detection_ms', latest)} AS now_detection`;
};

const period = (row: Record<string, number | null>, side: 'then' | 'now'): Period =>
  ({ accuracy: row[`${side}_accuracy`] ?? null, avgDetectionMs: row[`${side}_detection`] ?? null });

/** Greatest accuracy gain; with equal accuracy, the biggest drop in detection time. Null without a real improvement. */
export function mostImproved(categories: { category: ScamCategory; then: Period; now: Period }[]) {
  const gain = (c: (typeof categories)[number]) => (c.now.accuracy ?? 0) - (c.then.accuracy ?? 0);
  const faster = (c: (typeof categories)[number]) =>
    c.then.avgDetectionMs !== null && c.now.avgDetectionMs !== null ? c.then.avgDetectionMs - c.now.avgDetectionMs : 0;
  return categories
    // Faster alone counts only when they still get some right: falling for it faster isn't improving.
    .filter((c) => gain(c) > 0 || (gain(c) === 0 && faster(c) > 0 && (c.now.accuracy ?? 0) > 0))
    .sort((a, b) => gain(b) - gain(a) || faster(b) - faster(a))[0] ?? null;
}

export class BehaviorRepository {
  private readonly db: Database;
  private storageKind?: Promise<Storage>;
  constructor(db: Database) { this.db = db; }

  /** Whether behavior_events is a hypertable (migration 005 makes it one when timescaledb exists). Cached per process. */
  storage(): Promise<Storage> {
    this.storageKind ??= (async (): Promise<Storage> => {
      const { rows: [ext] } = await this.db.query(`SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') AS found`);
      if (!ext.found) return 'postgres';
      // timescaledb_information only exists with the extension, so it's queried only after the check above.
      const { rows: [hyper] } = await this.db.query(`SELECT EXISTS (SELECT 1 FROM timescaledb_information.hypertables
        WHERE hypertable_name = 'behavior_events') AS found`);
      return hyper.found ? 'timescale' : 'postgres';
    })().catch((error) => { this.storageKind = undefined; throw error; });
    return this.storageKind;
  }

  /** One multi-row INSERT. */
  async record(events: BehaviorEvent[]) {
    if (!events.length) return;
    const columns = 11;
    const values = events.map((_, i) => `(${Array.from({ length: columns }, (_, c) => `$${i * columns + c + 1}`).join(',')})`);
    await this.db.query(
      `INSERT INTO behavior_events(event_time,firebase_uid,event_type,channel,scenario_id,attempt_id,scam_category,difficulty,outcome,response_time_ms,metadata)
       VALUES ${values.join(',')}`,
      events.flatMap((e) => [e.at, e.uid, e.type, e.channel, e.scenarioId, e.attemptId, e.scamCategory, e.difficulty, e.outcome, e.responseTimeMs, JSON.stringify(e.metadata)]),
    );
  }

  // ponytail: recomputed per request over the user's whole history; add a continuous aggregate if histories get long.
  async metrics(uid: string): Promise<Metrics> {
    const [{ rows: [overall] }, { rows: categoryRows }, { rows: days }, { rows: recent }, storage] = await Promise.all([
      this.db.query(`${SCORED} SELECT count(*)::int AS attempts, ${pct('correct')} AS accuracy, ${ms('detection_ms')} AS detection,
          ${pct("(outcome = 'reported_correct')::int", "outcome IN ('reported_correct', 'safe_incorrect')")} AS report_rate,
          ${halves('n', 'total')}
        FROM scored`, [uid]),
      this.db.query(`${SCORED} SELECT scam_category AS category, count(*)::int AS attempts, ${pct('correct')} AS accuracy, ${ms('detection_ms')} AS detection,
          ${halves('cn', 'ctotal')}
        FROM scored GROUP BY scam_category ORDER BY count(*) DESC, scam_category`, [uid]),
      this.db.query(`${SCORED} SELECT to_char(date_trunc('day', event_time AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
          count(*)::int AS attempts, sum(correct)::int AS correct, ${ms('detection_ms')} AS detection
        FROM scored GROUP BY 1 ORDER BY 1`, [uid]),
      this.db.query(`${SCORED} SELECT event_time, correct, detection_ms FROM scored ORDER BY n DESC LIMIT ${RECENT}`, [uid]),
      // Attribution only: an unreadable catalog is reported as plain Postgres rather than failing the metrics.
      this.storage().catch((): Storage => 'postgres'),
    ]);

    const categories = categoryRows.map((r) => ({ category: r.category as ScamCategory, attempts: r.attempts, accuracy: r.accuracy, avgDetectionMs: r.detection, k: r.k as number, then: period(r, 'then'), now: period(r, 'now') }));
    const improved = mostImproved(categories.filter((c) => c.k > 0));
    return {
      attempts: overall.attempts,
      accuracy: overall.accuracy,
      reportRate: overall.report_rate,
      avgDetectionMs: overall.detection,
      trend: (overall.k ?? 0) > 0 ? { window: overall.k, then: period(overall, 'then'), now: period(overall, 'now') } : null,
      categories: categories.map(({ category, attempts, accuracy, avgDetectionMs }) => ({ category, attempts, accuracy, avgDetectionMs })),
      mostImproved: improved && { category: improved.category, then: improved.then, now: improved.now },
      timeline: days.map((d) => ({ day: d.day, attempts: d.attempts, correct: d.correct, avgDetectionMs: d.detection })),
      recent: recent.reverse().map((r) => ({ at: new Date(r.event_time).toISOString(), correct: r.correct === 1, detectionMs: r.detection_ms })),
      storage,
    };
  }
}
