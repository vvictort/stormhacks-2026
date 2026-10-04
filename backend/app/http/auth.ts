import type { RequestHandler } from "express";
import { getAuth, type DecodedIdToken } from "firebase-admin/auth";
import { AppError } from "./errors.ts";

declare global {
  namespace Express {
    interface Request {
      user?: DecodedIdToken;
    }
  }
}

export type VerifyToken = (idToken: string) => Promise<DecodedIdToken>;

/**
 * `queryToken` also accepts `?access_token=`; only for SSE, because EventSource
 * can't send headers.
 */
export const requireAuth =
  (
    verify: VerifyToken = (token) => getAuth().verifyIdToken(token),
    { queryToken = false } = {},
  ): RequestHandler =>
  async (req, _res, next) => {
    const header = req.get("authorization");
    const query = req.query.access_token;
    const token = header
      ? header.match(/^Bearer (\S+)$/i)?.[1]
      : queryToken && typeof query === "string"
        ? query
        : undefined;
    if (!token) {
      throw new AppError(401, "UNAUTHENTICATED", "Please sign in to continue.");
    }

    try {
      req.user = await verify(token);
    } catch (error) {
      const code = (error as { code?: string }).code;
      const invalid = [
        "auth/argument-error",
        "auth/id-token-expired",
        "auth/id-token-revoked",
        "auth/invalid-id-token",
        "auth/user-disabled",
        "auth/user-not-found",
      ];
      if (code && invalid.includes(code)) {
        throw new AppError(
          401,
          "INVALID_TOKEN",
          "Your session has ended. Please sign in again.",
        );
      }
      throw error;
    }
    if (!req.user.uid || !req.user.email) {
      throw new AppError(
        401,
        "INVALID_TOKEN",
        "Sign in with an account that has an email address.",
      );
    }
    next();
  };
