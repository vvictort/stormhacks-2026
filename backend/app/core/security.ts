import type { RequestHandler } from 'express';
import { getAuth, type DecodedIdToken } from 'firebase-admin/auth';

declare global {
  namespace Express {
    interface Request {
      /** Set by requireAuth: the verified Firebase ID token of the caller. */
      user?: DecodedIdToken;
    }
  }
}

type VerifyToken = (idToken: string) => Promise<DecodedIdToken>;

/**
 * Authentication: rejects requests without a valid Firebase ID token (`Authorization: Bearer <token>`).
 * `verify` is swappable for tests; the default needs the Firebase Admin app initialized (see main.ts).
 */
export const requireAuth = (verify: VerifyToken = (idToken) => getAuth().verifyIdToken(idToken)): RequestHandler =>
  async (req, res, next) => {
    const idToken = req.headers.authorization?.match(/^Bearer (\S+)$/i)?.[1];
    if (!idToken) {
      res.status(401).json({ error: 'unauthenticated' });
      return;
    }
    try {
      req.user = await verify(idToken);
    } catch (err) {
      // Bad, expired or revoked tokens are the caller's problem. Anything else (e.g. Google's key
      // endpoint unreachable) is ours, and must not look like a session problem to the client.
      if ((err as { code?: unknown }).code?.toString().startsWith('auth/')) {
        res.status(401).json({ error: 'invalid_token' });
        return;
      }
      throw err;
    }
    next();
  };

/** Authorization: the caller may only reach records under their own `:uid`. Mount after requireAuth. */
export const requireSelf: RequestHandler = (req, res, next) => {
  if (!req.user || req.params.uid !== req.user.uid) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  next();
};
