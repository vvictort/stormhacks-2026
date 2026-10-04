import { createAuth, firebaseVerifier } from './auth.ts';
import { backendClient } from './backend.ts';
import { CallService } from './calls/service.ts';
import { DATA_DIR, allowDevUser, config } from './config.ts';
import { JsonlEventSink } from './events.ts';
import { StubProvider } from './provider.ts';
import { createApp } from './router.ts';
import { SampleCatalog } from './samples.ts';
import { JsonFileStore } from './store.ts';
import { TextService } from './texts/service.ts';

const SWEEP_INTERVAL_MS = 15_000;

const store = new JsonFileStore(DATA_DIR);
const events = new JsonlEventSink(DATA_DIR);
const backend = backendClient(config.BACKEND_INTERNAL_URL, config.INTERNAL_API_TOKEN);
const texts = new TextService(store, events, new StubProvider());
const calls = new CallService(store, events, backend);
const samples = new SampleCatalog();
const getUserId = createAuth({ verify: firebaseVerifier(config.FIREBASE_PROJECT_ID), allowDevUser });

const app = createApp({ texts, calls, samples, backend, getUserId, devPages: allowDevUser });
app.listen(config.COMMS_PORT, () => {
  console.log(`[comms] listening on http://localhost:${config.COMMS_PORT}/comms (${samples.list().length} sample scenarios)`);
  if (allowDevUser) console.warn('[comms] COMMS_ALLOW_DEV_USER: requests without a token run as dev-user, /comms/dev/call is on');
});

const sweep = () => {
  texts.sweep().catch((err) => console.error('[comms] text sweep failed', err));
  calls.sweep().catch((err) => console.error('[comms] call sweep failed', err));
};
const sweeper = setInterval(sweep, SWEEP_INTERVAL_MS);
// Resume work interrupted by a restart right away (e.g. call analyses).
sweep();

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    clearInterval(sweeper);
    store.flush();
    process.exit(0);
  });
}
