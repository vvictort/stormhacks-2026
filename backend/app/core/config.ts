import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const envFile = fileURLToPath(new URL('../../.env', import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

const projectId = process.env.FIREBASE_PROJECT_ID;
if (!projectId) {
  throw new Error('Missing FIREBASE_PROJECT_ID. Copy backend/.env.example to backend/.env and fill it in.');
}

export const config = {
  PORT: Number(process.env.PORT) || 3000,
  FIREBASE_PROJECT_ID: projectId,
};
