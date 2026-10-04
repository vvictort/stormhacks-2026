import { randomUUID } from 'node:crypto';
import type { PoolClient, QueryResultRow } from 'pg';
import { transaction, type Database } from './database.js';
import { AppError } from '../core/errors.js';
import { userSchema, type Preferences } from '../schemas/user.js';
import { assessmentSchema, historyEntrySchema, scenarioSchema, type Assessment, type Scenario } from '../schemas/attempt.js';
import { patternSchema, recommendationSchema, type Pattern, type Recommendation } from '../schemas/personalization.js';
import { eventSchema, messageSchema, type BehavioralEvent, type Message } from '../schemas/message.js';
import type { Attempt } from '../models/attempt.js';
import type { GameSession } from '../models/campaign.js';

const iso = (value: Date | string) => new Date(value).toISOString();
function mapUser(r: QueryResultRow) {
  return userSchema.parse({ id: r.id, name: r.name, profession: r.profession, interests: r.interests, enabledChannels: r.enabled_channels, createdAt: iso(r.created_at) });
}
function mapSession(r: QueryResultRow): GameSession {
  return { id: r.id, userId: r.user_id, status: r.status, activeAttemptId: r.active_attempt_id, nextArrivalAt: r.next_arrival_at ? iso(r.next_arrival_at) : null };
}
function mapAttempt(r: QueryResultRow): Attempt {
  return { id: r.id, userId: r.user_id, sessionId: r.session_id, patternId: r.pattern_id, channel: r.channel, difficulty: r.difficulty, status: r.status, recommendation: recommendationSchema.parse(r.recommendation), scenario: r.scenario ? scenarioSchema.parse(r.scenario) : null, createdAt: iso(r.created_at) };
}
function mapPattern(r: QueryResultRow): Pattern {
  return patternSchema.parse({ id: r.id, kind: r.kind, channel: r.channel, category: r.category, tactics: r.tactics, contextTags: r.context_tags, example: r.example, warningSigns: r.warning_signs, provenance: r.provenance });
}
function mapAssessment(r: QueryResultRow): Assessment {
  return assessmentSchema.parse({ attemptId: r.attempt_id, rubricVersion: r.rubric_version, score: r.score, classification: r.classification, findings: r.findings, feedback: r.feedback });
}

export class Repositories {
  constructor(public readonly db: Database) {}

  async findUser(authIdentity: string) {
    const { rows } = await this.db.query('SELECT * FROM users WHERE auth_identity=$1', [authIdentity]);
    return rows[0] ? mapUser(rows[0]) : null;
  }
  async saveUser(authIdentity: string, input: Preferences) {
    const { rows } = await this.db.query(`INSERT INTO users(id,auth_identity,name,profession,interests,enabled_channels) VALUES($1,$2,$3,$4,$5,$6)
      ON CONFLICT(auth_identity) DO UPDATE SET name=EXCLUDED.name,profession=EXCLUDED.profession,interests=EXCLUDED.interests,enabled_channels=EXCLUDED.enabled_channels RETURNING *`,
    [randomUUID(), authIdentity, input.name, input.profession, input.interests, input.enabledChannels]);
    return mapUser(rows[0]!);
  }
  async requireUser(authIdentity: string) {
    const user = await this.findUser(authIdentity);
    if (!user) throw new AppError(404, 'PROFILE_REQUIRED', 'Complete your player profile first.');
    return user;
  }
  async patterns() {
    const { rows } = await this.db.query('SELECT * FROM scam_patterns ORDER BY id');
    return rows.map(mapPattern);
  }
  async history(userId: string) {
    const { rows } = await this.db.query(`SELECT a.*,t.pattern_id,t.channel,t.difficulty,p.kind FROM assessments a
      JOIN attempts t ON t.id=a.attempt_id JOIN scam_patterns p ON p.id=t.pattern_id
      WHERE a.user_id=$1 AND t.status IN ('awaiting_feedback','completed') ORDER BY a.assessed_at,a.attempt_id`, [userId]);
    return rows.map((r) => historyEntrySchema.parse({ ...mapAssessment(r), assessedAt: iso(r.assessed_at), patternId: r.pattern_id, channel: r.channel, difficulty: r.difficulty, kind: r.kind }));
  }
  async recentPatterns(userId: string) {
    const { rows } = await this.db.query("SELECT pattern_id FROM attempts WHERE user_id=$1 AND status<>'generation_failed' ORDER BY created_at DESC,id DESC LIMIT 3", [userId]);
    return rows.map((r) => r.pattern_id as string);
  }
  async startSession(userId: string, delayMs: number, now = new Date()) {
    return transaction(this.db, async (c) => {
      await c.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [userId]);
      const existing = await c.query("SELECT * FROM game_sessions WHERE user_id=$1 AND status<>'ended'", [userId]);
      if (existing.rows[0]) return mapSession(existing.rows[0]);
      const { rows } = await c.query("INSERT INTO game_sessions(id,user_id,status,next_arrival_at) VALUES($1,$2,'active',$3) RETURNING *", [randomUUID(), userId, new Date(now.getTime()+delayMs)]);
      return mapSession(rows[0]!);
    });
  }
  async currentSession(userId: string) {
    const { rows } = await this.db.query("SELECT * FROM game_sessions WHERE user_id=$1 AND status<>'ended'", [userId]);
    return rows[0] ? mapSession(rows[0]) : null;
  }
  private async lockSession(c: PoolClient, userId: string, sessionId: string) {
    const { rows } = await c.query('SELECT * FROM game_sessions WHERE id=$1 AND user_id=$2 FOR UPDATE', [sessionId,userId]);
    if (!rows[0]) throw new AppError(404,'SESSION_NOT_FOUND','Session not found.');
    return mapSession(rows[0]);
  }
  async setSessionStatus(userId: string, sessionId: string, status: 'active'|'paused', delayMs: number, now = new Date()) {
    return transaction(this.db, async (c) => {
      const s = await this.lockSession(c,userId,sessionId);
      if (s.status==='ended') throw new AppError(409,'SESSION_ENDED','Session has ended.');
      if (s.status===status) return s;
      const next = status==='active' && !s.activeAttemptId ? new Date(now.getTime()+delayMs) : null;
      const { rows } = await c.query('UPDATE game_sessions SET status=$1,next_arrival_at=$2 WHERE id=$3 RETURNING *',[status,next,sessionId]);
      return mapSession(rows[0]!);
    });
  }
  async endSession(userId: string, sessionId: string) {
    return transaction(this.db, async (c) => {
      const session = await this.lockSession(c, userId, sessionId);
      if (session.status === 'ended') return;
      if (session.activeAttemptId) {
        // Preserve a finalized assessment; unfinished attempts remain unassessed.
        await c.query(`UPDATE attempts SET status=CASE WHEN status='awaiting_feedback' THEN 'completed' ELSE 'abandoned' END,
          finished_at=COALESCE(finished_at,now()) WHERE id=$1`, [session.activeAttemptId]);
      }
      await c.query("UPDATE game_sessions SET status='ended',active_attempt_id=NULL,next_arrival_at=NULL WHERE id=$1", [sessionId]);
    });
  }
  async attempt(userId: string, attemptId: string) {
    const { rows } = await this.db.query('SELECT * FROM attempts WHERE id=$1 AND user_id=$2',[attemptId,userId]);
    if (!rows[0]) throw new AppError(404,'ATTEMPT_NOT_FOUND','Attempt not found.');
    return mapAttempt(rows[0]);
  }
  async reserveAttempt(userId: string, sessionId: string, input: Recommendation, now = new Date()) {
    const rec = recommendationSchema.parse(input);
    return transaction(this.db, async (c) => {
      const s = await this.lockSession(c,userId,sessionId);
      if (s.status!=='active' || s.activeAttemptId || !s.nextArrivalAt || new Date(s.nextArrivalAt)>now) return null;
      const prefs = await c.query('SELECT enabled_channels FROM users WHERE id=$1 FOR SHARE',[userId]);
      const pattern = await c.query('SELECT * FROM scam_patterns WHERE id=$1',[rec.patternId]);
      const p = pattern.rows[0];
      if (!p || p.channel!==rec.channel || !prefs.rows[0]?.enabled_channels.includes(rec.channel) || rec.targetedTactics.some((t) => !p.tactics.includes(t))) {
        throw new AppError(409,'STALE_RECOMMENDATION','Recommendation no longer matches enabled channels or patterns.');
      }
      const id = randomUUID();
      const { rows } = await c.query(`INSERT INTO attempts(id,user_id,session_id,pattern_id,channel,difficulty,status,recommendation,created_at)
        VALUES($1,$2,$3,$4,$5,$6,'reserved',$7,$8) RETURNING *`,[id,userId,sessionId,rec.patternId,rec.channel,rec.difficulty,rec,now]);
      await c.query('UPDATE game_sessions SET active_attempt_id=$1,next_arrival_at=NULL WHERE id=$2',[id,sessionId]);
      return mapAttempt(rows[0]!);
    });
  }
  // Every attempt mutation locks its session first, then its attempt, preventing lock-order deadlocks.
  private async lockAttempt(c: PoolClient, userId: string, attemptId: string) {
    const lookup = await c.query('SELECT session_id FROM attempts WHERE id=$1 AND user_id=$2',[attemptId,userId]);
    if (!lookup.rows[0]) throw new AppError(404,'ATTEMPT_NOT_FOUND','Attempt not found.');
    const session = await this.lockSession(c,userId,lookup.rows[0].session_id);
    const { rows } = await c.query('SELECT * FROM attempts WHERE id=$1 AND user_id=$2 FOR UPDATE',[attemptId,userId]);
    return { session, attempt: mapAttempt(rows[0]!) };
  }
  async publishAttempt(userId: string, attemptId: string, input: Scenario) {
    const scenario = scenarioSchema.parse(input);
    return transaction(this.db,async (c) => {
      const { attempt } = await this.lockAttempt(c,userId,attemptId);
      if (attempt.status!=='reserved') throw new AppError(409,'INVALID_STATE','Only reserved attempts can be published.');
      const { rows } = await c.query("UPDATE attempts SET status='ready',scenario=$1,ready_at=now() WHERE id=$2 RETURNING *",[scenario,attemptId]);
      return mapAttempt(rows[0]!);
    });
  }
  async abandonAttempt(userId: string, attemptId: string, generationFailed=false) {
    return transaction(this.db,async (c) => {
      const { attempt,session } = await this.lockAttempt(c,userId,attemptId);
      if (['completed','abandoned','generation_failed'].includes(attempt.status)) return;
      if (generationFailed && attempt.status !== 'reserved') throw new AppError(409, 'INVALID_STATE', 'Generation failure only applies to a reserved attempt.');
      if (attempt.status==='awaiting_feedback') throw new AppError(409,'FEEDBACK_REQUIRED','Acknowledge assessed feedback instead.');
      await c.query('UPDATE attempts SET status=$1,finished_at=now() WHERE id=$2',[generationFailed?'generation_failed':'abandoned',attemptId]);
      await c.query('UPDATE game_sessions SET active_attempt_id=NULL,next_arrival_at=$1 WHERE id=$2',[session.status==='active'?new Date(Date.now()+15000):null,session.id]);
    });
  }
  async appendEvent(userId: string, attemptId: string, input: BehavioralEvent) {
    const event=eventSchema.parse(input);
    return transaction(this.db,async (c) => {
      const { attempt,session } = await this.lockAttempt(c,userId,attemptId);
      const prior=await c.query('SELECT * FROM behavioral_events WHERE event_id=$1',[event.eventId]);
      if (prior.rows[0]) {
        if (prior.rows[0].user_id!==userId || prior.rows[0].attempt_id!==attemptId) throw new AppError(409,'EVENT_CONFLICT','Event ID already exists.');
        return false;
      }
      if (session.status!=='active' || !['ready','active'].includes(attempt.status)) throw new AppError(409,'INVALID_STATE','Attempt is not accepting actions.');
      await c.query('INSERT INTO behavioral_events(event_id,user_id,attempt_id,action,occurred_at,metadata) VALUES($1,$2,$3,$4,$5,$6)',[event.eventId,userId,attemptId,event.action,event.occurredAt,event.metadata]);
      await c.query("UPDATE attempts SET status='active',started_at=COALESCE(started_at,now()) WHERE id=$1",[attemptId]);
      return true;
    });
  }
  async appendMessage(userId: string, attemptId: string, input: Message) {
    const message=messageSchema.parse(input);
    return transaction(this.db,async (c) => {
      const { attempt,session }=await this.lockAttempt(c,userId,attemptId);
      const prior=await c.query('SELECT * FROM messages WHERE id=$1',[message.id]);
      if (prior.rows[0]) {
        if (prior.rows[0].user_id!==userId || prior.rows[0].attempt_id!==attemptId) throw new AppError(409,'MESSAGE_CONFLICT','Message ID already exists.');
        return false;
      }
      if (session.status!=='active' || !['ready','active'].includes(attempt.status)) throw new AppError(409,'INVALID_STATE','Attempt is not accepting messages.');
      await c.query('INSERT INTO messages(id,user_id,attempt_id,role,content,occurred_at) VALUES($1,$2,$3,$4,$5,$6)',[message.id,userId,attemptId,message.role,message.content,message.occurredAt]);
      return true;
    });
  }
  // Trusted server-side AI hook. Deliberately not mounted as a browser HTTP endpoint.
  async finalizeAssessment(userId: string, input: Assessment) {
    const assessment=assessmentSchema.parse(input);
    return transaction(this.db,async (c) => {
      const { attempt }=await this.lockAttempt(c,userId,assessment.attemptId);
      const prior=await c.query('SELECT * FROM assessments WHERE attempt_id=$1',[assessment.attemptId]);
      if (prior.rows[0]) return mapAssessment(prior.rows[0]);
      if (!['ready','active'].includes(attempt.status)) throw new AppError(409,'INVALID_STATE','Attempt cannot be assessed.');
      const pattern=await c.query('SELECT kind,tactics FROM scam_patterns WHERE id=$1',[attempt.patternId]);
      if (assessment.findings.some((f) => !pattern.rows[0]!.tactics.includes(f.tactic))) throw new AppError(400,'INVALID_ASSESSMENT','Findings must match the scenario tactics.');
      const { rows }=await c.query(`INSERT INTO assessments(attempt_id,user_id,rubric_version,score,classification,findings,feedback)
        VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,[assessment.attemptId,userId,assessment.rubricVersion,assessment.score,assessment.classification,JSON.stringify(assessment.findings),assessment.feedback]);
      await c.query("UPDATE attempts SET status='awaiting_feedback',finished_at=now() WHERE id=$1",[assessment.attemptId]);
      return mapAssessment(rows[0]!);
    });
  }
  async acknowledgeFeedback(userId: string, attemptId: string, delayMs: number, now=new Date()) {
    return transaction(this.db,async (c) => {
      const { attempt,session }=await this.lockAttempt(c,userId,attemptId);
      if (attempt.status==='completed') return;
      if (attempt.status!=='awaiting_feedback') throw new AppError(409,'INVALID_STATE','No assessed feedback to acknowledge.');
      await c.query("UPDATE attempts SET status='completed' WHERE id=$1",[attemptId]);
      await c.query('UPDATE game_sessions SET active_attempt_id=NULL,next_arrival_at=$1 WHERE id=$2',[session.status==='active'?new Date(now.getTime()+delayMs):null,session.id]);
    });
  }
  async publicAttempt(userId: string, attemptId: string) {
    const a=await this.attempt(userId,attemptId);
    const messages=await this.db.query('SELECT id,role,content,occurred_at FROM messages WHERE attempt_id=$1 AND user_id=$2 ORDER BY occurred_at,id',[attemptId,userId]);
    const publicData={ id:a.id, channel:a.channel, status:a.status, createdAt:a.createdAt, scenario:a.scenario, messages:messages.rows.map((r) => ({ id:r.id,role:r.role,content:r.content,occurredAt:iso(r.occurred_at) })) };
    if (!['awaiting_feedback','completed'].includes(a.status)) return { ...publicData,feedback:null };
    const result=await this.db.query('SELECT * FROM assessments WHERE attempt_id=$1 AND user_id=$2',[attemptId,userId]);
    const pattern=await this.db.query('SELECT * FROM scam_patterns WHERE id=$1',[a.patternId]);
    const p=mapPattern(pattern.rows[0]!);
    return { ...publicData,feedback:{ assessment:mapAssessment(result.rows[0]!),kind:p.kind,warningSigns:p.warningSigns,provenance:p.provenance } };
  }
  async assessmentContext(userId: string, attemptId: string) {
    // Private handoff to Sijing's scoring adapter, never a frontend response.
    const attempt = await this.attempt(userId, attemptId);
    const [pattern, messages, events] = await Promise.all([
      this.db.query('SELECT * FROM scam_patterns WHERE id=$1', [attempt.patternId]),
      this.db.query('SELECT * FROM messages WHERE user_id=$1 AND attempt_id=$2 ORDER BY occurred_at,id', [userId, attemptId]),
      this.db.query('SELECT * FROM behavioral_events WHERE user_id=$1 AND attempt_id=$2 ORDER BY occurred_at,event_id', [userId, attemptId]),
    ]);
    return {
      attempt,
      pattern: mapPattern(pattern.rows[0]!),
      messages: messages.rows.map((r) => ({ id:r.id,role:r.role,content:r.content,occurredAt:iso(r.occurred_at) })),
      events: events.rows.map((r) => ({ eventId:r.event_id,action:r.action,occurredAt:iso(r.occurred_at),metadata:r.metadata })),
    };
  }
}
