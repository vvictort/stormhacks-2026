import { Router, type Request } from 'express';
import { z } from 'zod';
import type { AuthOptions, GetUserId } from '../auth.ts';
import { StartSimulation, type SampleCatalog } from '../scenarios/catalog.ts';
import type { TextService } from './service.ts';
import * as sse from './sse.ts';

const Reply = z.object({ body: z.string().trim().min(1).max(1000) });

/** /comms/texts: simulated scam text threads. */
export function textsRouter({ texts, samples, getUserId }: { texts: TextService; samples: SampleCatalog; getUserId: GetUserId }) {
  const router = Router();

  // The thread if it belongs to the caller, else null (reported as 404 so ids can't be probed).
  // Authenticates first so a bad token is a 401 even for unknown ids.
  const ownThread = async (req: Request, id: string, opts?: AuthOptions) => {
    const userId = await getUserId(req, opts);
    const thread = await texts.get(id);
    return thread && thread.userId === userId ? thread : null;
  };

  router.post('/', async (req, res) => {
    const userId = await getUserId(req);
    const { scenarioId } = StartSimulation.parse(req.body ?? {});
    const scenario = samples.pickText(scenarioId);
    if (!scenario) {
      res.status(404).json({ error: 'scenario_not_found' });
      return;
    }
    const started = await texts.start(userId, scenario);
    if ('conflict' in started) {
      res.status(409).json({ error: 'active_thread_exists', threadId: started.conflict.id });
      return;
    }
    const { thread } = started;
    res.status(201).json({ threadId: thread.id, streamUrl: `/comms/texts/${thread.id}/stream`, thread });
  });

  router.get('/:id', async (req, res) => {
    const thread = await ownThread(req, req.params.id);
    if (!thread) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json(thread);
  });

  router.get('/:id/stream', async (req, res) => {
    const thread = await ownThread(req, req.params.id, { allowQueryToken: true });
    if (!thread) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    sse.subscribe(thread, req, res);
  });

  router.post('/:id/replies', async (req, res) => {
    if (!(await ownThread(req, req.params.id))) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const { body } = Reply.parse(req.body);
    const result = await texts.reply(req.params.id, body);
    if (result === 'not_found') res.status(404).json({ error: 'not_found' });
    else if (result === 'ended') res.status(409).json({ error: 'thread_ended' });
    else res.status(202).json({ message: result });
  });

  router.post('/:id/report', async (req, res) => {
    if (!(await ownThread(req, req.params.id))) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const result = await texts.report(req.params.id);
    if (result === 'not_found') res.status(404).json({ error: 'not_found' });
    else if (result === 'ended') res.status(409).json({ error: 'thread_ended' });
    else res.json(result);
  });

  return router;
}

/** /comms/l/:token: tracked scam link inside a simulated text. No auth; it's a plain browser navigation. */
export function linkRouter(texts: TextService) {
  const router = Router();
  router.get('/:token', async (req, res) => {
    const redirectTo = await texts.handleLinkClick(req.params.token);
    if (!redirectTo) {
      res.status(404).type('text/plain').send('This link has expired.');
      return;
    }
    res.redirect(302, redirectTo);
  });
  return router;
}
