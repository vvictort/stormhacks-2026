import { createHash, timingSafeEqual } from 'node:crypto';
import express, { Router } from 'express';
import type { Repositories } from '../db/repositories.ts';
import { AppError } from '../core/errors.ts';
import { attemptSchema } from '../schemas/training.ts';

const notFound = () => new AppError(404, 'NOT_FOUND', 'Route not found.');
// Hashing first gives equal-length buffers, so the comparison time never depends on the secret.
const digest = (value: string) => createHash('sha256').update(value).digest();

/** Server-to-server routes for comms. Mounted before the browser Origin/JSON checks; the shared secret is the only gate. */
export function internalRouter(repo: Repositories, token: string | undefined) {
  const router = Router();
  router.use((req, _res, next) => {
    if (!token) throw notFound();
    if (!timingSafeEqual(digest(req.get('x-internal-token') ?? ''), digest(token))) {
      throw new AppError(401, 'INVALID_INTERNAL_TOKEN', 'Missing or invalid internal token.');
    }
    next();
  });
  router.use(express.json({ limit: '256kb' }));
  router.post('/training-attempts', async (req, res) => {
    const attempt = attemptSchema.parse(req.body);
    if (await repo.insertAttempt(attempt)) res.status(201).json({ id: attempt.attemptId });
    else res.json({ id: attempt.attemptId, duplicate: true });
  });
  router.get('/call-scenarios/:id', async (req, res) => {
    const uid = typeof req.query.uid === 'string' ? req.query.uid : '';
    const scenario = uid && await repo.getScenario(uid, req.params.id);
    if (!scenario) throw notFound();
    res.json(scenario);
  });
  router.use(() => { throw notFound(); });
  return router;
}
