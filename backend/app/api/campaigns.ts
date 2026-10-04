import { Router } from 'express';
import type { Repositories } from '../db/repositories.js';
import { authSubject } from '../core/security.js';

// Read-only recovery contract; team gameplay code owns start/pause/resume/actions.
export function sessionsRouter(repo:Repositories) {
  const router=Router();
  router.get('/current',async (_req,res) => {
    const user=await repo.requireUser(authSubject(res));
    const session=await repo.currentSession(user.id);
    const attempt=session?.activeAttemptId ? await repo.publicAttempt(user.id,session.activeAttemptId) : null;
    res.json({session,attempt});
  });
  return router;
}
