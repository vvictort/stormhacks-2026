import type { ScamCategory } from '../training/scenarios.ts'

/**
 * Who wrote the analysis: Snowflake Cortex (text over Snowflake's results),
 * Snowflake (computed there) or built in.
 */
export type InsightSource = 'cortex' | 'snowflake' | 'fallback'

/**
 * Anything unknown counts as built in: fallback output is never labelled as
 * Snowflake.
 */
export const insightSource = (value: unknown): InsightSource =>
  value === 'cortex' || value === 'snowflake' ? value : 'fallback'

const sourceLabels: Record<InsightSource, string> = {
  cortex: 'Interpreted by Snowflake Cortex',
  snowflake: 'Analysed in Snowflake',
  fallback: 'Built-in analysis',
}

export const insightSourceLabel = (value: unknown) =>
  sourceLabels[insightSource(value)]

/** `GET /api/training/insights` (docs/mvp-contracts.md). */
export interface Insights {
  strongestAreas: string[]
  weakAreas: string[]
  behavioralPattern: string
  recommendation: string
  nextTrainingFocus: ScamCategory[]
  source: InsightSource
  generatedAt: string
  basedOn: { attempts: number }
}

export interface ScamProfileView {
  empty: boolean
  strongest?: string
  weakest?: string
  insight: string
  recommendation: string
  focus: string[]
  /** Honest about where the analysis ran. */
  sourceLine: string
}

const categoryLabels: Record<ScamCategory, string> = {
  banking: 'Bank scams',
  government: 'Government impersonation',
  shipping: 'Delivery scams',
  account_security: 'Account security',
  workplace: 'Workplace scams',
  promotional: 'Prizes and promos',
}

export const categoryLabel = (category: string) =>
  categoryLabels[category as ScamCategory] ??
  category.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())

const strings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string')

/**
 * The card's view of an API response; null when the response isn't the contract
 * shape (the card then hides).
 */
export function scamProfileView(data: unknown): ScamProfileView | null {
  const d = data as Partial<Insights> | null
  if (
    !d ||
    !strings(d.strongestAreas) ||
    !strings(d.weakAreas) ||
    !strings(d.nextTrainingFocus) ||
    typeof d.behavioralPattern !== 'string' ||
    typeof d.recommendation !== 'string' ||
    typeof d.basedOn?.attempts !== 'number'
  ) {
    return null
  }

  const attempts = d.basedOn.attempts
  return {
    empty: attempts === 0,
    strongest: d.strongestAreas[0],
    weakest: d.weakAreas[0],
    insight: d.behavioralPattern,
    recommendation: d.recommendation,
    focus: d.nextTrainingFocus.map(categoryLabel),
    sourceLine: `${insightSourceLabel(d.source)} · based on ${attempts} ${attempts === 1 ? 'attempt' : 'attempts'}`,
  }
}
