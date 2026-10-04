import { Router, type ErrorRequestHandler } from 'express';
import { z } from 'zod';
import { TextScenario } from './types.ts';
import type { TextService } from './texts/service.ts';
import * as sse from './texts/sse.ts';

const StartText = z.object({ userId: z.string().min(1), scenario: TextScenario });
const Reply = z.object({ body: z.string().trim().min(1).max(1000) });

export interface Services {
  texts: TextService;
}

export function createRouter({ texts }: Services) {
  const router = Router();

  router.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  // --- Simulated texts ---

  router.post('/texts', async (req, res) => {
    const { userId, scenario } = StartText.parse(req.body);
    const started = await texts.start(userId, scenario);
    if ('conflict' in started) {
      res.status(409).json({ error: 'active_thread_exists', threadId: started.conflict.id });
      return;
    }
    const { thread } = started;
    res.status(201).json({ threadId: thread.id, streamUrl: `/comms/texts/${thread.id}/stream`, thread });
  });

  router.get('/texts/:id', async (req, res) => {
    const thread = await texts.get(req.params.id);
    if (!thread) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json(thread);
  });

  router.get('/texts/:id/stream', async (req, res) => {
    const thread = await texts.get(req.params.id);
    if (!thread) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    sse.subscribe(thread, req, res);
  });

  router.post('/texts/:id/replies', async (req, res) => {
    const { body } = Reply.parse(req.body);
    const result = await texts.reply(req.params.id, body);
    if (result === 'not_found') res.status(404).json({ error: 'not_found' });
    else if (result === 'ended') res.status(409).json({ error: 'thread_ended' });
    else res.status(202).json({ message: result });
  });

  router.post('/texts/:id/report', async (req, res) => {
    const result = await texts.report(req.params.id);
    if (result === 'not_found') res.status(404).json({ error: 'not_found' });
    else if (result === 'ended') res.status(409).json({ error: 'thread_ended' });
    else res.json(result);
  });

  // Tracked scam link inside a simulated text.
  router.get('/l/:token', async (req, res) => {
    const redirectTo = await texts.handleLinkClick(req.params.token);
    if (!redirectTo) {
      res.status(404).type('text/plain').send('This link has expired.');
      return;
    }
    res.redirect(302, redirectTo);
  });

  return router;
}

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof z.ZodError) {
    res.status(400).json({ error: 'invalid_request', issues: err.issues });
    return;
  }
  console.error(err);
  res.status(500).json({ error: 'internal_error' });
};
