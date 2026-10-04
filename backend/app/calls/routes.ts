import { Router, type Request } from 'express';
import { z } from 'zod';
import { AppError } from '../http/errors.ts';
import { StartSimulation, type ScenarioCatalog } from '../scenarios/catalog.ts';
import type { CallService } from './service.ts';

const Decline = z.object({ reason: z.enum(['declined', 'missed']).default('declined') });
const ConversationId = z.string().min(1).max(200);
const Connected = z.object({ conversationId: ConversationId });
const Ended = z.object({ conversationId: ConversationId.optional() });

const notFound = () => new AppError(404, 'not_found', 'Call not found.');
const notRinging = () => new AppError(409, 'not_ringing', 'This call is no longer ringing.');
const conflicts = {
  wrong_state: () => new AppError(409, 'not_in_call', 'This call is not in progress.'),
  conversation_mismatch: () => new AppError(409, 'conversation_mismatch', 'A different conversation is bound to this call.'),
};

/** /api/comms/calls (behind requireAuth): simulated scam calls (ringing, accept, decline, abandon, connected, ended). */
export function callsRouter({ calls, catalog }: { calls: CallService; catalog: ScenarioCatalog }) {
  const router = Router();

  // Another user's call is a 404, so ids can't be probed.
  const ownCall = async (req: Request<{ id: string }>) => {
    const call = await calls.get(req.params.id);
    if (!call || call.userId !== req.user!.uid) throw notFound();
    return call;
  };

  router.post('/', async (req, res) => {
    const { scenarioId } = StartSimulation.parse(req.body ?? {});
    const scenario = await catalog.pickCall(scenarioId, req.user!.uid);
    if (!scenario) throw new AppError(404, 'scenario_not_found', 'Scenario not found.');
    const call = await calls.start(req.user!.uid, scenario);
    res.status(201).json({ callId: call.id, callerLabel: scenario.callerLabel, call });
  });

  router.get('/:id', async (req, res) => { res.json(await ownCall(req)); });

  router.post('/:id/accept', async (req, res) => {
    await ownCall(req);
    const result = await calls.accept(req.params.id);
    if (result === 'not_found') throw notFound();
    if (result === 'wrong_state') throw notRinging();
    res.json({ conversationToken: result.conversationToken, conversationId: result.call.conversationId, overrides: result.overrides });
  });

  router.post('/:id/decline', async (req, res) => {
    await ownCall(req);
    const { reason } = Decline.parse(req.body ?? {});
    const result = await calls.decline(req.params.id, reason);
    if (result === 'not_found') throw notFound();
    if (result === 'wrong_state') throw notRinging();
    res.json(result);
  });

  // Ringing only: the browser gave up on the call (caption practice, left the page). Unscored and never saved.
  router.post('/:id/abandon', async (req, res) => {
    await ownCall(req);
    const result = await calls.abandon(req.params.id);
    if (result === 'not_found') throw notFound();
    if (result === 'wrong_state') throw notRinging();
    res.json(result);
  });

  router.post('/:id/connected', async (req, res) => {
    await ownCall(req);
    const { conversationId } = Connected.parse(req.body ?? {});
    const result = await calls.connected(req.params.id, conversationId);
    if (result === 'not_found') throw notFound();
    if (typeof result === 'string') throw conflicts[result]();
    res.json(result);
  });

  router.post('/:id/ended', async (req, res) => {
    await ownCall(req);
    const { conversationId } = Ended.parse(req.body ?? {});
    const result = await calls.ended(req.params.id, conversationId);
    if (result === 'not_found') throw notFound();
    if (typeof result === 'string') throw conflicts[result]();
    res.status(202).json(result);
  });

  return router;
}
