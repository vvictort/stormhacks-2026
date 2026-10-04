import type { Database } from './db/database.ts';
import { ScenariosRepository } from './scenarios/scenarios.repository.ts';
import { AttemptsRepository } from './training/attempts.repository.ts';
import { UsersRepository } from './users/users.repository.ts';

export interface Repositories {
  users: Pick<UsersRepository, keyof UsersRepository>;
  attempts: Pick<AttemptsRepository, keyof AttemptsRepository>;
  scenarios: Pick<ScenariosRepository, keyof ScenariosRepository>;
}

export const createRepositories = (db: Database): Repositories => ({
  users: new UsersRepository(db),
  attempts: new AttemptsRepository(db),
  scenarios: new ScenariosRepository(db),
});
