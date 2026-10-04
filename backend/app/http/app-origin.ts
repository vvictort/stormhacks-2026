import type { RequestHandler } from "express";
import { AppError } from "./errors.ts";

// localhost and 127.0.0.1 are the same dev server; which one the browser sends depends on how the URL was typed.
const loopback = (origin?: string) =>
  origin?.replace(/\/\/localhost(?=:|$)/, "//127.0.0.1");

/** Browser writes must come from the app's own origin as JSON (a CSRF guard alongside the bearer token). */
export const requireAppRequest =
  (origin: string): RequestHandler =>
  (req, _res, next) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      if (loopback(req.get("origin")) !== loopback(origin)) {
        throw new AppError(
          403,
          "INVALID_ORIGIN",
          "This request must come from the application.",
        );
      }
      if (!req.is("application/json")) {
        throw new AppError(
          415,
          "JSON_REQUIRED",
          "Send an application/json request.",
        );
      }
    }
    next();
  };
