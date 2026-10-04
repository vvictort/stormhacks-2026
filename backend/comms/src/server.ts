import cors from 'cors';
import express from 'express';
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

const app = express();
app.use(cors({ origin: config.FRONTEND_BASE_URL }));
app.use(express.json({ limit: '100kb' }));
app.use('/comms', createRouter({ texts }));
app.use(errorHandler);

app.listen(config.COMMS_PORT, () => {
  console.log(`[comms] listening on http://localhost:${config.COMMS_PORT}/comms`);
});

const sweeper = setInterval(() => {
  texts.sweep().catch((err) => console.error('[comms] sweep failed', err));
}, SWEEP_INTERVAL_MS);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    clearInterval(sweeper);
    store.flush();
    process.exit(0);
  });
}
