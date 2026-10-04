import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Router, type ErrorRequestHandler } from 'express';
import { z } from 'zod';
import { ElevenLabsError, ElevenLabsNotConfigured } from './calls/elevenlabs.ts';
import type { CallService } from './calls/service.ts';
import { ROOT_DIR, isProduction } from './config.ts';
import { CallScenario, TextScenario } from './types.ts';
import type { TextService } from './texts/service.ts';
import * as sse from './texts/sse.ts';

const StartText = z.object({ userId: z.string().min(1), scenario: TextScenario });
const Reply = z.object({ body: z.string().trim().min(1).max(1000) });
const StartCall = z.object({ userId: z.string().min(1), scenario: CallScenario });
const Decline = z.object({ reason: z.enum(['declined', 'missed']).default('declined') });
const Ended = z.object({ conversationId: z.string().min(1).optional() });

export interface Services {
  texts: TextService;
  calls: CallService;
}

export function createRouter({ texts, calls }: Services) {
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

  // --- Simulated calls ---

  router.post('/calls', async (req, res) => {
    const { userId, scenario } = StartCall.parse(req.body);
    const call = await calls.start(userId, scenario);
    res.status(201).json({ callId: call.id, callerLabel: scenario.callerLabel, call });
  });

  router.get('/calls/:id', async (req, res) => {
    const call = await calls.get(req.params.id);
    if (!call) res.status(404).json({ error: 'not_found' });
    else res.json(call);
  });

  router.post('/calls/:id/accept', async (req, res) => {
    const result = await calls.accept(req.params.id);
    if (result === 'not_found') res.status(404).json({ error: 'not_found' });
    else if (result === 'wrong_state') res.status(409).json({ error: 'not_ringing' });
    else res.json({ conversationToken: result.conversationToken, conversationId: result.call.conversationId, overrides: result.overrides });
  });

  router.post('/calls/:id/decline', async (req, res) => {
    const { reason } = Decline.parse(req.body ?? {});
    const result = await calls.decline(req.params.id, reason);
    if (result === 'not_found') res.status(404).json({ error: 'not_found' });
    else if (result === 'wrong_state') res.status(409).json({ error: 'not_ringing' });
    else res.json(result);
  });

  router.post('/calls/:id/ended', async (req, res) => {
    const { conversationId } = Ended.parse(req.body ?? {});
    const result = await calls.ended(req.params.id, conversationId);
    if (result === 'not_found') res.status(404).json({ error: 'not_found' });
    else if (result === 'wrong_state') res.status(409).json({ error: 'not_in_call' });
    else res.status(202).json(result);
  });

  // --- Dev-only call test page ---

  if (!isProduction) {
    router.get('/dev/call', (_req, res) => {
      res.sendFile(join(ROOT_DIR, 'src/dev/call.html'));
    });
    router.get('/dev/fixtures/:name', (req, res) => {
      const file = join(ROOT_DIR, 'fixtures/scenarios', `${req.params.name}.json`);
      if (!/^[\w-]+$/.test(req.params.name) || !existsSync(file)) res.status(404).json({ error: 'not_found' });
      else res.sendFile(file);
    });
  }

  return router;
}

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof z.ZodError) {
    res.status(400).json({ error: 'invalid_request', issues: err.issues });
    return;
  }
  if (err instanceof ElevenLabsNotConfigured) {
    res.status(503).json({ error: 'elevenlabs_not_configured', message: err.message });
    return;
  }
  if (err instanceof ElevenLabsError) {
    console.error(err.message);
    res.status(502).json({ error: 'elevenlabs_error', status: err.status });
    return;
  }
  console.error(err);
  res.status(500).json({ error: 'internal_error' });
};
