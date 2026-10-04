import { Router } from 'express';
import { z } from 'zod';
import type { SampleCatalog } from './catalog.ts';

const ListScenarios = z.object({ channel: z.enum(['text', 'call']).optional() });

/** GET /comms/scenarios: sample summaries for a picker (no prompts, no auth). */
export function scenariosRouter(samples: SampleCatalog) {
  const router = Router();
  router.get('/', (req, res) => {
    res.json({ scenarios: samples.list(ListScenarios.parse(req.query).channel) });
  });
  return router;
}
