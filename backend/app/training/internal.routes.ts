import { Router } from 'express';
import type { Repositories } from '../repositories.ts';
import { attemptSchema } from './attempts.schema.ts';

/** Comms reports finished attempts here (behind the internal token). Idempotent on the attempt id. */
export function attemptsInternalRouter(attempts: Repositories['attempts']) {
  const router = Router();
  router.post('/', async (req, res) => {
    const attempt = attemptSchema.parse(req.body);
    if (await attempts.insert(attempt)) res.status(201).json({ id: attempt.attemptId });
    else res.json({ id: attempt.attemptId, duplicate: true });
  });
  return router;
}
