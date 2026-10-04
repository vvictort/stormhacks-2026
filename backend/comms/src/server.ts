import cors from 'cors';
import express from 'express';
import { CallService } from './calls/service.ts';
import { DATA_DIR, config } from './config.ts';
import { JsonlEventSink } from './events.ts';
import { StubProvider } from './provider.ts';
import { createRouter, errorHandler } from './router.ts';
import { JsonFileStore } from './store.ts';
import { TextService } from './texts/service.ts';

const SWEEP_INTERVAL_MS = 15_000;

const store = new JsonFileStore(DATA_DIR);
const events = new JsonlEventSink(DATA_DIR);
const texts = new TextService(store, events, new StubProvider());
const calls = new CallService(store, events);

const app = express();
app.use(cors({ origin: config.FRONTEND_BASE_URL }));
app.use(express.json({ limit: '100kb' }));
app.use('/comms', createRouter({ texts, calls }));
app.use(errorHandler);

app.listen(config.COMMS_PORT, () => {
  console.log(`[comms] listening on http://localhost:${config.COMMS_PORT}/comms`);
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
