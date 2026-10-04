import express, { Router } from 'express';
import helmet from 'helmet';
import { requireAppRequest } from './http/app-origin.ts';
import { requireAuth, type VerifyToken } from './http/auth.ts';
import { AppError, errorHandler } from './http/errors.ts';
import { requireInternalToken } from './http/internal-auth.ts';
import type { Repositories } from './repositories.ts';
import { scenariosInternalRouter, scenariosRouter } from './scenarios/scenarios.routes.ts';
import { attemptsInternalRouter } from './training/internal.routes.ts';
import { trainingRouter } from './training/training.routes.ts';
import { usersRouter } from './users/users.routes.ts';

export interface AppOptions {
  repos: Repositories;
  origin: string;
  verifyToken?: VerifyToken;
  internalToken?: string;
  geminiApiKey?: string;
}

const notFound = () => { throw new AppError(404, 'NOT_FOUND', 'Route not found.'); };

/** HTTP assembly only: shared middleware, then each feature's router. */
export function createApp({ repos, origin, verifyToken, internalToken, geminiApiKey }: AppOptions) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

  // Server-to-server routes come before the browser checks; the shared secret is their only gate.
  const internal = Router();
  internal.use(requireInternalToken(internalToken), express.json({ limit: '256kb' }));
  internal.use('/training-attempts', attemptsInternalRouter(repos.attempts));
  internal.use('/call-scenarios', scenariosInternalRouter(repos.scenarios));
  internal.use(notFound);
  app.use('/api/internal', internal);

  app.use('/api', requireAppRequest(origin));
  app.use(express.json({ limit: '16kb' }));
  app.get('/api/health', (_req, res) => { res.json({ ok: true }); });
  const auth = requireAuth(verifyToken);
  app.use('/api/users', auth, usersRouter(repos.users));
  app.use('/api/training/call-scenarios', auth, scenariosRouter(repos, { geminiApiKey }));
  app.use('/api/training', auth, trainingRouter(repos.attempts));
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
