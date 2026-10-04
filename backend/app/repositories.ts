import { BehaviorRepository } from "./behavior/behavior.repository.ts";
import type { Database } from "./db/database.ts";
import { InsightsRepository } from "./insights/insights.repository.ts";
import { ScenariosRepository } from "./scenarios/scenarios.repository.ts";
import { AttemptsRepository } from "./training/attempts.repository.ts";
import { UsersRepository } from "./users/users.repository.ts";

export interface Repositories {
  users: Pick<UsersRepository, keyof UsersRepository>;
  attempts: Pick<AttemptsRepository, keyof AttemptsRepository>;
  scenarios: Pick<ScenariosRepository, keyof ScenariosRepository>;
  behavior: Pick<BehaviorRepository, keyof BehaviorRepository>;
  insights: Pick<InsightsRepository, keyof InsightsRepository>;
}

export const createRepositories = (db: Database): Repositories => ({
  users: new UsersRepository(db),
  attempts: new AttemptsRepository(db),
  scenarios: new ScenariosRepository(db),
  behavior: new BehaviorRepository(db),
  insights: new InsightsRepository(db),
});
