import type { Database } from '../db/database.ts';
import type { ScamCategory } from '../shared/vocabulary.ts';
import { HISTORY_LIMIT } from '../training/progress.ts';
import { buildInsights, rankLocally, summarize, type AttemptRow, type Insights } from './analysis.ts';

const iso = (value: Date | null) => value && new Date(value).toISOString();

export interface InsightsState {
  cached: (Insights & { lastAttemptAt: string | null; computedAt: string }) | null;
  /** The newest attempt's created_at: an analysis that predates it is stale. */
  lastAttemptAt: string | null;
}

export class InsightsRepository {
  private readonly db: Database;
  constructor(db: Database) { this.db = db; }

  /** The user's scored attempts (newest HISTORY_LIMIT), each with its behaviour events from TigerData folded in. */
  async attemptRows(uid: string): Promise<AttemptRow[]> {
    const { rows } = await this.db.query(`SELECT a.channel, a.scenario_id, a.scenario_title, a.scam_category, a.difficulty, a.outcome, a.success,
        a.tactics, a.completed_at, coalesce(e.link_clicked, false) AS link_clicked, coalesce(e.sender_inspected, false) AS sender_inspected, e.response_ms
      FROM training_attempts a
      LEFT JOIN (
        SELECT attempt_id, bool_or(event_type = 'link_clicked') AS link_clicked, bool_or(event_type = 'sender_inspected') AS sender_inspected,
          max(response_time_ms) FILTER (WHERE event_type = 'scenario_completed') AS response_ms
        FROM behavior_events WHERE firebase_uid = $1 GROUP BY attempt_id
      ) e ON e.attempt_id = a.id
      WHERE a.firebase_uid = $1 AND a.success IS NOT NULL
      ORDER BY a.completed_at DESC LIMIT $2`, [uid, HISTORY_LIMIT]);
    return rows.map((r) => ({
      channel: r.channel, scenarioId: r.scenario_id, scenarioTitle: r.scenario_title, scamCategory: r.scam_category, difficulty: r.difficulty,
      outcome: r.outcome, success: r.success, tactics: r.tactics, completedAt: iso(r.completed_at)!,
      linkClicked: r.link_clicked, senderInspected: r.sender_inspected, responseMs: r.response_ms,
    }));
  }

  async state(uid: string): Promise<InsightsState> {
    const { rows: [row] } = await this.db.query(`SELECT (SELECT max(created_at) FROM training_attempts WHERE firebase_uid = $1) AS newest,
        v.analysis, v.last_attempt_at, v.computed_at
      FROM (SELECT 1) one LEFT JOIN vulnerability_insights v ON v.firebase_uid = $1`, [uid]);
    return {
      lastAttemptAt: iso(row.newest),
      cached: row.analysis ? { ...row.analysis, lastAttemptAt: iso(row.last_attempt_at), computedAt: iso(row.computed_at)! } : null,
    };
  }

  async save(uid: string, insights: Insights, lastAttemptAt: string | null) {
    await this.db.query(`INSERT INTO vulnerability_insights(firebase_uid, analysis, source, last_attempt_at, computed_at) VALUES($1, $2, $3, $4, now())
      ON CONFLICT (firebase_uid) DO UPDATE SET analysis = $2, source = $3, last_attempt_at = $4, computed_at = now()`,
    [uid, JSON.stringify(insights), insights.source, lastAttemptAt]);
  }

  /**
   * What to train next, for the scenario generators: never calls Snowflake. The cached analysis when it covers the
   * newest attempt, otherwise the built-in analysis of the current history; [] for a new user.
   */
  async latestFocus(uid: string): Promise<ScamCategory[]> {
    const { cached, lastAttemptAt } = await this.state(uid);
    if (cached && cached.lastAttemptAt === lastAttemptAt) return cached.nextTrainingFocus;
    const summary = summarize(await this.attemptRows(uid));
    return summary.overall.attempts ? buildInsights(summary, rankLocally(summary), 'fallback').nextTrainingFocus : [];
  }
}
