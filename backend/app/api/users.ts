import { Router } from 'express';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { requireSelf } from '../core/security.ts';

const profile = (user: DecodedIdToken) => ({
  uid: user.uid,
  email: user.email ?? null,
  emailVerified: user.email_verified ?? false,
  name: (user.name as string | undefined) ?? null,
  picture: user.picture ?? null,
});

export const users = Router();

users.get('/me', (req, res) => {
  res.json(profile(req.user!));
});

users.get('/:uid', requireSelf, (req, res) => {
  res.json(profile(req.user!));
});
