import { Router, type Request } from 'express';
import { z } from 'zod';
import type { GetUserId } from '../auth.ts';
import type { Backend } from '../backend.ts';
import { StartSimulation, resolveCallScenario, type SampleCatalog } from '../scenarios/catalog.ts';
import type { CallService } from './service.ts';

const Decline = z.object({ reason: z.enum(['declined', 'missed']).default('declined') });
const ConversationId = z.string().min(1).max(200);
const Connected = z.object({ conversationId: ConversationId });
const Ended = z.object({ conversationId: ConversationId.optional() });

interface CallDeps {
  calls: CallService;
  samples: SampleCatalog;
  backend: Pick<Backend, 'callScenario'>;
  getUserId: GetUserId;
}

/** /comms/calls: simulated scam calls (ringing, accept, decline, connected, ended). */
export function callsRouter({ calls, samples, backend, getUserId }: CallDeps) {
  const router = Router();

  // The call if it belongs to the caller, else null (reported as 404 so ids can't be probed).
  const ownCall = async (req: Request, id: string) => {
    const userId = await getUserId(req);
    const call = await calls.get(id);
    return call && call.userId === userId ? call : null;
  };

  router.post('/', async (req, res) => {
    const userId = await getUserId(req);
    const { scenarioId } = StartSimulation.parse(req.body ?? {});
    const scenario = await resolveCallScenario(samples, backend, scenarioId, userId);
    if (!scenario) {
      res.status(404).json({ error: 'scenario_not_found' });
      return;
    }
    const call = await calls.start(userId, scenario);
    res.status(201).json({ callId: call.id, callerLabel: scenario.callerLabel, call });
  });

  router.get('/:id', async (req, res) => {
    const call = await ownCall(req, req.params.id);
    if (!call) res.status(404).json({ error: 'not_found' });
    else res.json(call);
  });

  router.post('/:id/accept', async (req, res) => {
    if (!(await ownCall(req, req.params.id))) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const result = await calls.accept(req.params.id);
    if (result === 'not_found') res.status(404).json({ error: 'not_found' });
    else if (result === 'wrong_state') res.status(409).json({ error: 'not_ringing' });
    else res.json({ conversationToken: result.conversationToken, conversationId: result.call.conversationId, overrides: result.overrides });
  });

  router.post('/:id/decline', async (req, res) => {
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

  router.post('/:id/connected', async (req, res) => {
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

  router.post('/:id/ended', async (req, res) => {
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

  return router;
}
