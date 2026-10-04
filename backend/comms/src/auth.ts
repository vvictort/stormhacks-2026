import type { Request } from 'express';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

export type AuthErrorCode = 'missing_token' | 'malformed_token' | 'invalid_token' | 'token_expired';

/** Thrown by `getUserId`; the error handler turns it into a 401. */
export class AuthError extends Error {
  readonly code: AuthErrorCode;

  constructor(code: AuthErrorCode) {
    super(code);
    this.code = code;
  }
}

/** Token-less requests resolve to this user only when the dev user is allowed (dev page, curl fixtures). */
export const DEV_USER_ID = 'dev-user';

/** Verifies a Firebase ID token and returns its claims; throws (like firebase-admin) when it isn't valid. */
export type VerifyToken = (idToken: string) => Promise<{ uid: string }>;

export interface AuthOptions {
  /** Also accept `?access_token=` (EventSource can't send headers). */
  allowQueryToken?: boolean;
}

export type GetUserId = (req: Request, opts?: AuthOptions) => Promise<string>;

/** Same verification as `backend/app/core/security.ts`: signature, expiry, audience and issuer. */
export function firebaseVerifier(projectId: string | undefined): VerifyToken {
  // Dev-user-only setups have no project, so every presented token is rejected rather than trusted.
  if (!projectId) {
    return async () => {
      throw new AuthError('invalid_token');
    };
  }
  const auth = getAuth(initializeApp({ projectId }));
  return (token) => auth.verifyIdToken(token);
}

// firebase-admin error codes that mean "bad token" (401) rather than "verification broke" (500).
const INVALID_TOKEN_CODES = new Set([
  'auth/argument-error',
  'auth/id-token-revoked',
  'auth/invalid-id-token',
  'auth/user-disabled',
  'auth/user-not-found',
]);

/** Resolves the Firebase uid for a request, only ever from a verified `Authorization: Bearer` token. */
export function createAuth({ verify, allowDevUser }: { verify: VerifyToken; allowDevUser: boolean }): GetUserId {
  return async (req, { allowQueryToken = false } = {}) => {
    const token = readToken(req, allowQueryToken);
    if (!token) {
      if (allowDevUser) return DEV_USER_ID;
      throw new AuthError('missing_token');
    }
    let uid: unknown;
    try {
      ({ uid } = await verify(token));
    } catch (err) {
      if (err instanceof AuthError) throw err;
      const code = (err as { code?: string }).code;
      if (code === 'auth/id-token-expired') throw new AuthError('token_expired');
      if (code && INVALID_TOKEN_CODES.has(code)) throw new AuthError('invalid_token');
      throw err;
    }
    if (typeof uid !== 'string' || !uid) throw new AuthError('invalid_token');
    return uid;
  };
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
