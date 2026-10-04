import { Router } from 'express';
import type { Repositories } from '../db/repositories.ts';
import { AppError } from '../core/errors.ts';
import { rateLimitPerUser } from '../core/rate-limit.ts';
import { generateCallScenario } from '../integrations/gemini.ts';
import { summarizeAttempts } from '../models/training.ts';

// ponytail: stats are recomputed from the newest 1000 attempts per request; aggregate in SQL if users ever exceed that.
const HISTORY_LIMIT = 1000;
const LIST_LIMIT = 50;
const difficultyName = { 1: 'easy', 2: 'medium', 3: 'hard' } as const;

export function trainingRouter(repo: Repositories, options: { geminiApiKey?: string }) {
  const router = Router();
  router.get('/progress', async (req, res) => {
    const attempts = await repo.listAttempts(req.user!.uid, HISTORY_LIMIT);
    const { stats, vulnerability } = summarizeAttempts(attempts);
    res.json({ attempts: attempts.slice(0, LIST_LIMIT).map(({ tactics: _, ...attempt }) => attempt), stats, vulnerability });
  });
  router.get('/attempts/:id', async (req, res) => {
    const attempt = await repo.getAttempt(req.user!.uid, req.params.id);
    if (!attempt) throw new AppError(404, 'NOT_FOUND', 'Attempt not found.');
    res.json(attempt);
  });
  router.post('/call-scenarios', rateLimitPerUser(5, 30), async (req, res) => {
    const [profile, attempts] = await Promise.all([repo.ensureUser(req.user!), repo.listAttempts(req.user!.uid, HISTORY_LIMIT)]);
    const { vulnerability, difficulty } = summarizeAttempts(attempts);
    const { scenario, source } = await generateCallScenario({
      apiKey: options.geminiApiKey, difficulty, weakCategories: vulnerability.weakCategories,
      profession: profile.profession, interests: profile.interests,
    });
    await repo.saveScenario(req.user!.uid, scenario, source);
    const { id: scenarioId, title, callerLabel, tactics } = scenario;
    res.status(201).json({ scenarioId, title, callerLabel, difficulty: difficultyName[scenario.difficulty], tactics, source });
  });
  return router;
}
