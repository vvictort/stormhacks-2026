import { join } from 'node:path';
import cors from 'cors';
import express, { type ErrorRequestHandler } from 'express';
import { z } from 'zod';
import { AuthError, type GetUserId } from './auth.ts';
import { BackendError, type Backend } from './backend.ts';
import { ElevenLabsError, ElevenLabsNotConfigured } from './calls/elevenlabs.ts';
import { callsRouter } from './calls/routes.ts';
import type { CallService } from './calls/service.ts';
import { ROOT_DIR, config } from './config.ts';
import type { SampleCatalog } from './scenarios/catalog.ts';
import { scenariosRouter } from './scenarios/routes.ts';
import { linkRouter, textsRouter } from './texts/routes.ts';
import type { TextService } from './texts/service.ts';

export interface Services {
  texts: TextService;
  calls: CallService;
  samples: SampleCatalog;
  backend: Pick<Backend, 'callScenario'>;
  getUserId: GetUserId;
  /** Serve `/dev/*`; only when the dev user is allowed (never in production). */
  devPages: boolean;
}

/** The whole HTTP app, separate from listening so tests can run it on a random port. */
export function createApp(services: Services) {
  const { texts, samples, devPages } = services;
  const app = express();
  app.use(cors({ origin: config.FRONTEND_BASE_URL }));
  app.use(express.json({ limit: '100kb' }));
  app.get('/comms/health', (_req, res) => { res.json({ ok: true }); });
  app.use('/comms/scenarios', scenariosRouter(samples));
  app.use('/comms/texts', textsRouter(services));
  app.use('/comms/l', linkRouter(texts));
  app.use('/comms/calls', callsRouter(services));
  // Dev-only call test page: it runs as the dev user, so never in production.
  if (devPages) app.get('/comms/dev/call', (_req, res) => { res.sendFile(join(ROOT_DIR, 'src/dev/call.html')); });
  app.use(errorHandler);
  return app;
}

const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AuthError) {
    res.status(401).set('WWW-Authenticate', 'Bearer').json({ error: 'unauthorized', reason: err.code });
    return;
  }
  if (err instanceof z.ZodError) {
    res.status(400).json({ error: 'invalid_request', issues: err.issues });
    return;
  }
  if (err instanceof ElevenLabsNotConfigured) {
    res.status(503).json({ error: 'elevenlabs_not_configured', message: err.message });
    return;
  }
  if (err instanceof BackendError) {
    console.error(`[backend] ${err.message}`);
    res.status(502).json({ error: 'backend_unavailable' });
    return;
  }
  if (err instanceof ElevenLabsError) {
    console.error(err.message);
    res.status(502).json({ error: 'elevenlabs_error', status: err.status });
    return;
  }
  console.error(err);
  res.status(500).json({ error: 'internal_error' });
};
