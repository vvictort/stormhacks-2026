import type { Signal } from '../types.ts';
import { DIGIT_RUN, countDigits } from './redact.ts';

// Cheap rule-based hints computed on the raw (unredacted) reply, in memory only.
// The reply provider returns the authoritative signals; these are passed to it as `preSignals`.

const CHALLENGE = /\b(scam|scammer|fraud|fake|phishing|spam|not (?:falling|buying))\b/i;
const STOP = /\b(stop|block|unsubscribe|leave me alone)\b/i;
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const YEAR = /^(?:19|20)\d\d$/;

export function classifyReply(raw: string): Signal[] {
  const signals = new Set<Signal>();

  for (const run of raw.match(DIGIT_RUN) ?? []) {
    const digits = countDigits(run);
    if (YEAR.test(run)) continue;
    if (digits >= 13 && digits <= 19) signals.add('shared_payment_info');
    else if (digits >= 4 && digits <= 8) signals.add('shared_code');
  }
  if (EMAIL.test(raw)) signals.add('shared_personal_info');
  if (CHALLENGE.test(raw)) signals.add('challenged');
  if (STOP.test(raw)) signals.add('stop');

  return [...signals];
}
