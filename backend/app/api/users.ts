import { Router } from 'express';
import type { Repositories } from '../db/repositories.ts';
import { profileSchema } from '../schemas/user.ts';
export function usersRouter(repo: Repositories) {
  const router = Router();
  router.get('/me', async (req, res) => { res.json(await repo.ensureUser(req.user!)); });
  router.put('/me', async (req, res) => { res.json(await repo.updateProfile(req.user!,profileSchema.parse(req.body))); });
  return router;
}
