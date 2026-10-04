import { initializeApp } from 'firebase-admin/app';
import { loadConfig } from './config.ts';
import { createDatabase } from './db/database.ts';
import { createRepositories } from './repositories.ts';
import { createApp } from './server.ts';

const config = loadConfig();
initializeApp({ projectId: config.FIREBASE_PROJECT_ID });
const db = createDatabase(config.DATABASE_URL);
const app = createApp({ repos: createRepositories(db), origin: config.APP_ORIGIN, internalToken: config.INTERNAL_API_TOKEN, geminiApiKey: config.GEMINI_API_KEY });
const server = app.listen(config.PORT, config.HOST, () => console.info(`Onboarding API: http://${config.HOST}:${config.PORT}/api`));
server.on('error', async (error) => { console.error('API startup failed:', (error as NodeJS.ErrnoException).code); await db.end(); process.exitCode = 1; });
let closing = false;
function shutdown() {
  if (closing) return;
  closing = true;
  const deadline = setTimeout(() => { server.closeAllConnections(); process.exit(1); }, 10000);
  deadline.unref();
  server.close(async () => { await db.end(); clearTimeout(deadline); });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
