import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '../http/errors.ts';
import type { Repositories } from '../repositories.ts';
import { difficultyName } from '../shared/types.ts';
import { HISTORY_LIMIT, summarizeAttempts } from '../training/progress.ts';
import type { ScenarioCatalog } from './catalog.ts';
import { generateCallScenario, trainingCallScenario } from './generator.ts';

/**
 * /api/training/call-scenarios. POST: a personalised call scenario, stored server-side. GET /:id: its teaching copy in
 * the frontend `CallScenario` shape, owner only. The prompt never leaves the server through these routes.
 */
export function scenariosRouter({ users, attempts, scenarios, insights }: Repositories, options: { geminiApiKey?: string }) {
  const router = Router();
  router.post('/', async (req, res) => {
    if (!(await scenarios.claimGeneration(req.user!.uid, 5, 30))) {
      throw new AppError(429, 'RATE_LIMITED', 'You’ve generated a lot of scenarios. Please wait a moment and try again.');
    }
    const [profile, history, focus] = await Promise.all([users.ensureUser(req.user!), attempts.list(req.user!.uid, HISTORY_LIMIT), insights.latestFocus(req.user!.uid)]);
    const { vulnerability, difficulty } = summarizeAttempts(history);
    const { scenario, source } = await generateCallScenario({
      apiKey: options.geminiApiKey, difficulty, focus, weakCategories: vulnerability.weakCategories,
      name: profile.name, profession: profile.profession, interests: profile.interests,
    });
    await scenarios.save(req.user!.uid, scenario, source);
    const { id: scenarioId, title, callerLabel, tactics } = scenario;
    res.status(201).json({ scenarioId, title, callerLabel, difficulty: difficultyName[scenario.difficulty], tactics, source });
  });
  router.get('/:id', async (req, res) => {
    // Another user's id is a 404 like an unknown one, so ids can't be probed.
    const stored = req.params.id.startsWith('gen-') ? await scenarios.get(req.user!.uid, req.params.id) : null;
    if (!stored) throw new AppError(404, 'scenario_not_found', 'Scenario not found.');
    res.json(trainingCallScenario(stored));
  });
  return router;
}

const ListScenarios = z.object({ channel: z.enum(['text', 'call']).optional() });

/** GET /api/comms/scenarios: fixture summaries for a picker (no prompts, no auth). */
export function scenarioListRouter(catalog: ScenarioCatalog) {
  const router = Router();
  router.get('/', (req, res) => {
    res.json({ scenarios: catalog.list(ListScenarios.parse(req.query).channel) });
  });
  return router;
}
