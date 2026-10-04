import { createHash, timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';
import { AppError } from './errors.ts';

// Hashing first gives equal-length buffers, so the comparison time never depends on the secret.
const digest = (value: string) => createHash('sha256').update(value).digest();

/** Gate for server-to-server routes. Without a configured token every internal route is a 404 (fail closed). */
export const requireInternalToken = (token: string | undefined): RequestHandler => (req, _res, next) => {
  if (!token) throw new AppError(404, 'NOT_FOUND', 'Route not found.');
  if (!timingSafeEqual(digest(req.get('x-internal-token') ?? ''), digest(token))) {
    throw new AppError(401, 'INVALID_INTERNAL_TOKEN', 'Missing or invalid internal token.');
  }
  next();
};
