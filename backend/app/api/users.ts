import { Router } from 'express';
import type { Repositories } from '../db/repositories.js';
import { authSubject } from '../core/security.js';
import { preferencesSchema } from '../schemas/user.js';

export function usersRouter(repo:Repositories) {
  const router=Router();
  router.get('/me',async (_req,res) => { res.json(await repo.requireUser(authSubject(res))); });
  router.put('/me',async (req,res) => { res.json(await repo.saveUser(authSubject(res),preferencesSchema.parse(req.body))); });
  return router;
}
