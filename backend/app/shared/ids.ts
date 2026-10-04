import { randomBytes } from 'node:crypto';

/** Unguessable id; results pages have no login, so ids must not be enumerable. */
export const newId = (prefix: string) => `${prefix}_${randomBytes(12).toString('base64url')}`;

/** Short unguessable token for tracked links. */
export const newLinkToken = () => randomBytes(9).toString('base64url');

export const nowIso = () => new Date().toISOString();
