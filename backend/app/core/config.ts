import 'dotenv/config';
import { z } from 'zod';

const schema=z.object({
  HOST:z.string().default('127.0.0.1'),
  PORT:z.coerce.number().int().min(1).max(65535).default(3001),
  CORS_ORIGIN:z.url().default('http://localhost:5173'),
  DATABASE_URL:z.url().refine((url) => url.startsWith('postgres:') || url.startsWith('postgresql:'), 'PostgreSQL URL required'),
  PERSONALIZATION_URL:z.url().default('http://127.0.0.1:8000'),
  PERSONALIZATION_SERVICE_KEY:z.string().min(16),
  AUTH_MIDDLEWARE_MODULE:z.string().optional(),
});
export function loadConfig() {
  const result=schema.safeParse(process.env);
  if (!result.success) throw new Error(`Invalid configuration fields: ${result.error.issues.map((i) => i.path.join('.')).join(', ')}`);
  return result.data;
}
