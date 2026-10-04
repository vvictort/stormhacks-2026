import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

export const ROOT_DIR = fileURLToPath(new URL('..', import.meta.url));
export const DATA_DIR = fileURLToPath(new URL('../data', import.meta.url));

// Tests never read a developer's .env, so real keys can't leak into them.
const envFile = fileURLToPath(new URL('../.env', import.meta.url));
if (process.env.NODE_ENV !== 'test' && existsSync(envFile)) process.loadEnvFile(envFile);

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
  FIREBASE_PROJECT_ID: z.string().optional(),
  COMMS_ALLOW_DEV_USER: z.stringbool().default(false),
  BACKEND_INTERNAL_URL: z.url().optional(),
  INTERNAL_API_TOKEN: z.string().optional(),
}).superRefine((env, ctx) => {
  if (env.NODE_ENV === 'production' && env.COMMS_ALLOW_DEV_USER) {
    ctx.addIssue({ code: 'custom', path: ['COMMS_ALLOW_DEV_USER'], message: 'must not be true in production' });
  }
  if (!env.COMMS_ALLOW_DEV_USER && !env.FIREBASE_PROJECT_ID) {
    ctx.addIssue({ code: 'custom', path: ['FIREBASE_PROJECT_ID'], message: 'required unless COMMS_ALLOW_DEV_USER=true (dev only)' });
  }
});
export type Config = z.infer<typeof Env>;

/** Throws (refusing to start) on an invalid environment. Messages name the variable, never its value. */
export function parseConfig(env: NodeJS.ProcessEnv): Config {
  // Treat `KEY=` lines in .env as unset so defaults/optionals apply.
  const result = Env.safeParse(Object.fromEntries(Object.entries(env).filter(([, v]) => v !== '')));
  if (!result.success) throw new Error(`[comms] invalid configuration:\n${z.prettifyError(result.error)}`);
  return result.data;
}

export const config = parseConfig(process.env);
export const isProduction = config.NODE_ENV === 'production';
/** The schema already refuses the flag in production; the extra check keeps this fail-closed on its own. */
export const allowDevUser = !isProduction && config.COMMS_ALLOW_DEV_USER;
