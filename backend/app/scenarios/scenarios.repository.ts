import { transaction, type Database } from '../db/database.ts';
import type { CallScenario } from '../shared/types.ts';
import type { CallTeaching } from './callContent.ts';

export type ScenarioSource = 'gemini' | 'fallback';

/** A generated call as stored: the caller (server-only) plus the teaching copy the browser may see. */
export type StoredCallScenario = CallScenario & { teaching?: CallTeaching & { generated: { source: ScenarioSource; reason: string } } };

export class ScenariosRepository {
  private readonly db: Database;
  constructor(db: Database) { this.db = db; }

  async save(uid: string, scenario: StoredCallScenario, source: ScenarioSource) {
    await this.db.query('INSERT INTO generated_call_scenarios(id,firebase_uid,scenario,source) VALUES($1,$2,$3,$4)',[scenario.id,uid,JSON.stringify(scenario),source]);
  }

  /** Only the owner's scenario; anyone else gets null. */
  async get(uid: string, id: string): Promise<StoredCallScenario | null> {
    const { rows: [row] } = await this.db.query('SELECT scenario FROM generated_call_scenarios WHERE id=$1 AND firebase_uid=$2',[id,uid]);
    return row?.scenario ?? null;
  }

  /**
   * Counts a generation request against the user's per-minute and per-day limits; false (nothing recorded) when
   * either is used up. The per-user advisory lock makes count-then-insert atomic across requests and processes.
   */
  async claimGeneration(uid: string, perMinute: number, perDay: number) {
    return transaction(this.db, async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`scenario-generation:${uid}`]);
      await client.query("DELETE FROM scenario_generation_requests WHERE firebase_uid=$1 AND requested_at <= now() - interval '1 day'", [uid]);
      const { rows: [used] } = await client.query(
        "SELECT count(*)::int AS day, (count(*) FILTER (WHERE requested_at > now() - interval '1 minute'))::int AS minute FROM scenario_generation_requests WHERE firebase_uid=$1",
        [uid],
      );
      if (used.day >= perDay || used.minute >= perMinute) return false;
      await client.query('INSERT INTO scenario_generation_requests(firebase_uid) VALUES($1)', [uid]);
      return true;
    });
  }
}
