import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

export const ROOT_DIR = fileURLToPath(new URL('..', import.meta.url));
export const DATA_DIR = fileURLToPath(new URL('../data', import.meta.url));

const envFile = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

const Env = z.object({
  NODE_ENV: z.string().default('development'),
  COMMS_PORT: z.coerce.number().int().positive().default(3001),
  PUBLIC_BASE_URL: z.url().default('http://localhost:3001'),
  FRONTEND_BASE_URL: z.url().default('http://localhost:5173'),
  CAUGHT_PATH: z.string().startsWith('/').default('/caught'),
  ELEVENLABS_API_KEY: z.string().optional(),
  ELEVENLABS_AGENT_ID: z.string().optional(),
  ELEVENLABS_LLM: z.string().default('gemini-2.5-flash'),
  ELEVENLABS_DEFAULT_VOICE_ID: z.string().optional(),
  CALL_MAX_SECONDS: z.coerce.number().int().positive().default(180),
  TEXT_FOLLOWUP_SEC: z.coerce.number().positive().default(120),
  TEXT_IDLE_END_SEC: z.coerce.number().positive().default(600),
});

// Treat `KEY=` lines in .env as unset so defaults/optionals apply.
const rawEnv = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== ''));

export const config = Env.parse(rawEnv);
export const isProduction = config.NODE_ENV === 'production';
