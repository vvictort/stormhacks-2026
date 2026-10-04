import type { Indicator } from './scenarios.ts'

export interface FlagScore {
  caught: number
  missed: number
  wrong: number
  totalIndicators: number
  details: { quote: string; title: string; caught: boolean }[]
  userFlags: { text: string; matched: boolean }[]
}

export type Confidence = 'guessing' | 'fairly_sure' | 'certain'

export const confidenceLabels: Record<Confidence, string> = {
  guessing: 'Guessing',
  fairly_sure: 'Fairly sure',
  certain: 'Certain',
}

/**
 * Normalizes text for resilient phrase comparison: lowercase, remove punctuation, collapse whitespace.
 */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Splits text into naturally tappable phrases/clauses (punctuation boundaries and clauses)
 * so learners can easily tap phrases on the simulated phone.
 */
export function splitIntoPhrases(text: string): string[] {
  if (!text) return []
  // Split on sentence terminators (. ! ?) and clause boundaries (, ; - —) while keeping meaningful phrases
  const rawParts = text
    .split(/(?<=[.!?])\s+|(?<=[,;—–-])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)

  if (rawParts.length === 0) return [text.trim()]
  return rawParts
}

/**
 * Compares user-flagged phrases against validated scenario red-flag quotes.
 * Uses substring and token overlap matching so minor selection boundary differences match cleanly.
 */
export function scoreFlags(
  userFlags: string[],
  indicators: Indicator[],
): FlagScore {
  const quotableIndicators = indicators.filter(
    (ind) => ind.quote && ind.quote.trim().length > 0,
  )
  const normUserFlags = userFlags.map((flag) => ({
    original: flag,
    normalized: normalize(flag),
    tokens: normalize(flag).split(' ').filter(Boolean),
  }))

  const indicatorDetails: { quote: string; title: string; caught: boolean }[] =
    []
  const matchedFlagIndices = new Set<number>()

  let caught = 0

  for (const indicator of quotableIndicators) {
    const quote = indicator.quote!
    const normQuote = normalize(quote)
    const quoteTokens = normQuote.split(' ').filter(Boolean)

    let isCaught = false

    normUserFlags.forEach((uf, flagIdx) => {
      if (!uf.normalized || !normQuote) return

      // Direct substring match either way
      const substringMatch =
        uf.normalized.includes(normQuote) || normQuote.includes(uf.normalized)

      // Or significant token overlap (>= 60% of either token set)
      const commonTokens = uf.tokens.filter((tok) => quoteTokens.includes(tok))
      const tokenOverlap =
        quoteTokens.length > 0 &&
        commonTokens.length / Math.min(uf.tokens.length, quoteTokens.length) >=
          0.6

      if (substringMatch || tokenOverlap) {
        isCaught = true
        matchedFlagIndices.add(flagIdx)
      }
    })

    if (isCaught) caught++
    indicatorDetails.push({ quote, title: indicator.title, caught: isCaught })
  }

  const missed = quotableIndicators.length - caught
  const wrong = userFlags.length - matchedFlagIndices.size

  const userFlagResults = userFlags.map((text, idx) => ({
    text,
    matched: matchedFlagIndices.has(idx),
  }))

  return {
    caught,
    missed,
    wrong: Math.max(0, wrong),
    totalIndicators: quotableIndicators.length,
    details: indicatorDetails,
    userFlags: userFlagResults,
  }
}
