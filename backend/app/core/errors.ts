import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';

export class AppError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, next) => {
  if (res.headersSent) return next(error);
  if (error instanceof AppError) return void res.status(error.status).json({ error: { code: error.code, message: error.message } });
  if (error instanceof ZodError) return void res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Request validation failed.', fields: error.issues.map((i) => i.path.join('.')) } });
  if (error && typeof error === 'object' && 'type' in error) {
    if (error.type === 'entity.parse.failed') return void res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Malformed JSON.' } });
    if (error.type === 'entity.too.large') return void res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request too large.' } });
  }
  console.error('Request failed:', error instanceof Error ? error.name : 'UnknownError');
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Unexpected server error.' } });
};
