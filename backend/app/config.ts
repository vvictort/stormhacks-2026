import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
// backend/.env, wherever the command is run from.
const envFile = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);
const schema = z.object({
  DATABASE_URL: z.url().refine((value) => ['postgres:', 'postgresql:'].includes(new URL(value).protocol)),
  FIREBASE_PROJECT_ID: z.string().min(1),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  APP_ORIGIN: z.url().default('http://localhost:5173'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  // Unset uses the built-in call scenarios.
  GEMINI_API_KEY: z.string().min(1).optional(),
  // Unset: calls still ring and score, but accept is 503 elevenlabs_not_configured (caption-only practice).
  ELEVENLABS_API_KEY: z.string().min(1).optional(),
  ELEVENLABS_AGENT_ID: z.string().min(1).optional(),
  ELEVENLABS_DEFAULT_VOICE_ID: z.string().min(1).optional(),
  ELEVENLABS_LLM: z.string().min(1).default('gemini-2.5-flash'),
  CALL_MAX_SECONDS: z.coerce.number().int().positive().default(180),
  TEXT_FOLLOWUP_SEC: z.coerce.number().positive().default(120),
  TEXT_IDLE_END_SEC: z.coerce.number().positive().default(600),
});
export type Config = z.infer<typeof schema>;
export function loadConfig(): Config {
  // `KEY=` lines in .env count as unset, so defaults and optionals apply.
  const result = schema.safeParse(Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== '')));
  if (!result.success) throw new Error(`Invalid configuration fields: ${result.error.issues.map((issue) => issue.path.join('.')).join(', ')}`);
  const config = result.data;
  if (config.NODE_ENV === 'production' && new URL(config.APP_ORIGIN).protocol !== 'https:') throw new Error('Production APP_ORIGIN must use HTTPS.');
  if (new URL(config.APP_ORIGIN).origin !== config.APP_ORIGIN) throw new Error('APP_ORIGIN must be an origin without a path or trailing slash.');
  return config;
}
