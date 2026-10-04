import type { QueryResultRow } from "pg";
import type { Database } from "../db/database.ts";
import type {
  AttemptDetail,
  AttemptInput,
  AttemptSummary,
} from "./attempts.schema.ts";

const iso = (value: Date | null) => value && new Date(value).toISOString();
function mapAttempt(row: QueryResultRow): AttemptSummary {
  return {
    id: row.id,
    channel: row.channel,
    scenarioId: row.scenario_id,
    scenarioTitle: row.scenario_title,
    difficulty: row.difficulty,
    scamCategory: row.scam_category,
    outcome: row.outcome,
    success: row.success,
    tactics: row.tactics,
    completedAt: iso(row.completed_at)!,
    confidence: (row.metadata?.confidence as string) ?? null,
  };
}
const summaryColumns =
  "id,channel,scenario_id,scenario_title,difficulty,scam_category,outcome,success,tactics,completed_at,metadata";

export class AttemptsRepository {
  private readonly db: Database;
  constructor(db: Database) {
    this.db = db;
  }

  /** Returns false when the attempt id already exists. */
  async insert(a: AttemptInput) {
    const { rowCount } = await this.db.query(
      `INSERT INTO training_attempts(id,firebase_uid,channel,scenario_id,scenario_title,difficulty,outcome,success,
      tactics,signals,started_at,completed_at,duration_secs,metadata,scam_category) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) ON CONFLICT(id) DO NOTHING`,
      [
        a.attemptId,
        a.firebaseUid,
        a.channel,
        a.scenarioId,
        a.scenarioTitle,
        a.difficulty,
        a.outcome,
        a.success,
        a.tactics,
        a.signals,
        a.startedAt,
        a.completedAt,
        a.durationSecs,
        JSON.stringify({ summary: a.summary, transcript: a.transcript, ...(a.metadata ?? {}) }),
        a.scamCategory,
      ],
    );
    return rowCount === 1;
  }

  async list(uid: string, limit: number): Promise<AttemptSummary[]> {
    const { rows } = await this.db.query(
      `SELECT ${summaryColumns} FROM training_attempts WHERE firebase_uid=$1 ORDER BY completed_at DESC, created_at DESC LIMIT $2`,
      [uid, limit],
    );
    return rows.map(mapAttempt);
  }

  async get(uid: string, id: string): Promise<AttemptDetail | null> {
    const {
      rows: [row],
    } = await this.db.query(
      `SELECT ${summaryColumns},signals,started_at,duration_secs,metadata FROM training_attempts WHERE id=$1 AND firebase_uid=$2`,
      [id, uid],
    );
    if (!row) return null;
    return {
      ...mapAttempt(row),
      signals: row.signals,
      startedAt: iso(row.started_at),
      durationSecs: row.duration_secs,
      summary: row.metadata.summary ?? null,
      transcript: row.metadata.transcript ?? [],
    };
  }
}
