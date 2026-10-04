import type { ErrorRequestHandler } from 'express';

// Express only treats a handler as an error handler when it takes four arguments.
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'internal' });
};
