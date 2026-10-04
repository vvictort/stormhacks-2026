import { Router } from 'express';
import { AppError } from '../http/errors.ts';
import type { Repositories } from '../repositories.ts';
import { HISTORY_LIMIT, summarizeAttempts } from './progress.ts';

const LIST_LIMIT = 50;

export function trainingRouter(attempts: Repositories['attempts']) {
  const router = Router();
  router.get('/progress', async (req, res) => {
    const history = await attempts.list(req.user!.uid, HISTORY_LIMIT);
    const { stats, vulnerability } = summarizeAttempts(history);
    res.json({ attempts: history.slice(0, LIST_LIMIT).map(({ tactics: _, ...attempt }) => attempt), stats, vulnerability });
  });
  router.get('/attempts/:id', async (req, res) => {
    const attempt = await attempts.get(req.user!.uid, req.params.id);
    if (!attempt) throw new AppError(404, 'NOT_FOUND', 'Attempt not found.');
    res.json(attempt);
  });
  return router;
}
