import express from 'express';
import helmet from 'helmet';
import type { Repositories } from './db/repositories.ts';
import { usersRouter } from './api/users.ts';
import { trainingRouter } from './api/training.ts';
import { internalRouter } from './api/internal.ts';
import { requireAuth, type VerifyToken } from './core/security.ts';
import { AppError, errorHandler } from './core/errors.ts';
export function createApp(repo: Repositories, options: { origin: string; verifyToken?: VerifyToken; internalToken?: string; geminiApiKey?: string }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.use('/api/internal', internalRouter(repo, options.internalToken));
  app.use('/api', (req, _res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      if (req.get('origin') !== options.origin) throw new AppError(403, 'INVALID_ORIGIN', 'This request must come from the application.');
      if (!req.is('application/json')) throw new AppError(415, 'JSON_REQUIRED', 'Send an application/json request.');
    }
    next();
  });
  app.use(express.json({ limit: '16kb' }));
  app.get('/api/health', (_req, res) => { res.json({ ok: true }); });
  app.use('/api/users', requireAuth(options.verifyToken), usersRouter(repo));
  app.use('/api/training', requireAuth(options.verifyToken), trainingRouter(repo, { geminiApiKey: options.geminiApiKey }));
  app.use((_req, _res, next) => next(new AppError(404, 'NOT_FOUND', 'Route not found.')));
  app.use(errorHandler);
  return app;
}
