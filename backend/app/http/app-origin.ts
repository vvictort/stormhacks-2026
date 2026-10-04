import type { RequestHandler } from "express";
import { AppError } from "./errors.ts";

/** Browser writes must come from the app's own origin as JSON (a CSRF guard alongside the bearer token). */
export const requireAppRequest =
  (origin: string): RequestHandler =>
  (req, _res, next) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      if (req.get("origin") !== origin)
        throw new AppError(
          403,
          "INVALID_ORIGIN",
          "This request must come from the application.",
        );
      if (!req.is("application/json"))
        throw new AppError(
          415,
          "JSON_REQUIRED",
          "Send an application/json request.",
        );
    }
    next();
  };
