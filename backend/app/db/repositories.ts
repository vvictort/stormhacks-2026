import { randomUUID } from 'node:crypto';
import type { QueryResultRow } from 'pg';
import type { DecodedIdToken } from 'firebase-admin/auth';
import type { Database } from './database.ts';
import type { ProfileInput, User } from '../schemas/user.ts';
import type { AttemptDetail, AttemptInput, AttemptSummary } from '../schemas/training.ts';
import type { CallScenario } from '../../comms/src/types.ts';
import { AppError } from '../core/errors.ts';
function mapUser(row: QueryResultRow): User {
  return { id: row.id, uid: row.firebase_uid, email: row.email, emailVerified: row.email_verified, name: row.name, phone: row.phone, profession: row.profession, interests: row.interests, onboardingComplete: Boolean(row.onboarding_completed_at), createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString() };
}
const iso = (value: Date | null) => value && new Date(value).toISOString();
function mapAttempt(row: QueryResultRow): AttemptSummary {
  return { id: row.id, channel: row.channel, scenarioId: row.scenario_id, scenarioTitle: row.scenario_title, difficulty: row.difficulty, outcome: row.outcome, success: row.success, tactics: row.tactics, completedAt: iso(row.completed_at)! };
}
const summaryColumns = 'id,channel,scenario_id,scenario_title,difficulty,outcome,success,tactics,completed_at';
export class Repositories {
  constructor(public readonly db: Database) {}
  async ensureUser(identity: DecodedIdToken) {
    if (!identity.email) throw new AppError(401, 'INVALID_TOKEN', 'An account email is required.');
    const name = typeof identity.name === 'string' ? identity.name.trim().slice(0,100) || null : null;
    const { rows } = await this.db.query(`INSERT INTO user_profiles(id,firebase_uid,email,email_verified,name)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT(firebase_uid) DO UPDATE SET email=EXCLUDED.email,email_verified=EXCLUDED.email_verified,
      name=COALESCE(user_profiles.name,EXCLUDED.name) RETURNING *`,[randomUUID(),identity.uid,identity.email,identity.email_verified ?? false,name]);
    return mapUser(rows[0]);
  }
  async updateProfile(identity: DecodedIdToken, profile: ProfileInput) {
    if (!identity.email) throw new AppError(401, 'INVALID_TOKEN', 'An account email is required.');
    const { rows } = await this.db.query(`INSERT INTO user_profiles(id,firebase_uid,email,email_verified,name,phone,profession,interests,onboarding_completed_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,now()) ON CONFLICT(firebase_uid) DO UPDATE SET email=EXCLUDED.email,email_verified=EXCLUDED.email_verified,
      name=EXCLUDED.name,phone=EXCLUDED.phone,profession=EXCLUDED.profession,interests=EXCLUDED.interests,
      onboarding_completed_at=COALESCE(user_profiles.onboarding_completed_at,now()),updated_at=now() RETURNING *`,
      [randomUUID(),identity.uid,identity.email,identity.email_verified ?? false,profile.name,profile.phone,profile.profession,profile.interests]);
    return mapUser(rows[0]);
  }
  /** Returns false when the attempt id already exists. */
  async insertAttempt(a: AttemptInput) {
    const { rowCount } = await this.db.query(`INSERT INTO training_attempts(id,firebase_uid,channel,scenario_id,scenario_title,difficulty,outcome,success,
      tactics,signals,started_at,completed_at,duration_secs,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT(id) DO NOTHING`,
      [a.attemptId,a.firebaseUid,a.channel,a.scenarioId,a.scenarioTitle,a.difficulty,a.outcome,a.success,a.tactics,a.signals,a.startedAt,a.completedAt,a.durationSecs,
        JSON.stringify({ summary: a.summary, transcript: a.transcript })]);
    return rowCount === 1;
  }
  async listAttempts(uid: string, limit: number): Promise<AttemptSummary[]> {
    const { rows } = await this.db.query(`SELECT ${summaryColumns} FROM training_attempts WHERE firebase_uid=$1 ORDER BY completed_at DESC, created_at DESC LIMIT $2`,[uid,limit]);
    return rows.map(mapAttempt);
  }
  async getAttempt(uid: string, id: string): Promise<AttemptDetail | null> {
    const { rows: [row] } = await this.db.query(`SELECT ${summaryColumns},signals,started_at,duration_secs,metadata FROM training_attempts WHERE id=$1 AND firebase_uid=$2`,[id,uid]);
    if (!row) return null;
    return { ...mapAttempt(row), signals: row.signals, startedAt: iso(row.started_at), durationSecs: row.duration_secs, summary: row.metadata.summary ?? null, transcript: row.metadata.transcript ?? [] };
  }
  async saveScenario(uid: string, scenario: CallScenario, source: 'gemini' | 'fallback') {
    await this.db.query('INSERT INTO generated_call_scenarios(id,firebase_uid,scenario,source) VALUES($1,$2,$3,$4)',[scenario.id,uid,JSON.stringify(scenario),source]);
  }
  async getScenario(uid: string, id: string): Promise<CallScenario | null> {
    const { rows: [row] } = await this.db.query('SELECT scenario FROM generated_call_scenarios WHERE id=$1 AND firebase_uid=$2',[id,uid]);
    return row?.scenario ?? null;
  }
}
