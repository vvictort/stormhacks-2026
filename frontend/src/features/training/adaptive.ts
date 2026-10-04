import type { Metrics } from '../insights/instincts.ts'
import type { Difficulty, ScamCategory } from './scenarios.ts'

// The server's adaptive state (GET /api/training/progress `difficulty` and `focus`, docs/mvp-contracts.md): exactly
// what the next generated email or call will use. Pure, so Home and both debriefs agree and it's testable in Node.

export interface Adaptive {
  difficulty: Difficulty
  focus: ScamCategory[]
  categoryAccuracy: Partial<Record<ScamCategory, { attempts: number; correct: number; accuracy: number }>>
  vulnerableTactics: string[]
  attempts: { id: string; scamCategory?: ScamCategory | null }[]
}

/** Before and after a run. Each part is null when its API couldn't be reached, so each degrades on its own. */
export interface Snapshot {
  adaptive: Adaptive | null
  metrics: Metrics | null
  insight: { pattern: string; source: 'snowflake' | 'fallback' } | null
}

const levels: Difficulty[] = ['easy', 'medium', 'hard']
const isList = (value: unknown): value is unknown[] => Array.isArray(value)

/** The progress response's adaptive part; null when the backend predates it or the shape is off. */
export function readAdaptive(data: unknown): Adaptive | null {
  const d = data as Record<string, unknown> | null
  if (!d || !levels.includes(d.difficulty as Difficulty) || !isList(d.focus) || !isList(d.attempts)) return null
  const vulnerability = (d.vulnerability ?? {}) as Partial<Adaptive>
  return {
    difficulty: d.difficulty as Difficulty,
    focus: d.focus as ScamCategory[],
    categoryAccuracy: vulnerability.categoryAccuracy ?? {},
    vulnerableTactics: isList(vulnerability.vulnerableTactics) ? vulnerability.vulnerableTactics : [],
    attempts: d.attempts as Adaptive['attempts'],
  }
}

const plural: Record<ScamCategory, string> = {
  banking: 'bank scams', government: 'tax and government scams', shipping: 'delivery scams',
  account_security: 'account-security scams', workplace: 'workplace scams', promotional: 'prize and promo scams',
}
const emailKind: Record<ScamCategory, string> = {
  banking: 'a bank', government: 'a tax-office', shipping: 'a delivery', account_security: 'an account-security', workplace: 'a workplace', promotional: 'a prize',
}
const tactics: Record<string, string> = {
  urgency: 'urgency', authority: 'someone claiming authority', suspicious_link: 'a link', otp_request: 'a request for a code',
  info_request: 'a request for personal details', reward: 'a promised reward', fear: 'threats',
}
export const levelName = (difficulty: Difficulty) => difficulty.charAt(0).toUpperCase() + difficulty.slice(1)
const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

export interface NextView {
  title: string
  reason: string
  difficulty: Difficulty
}

/** What Tellio trains next and why, from the server's state. Without it (API down), a plain personalised email at the local level. */
export function nextForYou(adaptive: Adaptive | null, localLevel: Difficulty): NextView {
  const category = adaptive?.focus[0]
  if (!adaptive || !category) {
    return {
      title: 'An email made for you',
      reason: adaptive ? 'Tellio writes it around your profile. Each result you give it shapes what comes next.' : 'Tellio writes it around your profile and how you\'ve done so far.',
      difficulty: adaptive?.difficulty ?? localLevel,
    }
  }
  const record = adaptive.categoryAccuracy[category]
  const tactic = tactics[adaptive.vulnerableTactics[0]]
  const reason = !record
    ? `You haven't practised ${plural[category]} yet, so that's next.`
    : record.correct < record.attempts
      ? `Tellio noticed ${plural[category]} catch you out: you've made the right call on ${record.correct} of ${record.attempts}.`
      : `You've caught every one of the ${plural[category]} so far. This one keeps that sharp.`
  return {
    title: `${capital(emailKind[category])} email, made for you`,
    reason: tactic ? `${reason} You also tend to go along with ${tactic}.` : reason,
    difficulty: adaptive.difficulty,
  }
}

export const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`

export interface Learned {
  /** Real before → after changes, or one line on what Tellio keeps practising. */
  lines: string[]
  /** The analysis sentence, when it changed. */
  insight: Snapshot['insight']
  next: NextView
}

/** What changed between the state before a run and after it was recorded. Null without the after state. */
export function learned(before: Snapshot, after: Snapshot, attemptId: string): Learned | null {
  const now = after.adaptive
  if (!now) return null
  const then = before.adaptive
  const lines: string[] = []
  const category = now.attempts.find((a) => a.id === attemptId)?.scamCategory ?? undefined

  if (then && then.difficulty !== now.difficulty) {
    lines.push(levels.indexOf(now.difficulty) > levels.indexOf(then.difficulty)
      ? `Difficulty increased to ${levelName(now.difficulty)}.`
      : `Difficulty eased back to ${levelName(now.difficulty)}.`)
  }
  if (then && now.focus[0] && now.focus[0] !== then.focus[0]) lines.push(`Your focus moved to ${plural[now.focus[0]]}.`)
  if (category) {
    const a = now.categoryAccuracy[category]
    const b = then?.categoryAccuracy[category]
    if (a && b && a.accuracy !== b.accuracy) lines.push(`${capital(plural[category])}: right calls ${b.accuracy}% → ${a.accuracy}%.`)
    else if (a && then && !b) lines.push(`Your first result on ${plural[category]} is on your record.`)
  }
  const mBefore = before.metrics?.avgDetectionMs
  const mAfter = after.metrics?.avgDetectionMs
  if (mBefore && mAfter && mAfter < mBefore) {
    const pct = Math.round((1 - mAfter / mBefore) * 100)
    if (pct >= 1) lines.push(`Your average time to decide improved by ${pct}% (${seconds(mBefore)} → ${seconds(mAfter)}).`)
  }
  const accBefore = before.metrics?.accuracy
  const accAfter = after.metrics?.accuracy
  if (typeof accBefore === 'number' && typeof accAfter === 'number' && accBefore !== accAfter) lines.push(`Right calls overall: ${accBefore}% → ${accAfter}%.`)

  if (lines.length === 0) {
    const keep = now.focus[0] ?? category
    lines.push(keep ? `Nothing to adjust yet. Tellio will keep practising ${plural[keep]} with you.` : 'Nothing to adjust yet. Tellio will keep practising with you.')
  }
  const insight = after.insight && after.insight.pattern !== before.insight?.pattern ? after.insight : null
  return { lines: lines.slice(0, 4), insight, next: nextForYou(now, now.difficulty) }
}
