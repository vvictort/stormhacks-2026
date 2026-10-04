import { initializeApp } from 'firebase-admin/app';
import { CallBehaviorSink } from './behavior/call-events.ts';
import { createElevenLabs } from './calls/elevenlabs.ts';
import { CallService } from './calls/service.ts';
import { loadConfig } from './config.ts';
import { createDatabase } from './db/database.ts';
import { pendingMigrations } from './db/migrate.ts';
import { Snowflake, snowflakeConfig } from './insights/snowflake.ts';
import { createRepositories } from './repositories.ts';
import { ScenarioCatalog } from './scenarios/catalog.ts';
import { defaultLibrary } from './scenarios/library.ts';
import { createApp } from './server.ts';
import { PgEventSink, PgSimStore } from './sim/sim.repository.ts';
import { StubProvider } from './texts/provider.ts';
import { closeAll as closeStreams } from './texts/sse.ts';
import { TextService } from './texts/service.ts';

const SWEEP_INTERVAL_MS = 15_000;

const config = loadConfig();
initializeApp({ projectId: config.FIREBASE_PROJECT_ID });
const db = createDatabase(config.DATABASE_URL);
// A schema behind the code breaks progress, saved calls and behaviour events with bare 503s: refuse to start instead.
// An unreachable database is not checked here; requests report it as they did before.
const pending = await pendingMigrations(db).catch(() => []);
if (pending.length) {
  console.error(`Database schema is out of date: ${pending.join(', ')} not applied.\nRun \`npm run migrate\` in backend/, then start the API again.`);
  await db.end();
  process.exit(1);
}
const repos = createRepositories(db);
// Grounding examples for generated emails and calls; a malformed file stops startup here, a missing one is logged.
console.info(defaultLibrary().summary());
const store = new PgSimStore(db);
const events = new PgEventSink(db);
const services = {
  catalog: new ScenarioCatalog(repos.scenarios),
  texts: new TextService(store, events, new StubProvider(), {
    appOrigin: config.APP_ORIGIN, followUpSec: config.TEXT_FOLLOWUP_SEC, idleEndSec: config.TEXT_IDLE_END_SEC,
  }),
  // Call lifecycle events also become behaviour events in TigerData.
  calls: new CallService(store, new CallBehaviorSink(events, repos.behavior, store), {
    attempts: repos.attempts,
    elevenLabs: createElevenLabs({ apiKey: config.ELEVENLABS_API_KEY, agentId: config.ELEVENLABS_AGENT_ID }),
    callMaxSeconds: config.CALL_MAX_SECONDS,
  }),
};
const snowflake = snowflakeConfig(config);
const snowflakePartial = !snowflake && Object.entries(config).some(([key, value]) => key.startsWith('SNOWFLAKE_') && key !== 'SNOWFLAKE_SCHEMA' && value);
console.info(snowflake ? 'Vulnerability analysis: Snowflake'
  : snowflakePartial ? 'Vulnerability analysis: built-in (Snowflake needs all of SNOWFLAKE_ACCOUNT, SNOWFLAKE_PAT, SNOWFLAKE_WAREHOUSE, SNOWFLAKE_DATABASE, SNOWFLAKE_ID_SALT)'
  : 'Vulnerability analysis: built-in (Snowflake not configured)');
const app = createApp({ repos, services, origin: config.APP_ORIGIN, geminiApiKey: config.GEMINI_API_KEY, snowflake: snowflake && new Snowflake(snowflake) });
const server = app.listen(config.PORT, config.HOST, () => console.info(`Tellio API: http://${config.HOST}:${config.PORT}/api`));
server.on('error', async (error) => { console.error('API startup failed:', (error as NodeJS.ErrnoException).code); await db.end(); process.exitCode = 1; });

const sweep = () => {
  services.texts.sweep().catch((err) => console.error('[texts] sweep failed', err));
  services.calls.sweep().catch((err) => console.error('[calls] sweep failed', err));
};
const sweeper = setInterval(sweep, SWEEP_INTERVAL_MS);
// Resume work interrupted by a restart right away (e.g. call analyses).
sweep();

let closing = false;
function shutdown() {
  if (closing) return;
  closing = true;
  clearInterval(sweeper);
  const deadline = setTimeout(() => { server.closeAllConnections(); process.exit(1); }, 10000);
  deadline.unref();
  // Open SSE streams would hold close() until the deadline; clients reconnect on their own.
  closeStreams();
  server.close(async () => { await db.end(); clearTimeout(deadline); });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
