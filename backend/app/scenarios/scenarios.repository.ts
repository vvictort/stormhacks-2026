import type { Database } from '../db/database.ts';
import type { CallScenario } from './call-scenario.ts';

export type ScenarioSource = 'gemini' | 'fallback';

export class ScenariosRepository {
  constructor(private readonly db: Database) {}

  async save(uid: string, scenario: CallScenario, source: ScenarioSource) {
    await this.db.query('INSERT INTO generated_call_scenarios(id,firebase_uid,scenario,source) VALUES($1,$2,$3,$4)',[scenario.id,uid,JSON.stringify(scenario),source]);
  }

  /** Only the owner's scenario; anyone else gets null. */
  async get(uid: string, id: string): Promise<CallScenario | null> {
    const { rows: [row] } = await this.db.query('SELECT scenario FROM generated_call_scenarios WHERE id=$1 AND firebase_uid=$2',[id,uid]);
    return row?.scenario ?? null;
  }
}
