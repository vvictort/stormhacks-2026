import type { ScamCategory } from '../training/scenarios.ts'

// GET /api/training/metrics (backend/app/behavior/behavior.repository.ts `Metrics`), measured in TigerData.
export interface Period { accuracy: number | null; avgDetectionMs: number | null }
export interface Metrics {
  attempts: number
  accuracy: number | null
  reportRate: number | null
  avgDetectionMs: number | null
  trend: { window: number; then: Period; now: Period } | null
  categories: { category: ScamCategory; attempts: number; accuracy: number | null; avgDetectionMs: number | null }[]
  mostImproved: { category: ScamCategory; then: Period; now: Period } | null
  timeline: { day: string; attempts: number; correct: number; avgDetectionMs: number | null }[]
}

const categoryNames: Record<ScamCategory, string> = {
  banking: 'bank scams',
  government: 'tax and government scams',
  shipping: 'delivery scams',
  account_security: 'account security scams',
  workplace: 'workplace scams',
  promotional: 'prize and promo scams',
}
export const categoryLabel = (category: ScamCategory) => categoryNames[category] ?? 'other scams'

export const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`

export interface InstinctRow {
  label: string
  /** Earlier value, when there is a trend to show. */
  then?: string
  now: string
  /** True when now is better than then. */
  better?: boolean
}

/** The card's rows: then → now once there are two attempts, the current value before that. Null with no history. */
export function instinctsView(m: Metrics | null): { rows: InstinctRow[]; improved: string | null; note: string } | null {
  if (!m || m.attempts === 0) return null
  const rows: InstinctRow[] = []
  const { then, now } = m.trend ?? { then: null, now: { accuracy: m.accuracy, avgDetectionMs: m.avgDetectionMs } }
  if (now.avgDetectionMs !== null) {
    const before = then?.avgDetectionMs ?? null
    rows.push(before === null
      ? { label: 'Time to decide', now: seconds(now.avgDetectionMs) }
      : { label: 'Time to decide', then: seconds(before), now: seconds(now.avgDetectionMs), better: now.avgDetectionMs < before })
  }
  if (now.accuracy !== null) {
    const before = then?.accuracy ?? null
    rows.push(before === null
      ? { label: 'Right calls', now: `${now.accuracy}%` }
      : { label: 'Right calls', then: `${before}%`, now: `${now.accuracy}%`, better: now.accuracy > before })
  }
  if (m.reportRate !== null) rows.push({ label: 'Scams reported', now: `${m.reportRate}%` })
  const note = m.trend
    ? m.trend.window === 1 ? 'Your first scenario against your latest.' : `Your first ${m.trend.window} scenarios against your latest ${m.trend.window}.`
    : 'Finish one more scenario to see how your instincts are changing.'
  return { rows, improved: m.mostImproved ? categoryLabel(m.mostImproved.category) : null, note }
}
