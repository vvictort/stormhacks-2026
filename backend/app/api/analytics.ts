import { Router } from 'express';
import type { Repositories } from '../db/repositories.js';
import type { AnalyticsService } from '../services/analytics_service.js';
import { authSubject } from '../core/security.js';

export function analyticsRouter(repo:Repositories,analytics:AnalyticsService) {
  const router=Router();
  router.get('/me',async (_req,res) => {
    const user=await repo.requireUser(authSubject(res));
    res.json(await analytics.forUser(user.id));
  });
  return router;
}
