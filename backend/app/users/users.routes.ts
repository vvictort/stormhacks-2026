import { Router } from 'express';
import type { Repositories } from '../repositories.ts';
import { profileSchema } from './users.schema.ts';

export function usersRouter(users: Repositories['users']) {
  const router = Router();
  router.get('/me', async (req, res) => { res.json(await users.ensureUser(req.user!)); });
  router.put('/me', async (req, res) => { res.json(await users.updateProfile(req.user!, profileSchema.parse(req.body))); });
  return router;
}
