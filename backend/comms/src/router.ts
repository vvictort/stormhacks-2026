import { join } from 'node:path';
import cors from 'cors';
import express, { Router, type ErrorRequestHandler, type Request } from 'express';
import { z } from 'zod';
import { AuthError, type AuthOptions, type GetUserId } from './auth.ts';
import { BackendError, type Backend } from './backend.ts';
import { ElevenLabsError, ElevenLabsNotConfigured } from './calls/elevenlabs.ts';
import type { CallService } from './calls/service.ts';
import { ROOT_DIR, config } from './config.ts';
import type { SampleCatalog } from './samples.ts';
import type { TextService } from './texts/service.ts';
import * as sse from './texts/sse.ts';

// Scenarios are server-owned: start one by id, or `{}` for a random sample. Strict, so a client-supplied
// `scenario` (or any other key) is a 400 instead of being silently ignored.
const StartSimulation = z.strictObject({ scenarioId: z.string().min(1).max(200).optional() });
const Reply = z.object({ body: z.string().trim().min(1).max(1000) });
const ListScenarios = z.object({ channel: z.enum(['text', 'call']).optional() });
const Decline = z.object({ reason: z.enum(['declined', 'missed']).default('declined') });
const ConversationId = z.string().min(1).max(200);
const Connected = z.object({ conversationId: ConversationId });
const Ended = z.object({ conversationId: ConversationId.optional() });

/** Prefix of backend-generated (Gemini) call scenarios, resolved through the backend per user. */
const GENERATED_PREFIX = 'gen-';

export interface Services {
  texts: TextService;
  calls: CallService;
  samples: SampleCatalog;
  backend: Pick<Backend, 'callScenario'>;
  getUserId: GetUserId;
  /** Serve `/dev/*`; only when the dev user is allowed (never in production). */
  devPages: boolean;
}

export function createRouter({ texts, calls, samples, backend, getUserId, devPages }: Services) {
  const router = Router();

  // The simulation if it belongs to the caller, else null (reported as 404 so ids can't be probed).
  // Authenticates first so a bad token is a 401 even for unknown ids.
  const ownThread = async (req: Request, id: string, opts?: AuthOptions) => {
    const userId = await getUserId(req, opts);
    const thread = await texts.get(id);
    return thread && thread.userId === userId ? thread : null;
  };
  const ownCall = async (req: Request, id: string) => {
    const userId = await getUserId(req);
    const call = await calls.get(id);
    return call && call.userId === userId ? call : null;
  };

  router.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  // --- Sample scenarios (summaries only, no prompts) ---

  router.get('/scenarios', (req, res) => {
    res.json({ scenarios: samples.list(ListScenarios.parse(req.query).channel) });
  });

  // --- Simulated texts ---

  router.post('/texts', async (req, res) => {
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

  router.get('/texts/:id', async (req, res) => {
    const thread = await ownThread(req, req.params.id);
    if (!thread) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json(thread);
  });

  router.get('/texts/:id/stream', async (req, res) => {
    const thread = await ownThread(req, req.params.id, { allowQueryToken: true });
    if (!thread) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    sse.subscribe(thread, req, res);
  });

  router.post('/texts/:id/replies', async (req, res) => {
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

  router.post('/texts/:id/report', async (req, res) => {
    if (!(await ownThread(req, req.params.id))) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const result = await texts.report(req.params.id);
    if (result === 'not_found') res.status(404).json({ error: 'not_found' });
    else if (result === 'ended') res.status(409).json({ error: 'thread_ended' });
    else res.json(result);
  });

  // Tracked scam link inside a simulated text. No auth: it's a plain browser navigation.
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
    const userId = await getUserId(req);
    const { scenarioId } = StartSimulation.parse(req.body ?? {});
    const scenario = scenarioId?.startsWith(GENERATED_PREFIX)
      ? await backend.callScenario(scenarioId, userId)
      : samples.pickCall(scenarioId);
    if (!scenario) {
      res.status(404).json({ error: 'scenario_not_found' });
      return;
    }
    const call = await calls.start(userId, scenario);
    res.status(201).json({ callId: call.id, callerLabel: scenario.callerLabel, call });
  });

  router.get('/calls/:id', async (req, res) => {
    const call = await ownCall(req, req.params.id);
    if (!call) res.status(404).json({ error: 'not_found' });
    else res.json(call);
  });

  router.post('/calls/:id/accept', async (req, res) => {
    if (!(await ownCall(req, req.params.id))) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const result = await calls.accept(req.params.id);
    if (result === 'not_found') res.status(404).json({ error: 'not_found' });
    else if (result === 'wrong_state') res.status(409).json({ error: 'not_ringing' });
    else res.json({ conversationToken: result.conversationToken, conversationId: result.call.conversationId, overrides: result.overrides });
  });

  router.post('/calls/:id/decline', async (req, res) => {
    if (!(await ownCall(req, req.params.id))) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const { reason } = Decline.parse(req.body ?? {});
    const result = await calls.decline(req.params.id, reason);
    if (result === 'not_found') res.status(404).json({ error: 'not_found' });
    else if (result === 'wrong_state') res.status(409).json({ error: 'not_ringing' });
    else res.json(result);
  });

  router.post('/calls/:id/connected', async (req, res) => {
    if (!(await ownCall(req, req.params.id))) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const { conversationId } = Connected.parse(req.body ?? {});
    const result = await calls.connected(req.params.id, conversationId);
    if (result === 'not_found') res.status(404).json({ error: 'not_found' });
    else if (result === 'wrong_state') res.status(409).json({ error: 'not_in_call' });
    else if (result === 'conversation_mismatch') res.status(409).json({ error: 'conversation_mismatch' });
    else res.json(result);
  });

  router.post('/calls/:id/ended', async (req, res) => {
    if (!(await ownCall(req, req.params.id))) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const { conversationId } = Ended.parse(req.body ?? {});
    const result = await calls.ended(req.params.id, conversationId);
    if (result === 'not_found') res.status(404).json({ error: 'not_found' });
    else if (result === 'wrong_state') res.status(409).json({ error: 'not_in_call' });
    else if (result === 'conversation_mismatch') res.status(409).json({ error: 'conversation_mismatch' });
    else res.status(202).json(result);
  });

  // --- Dev-only call test page (runs as the dev user, so never in production) ---

  if (devPages) {
    router.get('/dev/call', (_req, res) => {
      res.sendFile(join(ROOT_DIR, 'src/dev/call.html'));
    });
  }

  return router;
}

/** The whole HTTP app, separate from listening so tests can run it on a random port. */
export function createApp(services: Services) {
  const app = express();
  app.use(cors({ origin: config.FRONTEND_BASE_URL }));
  app.use(express.json({ limit: '100kb' }));
  app.use('/comms', createRouter(services));
  app.use(errorHandler);
  return app;
}

const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AuthError) {
    res.status(401).set('WWW-Authenticate', 'Bearer').json({ error: 'unauthorized', reason: err.code });
    return;
  }
  if (err instanceof z.ZodError) {
    res.status(400).json({ error: 'invalid_request', issues: err.issues });
    return;
  }
  if (err instanceof ElevenLabsNotConfigured) {
    res.status(503).json({ error: 'elevenlabs_not_configured', message: err.message });
    return;
  }
  if (err instanceof BackendError) {
    console.error(`[backend] ${err.message}`);
    res.status(502).json({ error: 'backend_unavailable' });
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
