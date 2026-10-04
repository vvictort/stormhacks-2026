import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { patternSchema } from '../schemas/personalization.js';
import { createDatabase,transaction,type Database } from './database.js';
import 'dotenv/config';

export async function seedPatterns(db:Database) {
  const patterns=z.array(patternSchema).parse(JSON.parse(await readFile(resolve('fixtures/patterns.json'),'utf8')));
  await transaction(db,async (c) => {
    for (const p of patterns) {
      // Do not rewrite reference ground truth once an attempt points to a pattern.
      await c.query(`INSERT INTO scam_patterns(id,kind,channel,category,tactics,context_tags,example,warning_signs,provenance)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(id) DO NOTHING`,
      [p.id,p.kind,p.channel,p.category,p.tactics,p.contextTags,p.example,p.warningSigns,p.provenance]);
    }
  });
}
if (process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const db=createDatabase(process.env.DATABASE_URL);
  try {await seedPatterns(db);console.info('Reference patterns seeded.');} finally {await db.end();}
}
