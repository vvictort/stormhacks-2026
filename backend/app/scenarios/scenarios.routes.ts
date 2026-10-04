import { Router } from 'express';
import { AppError } from '../http/errors.ts';
import { rateLimitPerUser } from '../http/rate-limit.ts';
import type { Repositories } from '../repositories.ts';
import { HISTORY_LIMIT, summarizeAttempts } from '../training/progress.ts';
import { difficultyName } from './call-scenario.ts';
import { generateCallScenario } from './generator.ts';

/** POST /api/training/call-scenarios: a personalised call scenario, stored server-side. The prompt never leaves the server. */
export function scenariosRouter({ users, attempts, scenarios }: Repositories, options: { geminiApiKey?: string }) {
  const router = Router();
  router.post('/', rateLimitPerUser(5, 30), async (req, res) => {
    const [profile, history] = await Promise.all([users.ensureUser(req.user!), attempts.list(req.user!.uid, HISTORY_LIMIT)]);
    const { vulnerability, difficulty } = summarizeAttempts(history);
    const { scenario, source } = await generateCallScenario({
      apiKey: options.geminiApiKey, difficulty, weakCategories: vulnerability.weakCategories,
      profession: profile.profession, interests: profile.interests,
    });
    await scenarios.save(req.user!.uid, scenario, source);
    const { id: scenarioId, title, callerLabel, tactics } = scenario;
    res.status(201).json({ scenarioId, title, callerLabel, difficulty: difficultyName[scenario.difficulty], tactics, source });
  });
  return router;
}

/** Comms resolves a gen- id here (behind the internal token); only the owner's scenario is returned. */
export function scenariosInternalRouter(scenarios: Repositories['scenarios']) {
  const router = Router();
  router.get('/:id', async (req, res) => {
    const uid = typeof req.query.uid === 'string' ? req.query.uid : '';
    const scenario = uid && await scenarios.get(uid, req.params.id);
    if (!scenario) throw new AppError(404, 'NOT_FOUND', 'Route not found.');
    res.json(scenario);
  });
  return router;
}
