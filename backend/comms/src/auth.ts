import type { Request } from 'express';
import { z } from 'zod';
import { isProduction } from './config.ts';

export type AuthErrorCode = 'missing_token' | 'malformed_token' | 'token_expired';

/** Thrown by `getUserId`; the error handler turns it into a 401. */
export class AuthError extends Error {
  readonly code: AuthErrorCode;

  constructor(code: AuthErrorCode) {
    super(code);
    this.code = code;
  }
}

/** Requests without a token resolve to this user outside production (dev page, curl fixtures). */
export const DEV_USER_ID = 'dev-user';

const CLOCK_SKEW_SEC = 60;

export interface AuthOptions {
  /** Also accept `?access_token=` (EventSource can't send headers). */
  allowQueryToken?: boolean;
}

/** The Firebase ID token claims we read. Firebase sets both `sub` and `user_id` to the uid. */
const Claims = z.object({
  sub: z.string().min(1).max(128).optional(),
  user_id: z.string().min(1).max(128).optional(),
  exp: z.number(),
});

/**
 * Resolves the Firebase uid for a request from `Authorization: Bearer <Firebase ID token>`.
 * TEMPORARY: decodes the ID token WITHOUT verifying its signature, so any client can claim any uid.
 * Replace `decodeUnverified` + the exp check with firebase-admin `verifyIdToken` before real users.
 */
export async function getUserId(req: Request, { allowQueryToken = false }: AuthOptions = {}): Promise<string> {
  const token = readToken(req, allowQueryToken);
  if (!token) {
    if (!isProduction) return DEV_USER_ID;
    throw new AuthError('missing_token');
  }
  const claims = decodeUnverified(token);
  if (claims.exp + CLOCK_SKEW_SEC < Date.now() / 1000) throw new AuthError('token_expired');
  const uid = claims.sub ?? claims.user_id;
  if (!uid) throw new AuthError('malformed_token');
  return uid;
}

function readToken(req: Request, allowQueryToken: boolean): string | null {
  const header = req.get('authorization');
  if (header) {
    // A bad header is rejected rather than falling back to the dev user.
    const match = /^Bearer\s+(\S+)$/i.exec(header);
    if (!match) throw new AuthError('malformed_token');
    return match[1]!;
  }
  const query = req.query.access_token;
  return allowQueryToken && typeof query === 'string' && query ? query : null;
}

function decodeUnverified(token: string) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new AuthError('malformed_token');
  try {
    return Claims.parse(JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')));
  } catch {
    throw new AuthError('malformed_token');
  }
}
