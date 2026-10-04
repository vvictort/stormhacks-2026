import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createDatabase, transaction, type Database } from './database.ts';
import { loadConfig } from '../config.ts';

const directory = fileURLToPath(new URL('./migrations', import.meta.url));
const migrationFiles = async () => (await readdir(directory)).filter((x) => x.endsWith('.sql')).sort();

/** Migration files not yet recorded in schema_migrations (all of them on a fresh database). Read-only. */
export async function pendingMigrations(db: Database) {
  const applied = await db.query('SELECT version FROM schema_migrations').then(
    ({ rows }) => new Set(rows.map((row) => row.version as string)),
    (error) => { if (error?.code === '42P01') return new Set<string>(); throw error; },
  );
  return (await migrationFiles()).filter((file) => !applied.has(file));
}

export async function migrate(db: Database) {
  await transaction(db, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('scam-training-migrations'))");
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    for (const file of await migrationFiles()) {
      const existing = await client.query('SELECT 1 FROM schema_migrations WHERE version = $1', [file]);
      if (existing.rowCount) continue;
      await client.query(await readFile(resolve(directory, file), 'utf8'));
      await client.query('INSERT INTO schema_migrations(version) VALUES ($1)', [file]);
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const db = createDatabase(loadConfig().DATABASE_URL);
  try { await migrate(db); console.info('Migrations applied.'); } finally { await db.end(); }
}
