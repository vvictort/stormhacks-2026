import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
const envFile = resolve('.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);
const schema = z.object({
  DATABASE_URL: z.url().refine((value) => ['postgres:', 'postgresql:'].includes(new URL(value).protocol)),
  FIREBASE_PROJECT_ID: z.string().min(1),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  APP_ORIGIN: z.url().default('http://localhost:5173'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});
export function loadConfig() {
  const result = schema.safeParse(process.env);
  if (!result.success) throw new Error(`Invalid configuration fields: ${result.error.issues.map((issue) => issue.path.join('.')).join(', ')}`);
  const config = result.data;
  if (config.NODE_ENV === 'production' && new URL(config.APP_ORIGIN).protocol !== 'https:') throw new Error('Production APP_ORIGIN must use HTTPS.');
  if (new URL(config.APP_ORIGIN).origin !== config.APP_ORIGIN) throw new Error('APP_ORIGIN must be an origin without a path or trailing slash.');
  return config;
}
