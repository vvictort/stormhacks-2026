import type { User } from '../schemas/user.js';
import type { Pattern,Recommendation } from '../schemas/personalization.js';
import type { Scenario } from '../schemas/attempt.js';

// Sijing implements this adapter. The pattern and recommendation are private context.
export interface ScenarioGenerator {
  generate(input: { attemptId:string; user:User; pattern:Pattern; recommendation:Recommendation }): Promise<Scenario>;
}
