import type { RequestHandler } from 'express';
import { AppError } from './errors.ts';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

// ponytail: in-memory per process, so limits reset on restart and multiply across instances; move to Postgres/Redis to scale out.
export function rateLimitPerUser(perMinute: number, perDay: number, now = Date.now): RequestHandler {
  const hits = new Map<string, number[]>();
  return (req, _res, next) => {
    const uid = req.user!.uid;
    const time = now();
    const recent = (hits.get(uid) ?? []).filter((at) => time - at < DAY);
    if (recent.length >= perDay || recent.filter((at) => time - at < MINUTE).length >= perMinute) {
      hits.set(uid, recent);
      throw new AppError(429, 'RATE_LIMITED', 'You’ve generated a lot of scenarios. Please wait a moment and try again.');
    }
    recent.push(time);
    hits.set(uid, recent);
    next();
  };
}
