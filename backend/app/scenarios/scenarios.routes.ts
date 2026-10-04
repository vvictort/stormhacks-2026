import { Router } from 'express';
import { z } from 'zod';
import { rateLimitPerUser } from '../http/rate-limit.ts';
import type { Repositories } from '../repositories.ts';
import { difficultyName } from '../shared/types.ts';
import { HISTORY_LIMIT, summarizeAttempts } from '../training/progress.ts';
import type { ScenarioCatalog } from './catalog.ts';
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

const ListScenarios = z.object({ channel: z.enum(['text', 'call']).optional() });

/** GET /api/comms/scenarios: fixture summaries for a picker (no prompts, no auth). */
export function scenarioListRouter(catalog: ScenarioCatalog) {
  const router = Router();
  router.get('/', (req, res) => {
    res.json({ scenarios: catalog.list(ListScenarios.parse(req.query).channel) });
  });
  return router;
}
