import type { ScamCategory } from '../training/scenarios.ts'

// GET /api/training/metrics (backend/app/behavior/behavior.repository.ts
// `Metrics`), from the behaviour events table: a TimescaleDB hypertable on
// TigerData (`storage: 'timescale'`), or a plain Postgres table.
export interface Period {
  accuracy: number | null
  avgDetectionMs: number | null
}

export interface Metrics {
  attempts: number
  accuracy: number | null
  reportRate: number | null
  avgDetectionMs: number | null
  trend: { window: number; then: Period; now: Period } | null
  categories: {
    category: ScamCategory
    attempts: number
    accuracy: number | null
    avgDetectionMs: number | null
  }[]
  mostImproved: { category: ScamCategory; then: Period; now: Period } | null
  timeline: {
    day: string
    attempts: number
    correct: number
    avgDetectionMs: number | null
  }[]
  /** Older backends leave these out. */
  recent?: { at: string; correct: boolean; detectionMs: number | null }[]
  storage?: 'timescale' | 'postgres'
}

const categoryNames: Record<ScamCategory, string> = {
  banking: 'bank scams',
  government: 'tax and government scams',
  shipping: 'delivery scams',
  account_security: 'account security scams',
  workplace: 'workplace scams',
  promotional: 'prize and promo scams',
}

export const categoryLabel = (category: ScamCategory) =>
  categoryNames[category] ?? 'other scams'

export const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`

export interface InstinctRow {
  label: string
  /** Earlier value, when there is a trend to show. */
  then?: string
  now: string
  /** True when now is better than then. */
  better?: boolean
}

/**
 * The card's rows: then → now once there are two attempts, the current value
 * before that. Null with no history.
 */
function trendNote(trend: Metrics['trend']) {
  if (!trend) {
    return 'Finish one more scenario to see how your instincts are changing.'
  }
  if (trend.window === 1) return 'Your first scenario against your latest.'
  return `Your first ${trend.window} scenarios against your latest ${trend.window}.`
}

export function instinctsView(
  m: Metrics | null,
): { rows: InstinctRow[]; improved: string | null; note: string } | null {
  if (!m || m.attempts === 0) return null
  const rows: InstinctRow[] = []
  const { then, now } = m.trend ?? {
    then: null,
    now: { accuracy: m.accuracy, avgDetectionMs: m.avgDetectionMs },
  }

  if (now.avgDetectionMs !== null) {
    const before = then?.avgDetectionMs ?? null
    rows.push(
      before === null
        ? { label: 'Time to decide', now: seconds(now.avgDetectionMs) }
        : // Faster only counts as better when the right-call rate didn't fall
          // with it.
          {
            label: 'Time to decide',
            then: seconds(before),
            now: seconds(now.avgDetectionMs),
            better:
              now.avgDetectionMs < before &&
              (now.accuracy ?? 0) >= (then?.accuracy ?? 0),
          },
    )
  }

  if (now.accuracy !== null) {
    const before = then?.accuracy ?? null
    rows.push(
      before === null
        ? { label: 'Right calls', now: `${now.accuracy}%` }
        : {
            label: 'Right calls',
            then: `${before}%`,
            now: `${now.accuracy}%`,
            better: now.accuracy > before,
          },
    )
  }

  if (m.reportRate !== null) {
    rows.push({ label: 'Scams reported', now: `${m.reportRate}%` })
  }

  return {
    rows,
    improved: m.mostImproved ? categoryLabel(m.mostImproved.category) : null,
    note: trendNote(m.trend),
  }
}

/**
 * Names TigerData only when the events really are in a TimescaleDB hypertable.
 */
export const instinctsSource = (storage: Metrics['storage']) =>
  storage === 'timescale'
    ? 'Every tap and decision is timed and stored in TigerData.'
    : 'Every tap and decision is timed and saved to your training history.'

export interface Bar {
  /** 0 to 1 of the chart's height. */
  height: number
  good: boolean
  label: string
}

const DAYS = 14

/**
 * The card's mini chart: right calls per day once there are 3 days of history,
 * otherwise time to decide on each recent scenario (a same-day history is a
 * single day). Null under 2 bars.
 */
export function instinctsChart(
  m: Metrics,
): { title: string; keys: [good: string, missed: string]; bars: Bar[] } | null {
  const days = m.timeline.slice(-DAYS)
  if (days.length >= 3) {
    return {
      title: `Right calls per day, last ${days.length} days`,
      keys: ['mostly right', 'mostly missed'],
      bars: days.map((d) => ({
        height: d.attempts ? d.correct / d.attempts : 0,
        good: d.correct * 2 >= d.attempts,
        label: `${d.day}: ${d.correct} of ${d.attempts} right`,
      })),
    }
  }

  const recent = m.recent ?? []
  if (recent.length < 2) return null
  const slowest = Math.max(...recent.map((r) => r.detectionMs ?? 0))
  return {
    title: `Time to decide, last ${recent.length} scenarios`,
    keys: ['right call', 'missed'],
    bars: recent.map((r, i) => ({
      height: slowest && r.detectionMs !== null ? r.detectionMs / slowest : 0,
      good: r.correct,
      label: `Scenario ${i + 1}: ${r.correct ? 'right call' : 'missed'}${r.detectionMs === null ? '' : `, ${seconds(r.detectionMs)}`}`,
    })),
  }
}
