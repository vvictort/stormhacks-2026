import type { Channel, Difficulty } from './scenarios'

export interface CachedScenarioMeta {
  id: string
  title: string
  summary: string
  type: Channel
  difficulty?: Difficulty
}

const CACHE_KEY = 'tellio.scenarios_meta'

/**
 * Saves metadata for a scenario (including AI-generated ones) so it can be
 * identified across history and reloads.
 */
export function saveCachedScenarioMeta(meta: CachedScenarioMeta): void {
  if (typeof window === 'undefined' || !meta?.id) return
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    const all: Record<string, CachedScenarioMeta> = raw ? JSON.parse(raw) : {}
    all[meta.id] = meta
    localStorage.setItem(CACHE_KEY, JSON.stringify(all))
  } catch {
    // Ignore storage quota or access errors
  }
}

export function getCachedScenarioMeta(
  id: string | undefined,
): CachedScenarioMeta | undefined {
  if (typeof window === 'undefined' || !id) return undefined
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return undefined
    const all: Record<string, CachedScenarioMeta> = JSON.parse(raw)
    return all[id]
  } catch {
    return undefined
  }
}
