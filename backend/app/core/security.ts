import type { RequestHandler, Response } from 'express';
import { AppError } from './errors.js';

// Only verified server-side middleware may set this. Never derive it from a raw header/body.
export interface AuthIdentity { subject: string }
export const requireAuthentication: RequestHandler = (_req,res,next) => {
  const auth = res.locals.auth as AuthIdentity | undefined;
  if (!auth || typeof auth.subject!=='string' || !auth.subject.trim()) {
    return next(new AppError(401,'AUTHENTICATION_REQUIRED','Sign in to access your training profile.'));
  }
  next();
};
export function authSubject(res: Response): string {
  return (res.locals.auth as AuthIdentity).subject;
}
