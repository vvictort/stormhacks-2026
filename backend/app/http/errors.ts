import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  /** Extra fields for the error body, e.g. the `threadId` of a conflicting thread. */
  readonly details?: Record<string, unknown>;
  constructor(
    status: number,
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof ZodError) {
    res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Please check your entries.",
        fields: [...new Set(error.issues.map((issue) => issue.path.join(".")))],
      },
    });
  } else if (error instanceof AppError) {
    res.status(error.status).json({
      error: { ...error.details, code: error.code, message: error.message },
    });
  } else if (error?.type === "entity.parse.failed") {
    res.status(400).json({
      error: { code: "INVALID_JSON", message: "Invalid JSON request." },
    });
  } else if (error?.type === "entity.too.large") {
    res.status(413).json({
      error: { code: "REQUEST_TOO_LARGE", message: "Request is too large." },
    });
  } else {
    console.error(
      "Request failed:",
      error instanceof Error ? error.name : "UnknownError",
    );
    res.status(503).json({
      error: {
        code: "SERVICE_UNAVAILABLE",
        message: "We couldn’t complete that request. Please try again.",
      },
    });
  }
};
