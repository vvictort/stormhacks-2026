import { useEffect, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import { getAdventure } from './adventureStore'
import { api } from '../../lib/api'
import { saveCachedScenarioMeta } from './scenarioCache'
import { getScenario, type Scenario } from './scenarios'

export type ScenarioState =
  | { status: 'ready'; scenario: Scenario }
  | { status: 'loading' }
  | { status: 'missing' }

/** Generated scenarios live on the backend, owner-only; the GET returns the frontend `Scenario` shape. */
function generatedPath(id: string) {
  if (id.startsWith('gen-email-')) {
    return `/training/email-scenarios/${encodeURIComponent(id)}`
  }
  if (id.startsWith('gen-sms-')) {
    return `/training/sms-scenarios/${encodeURIComponent(id)}`
  }
  if (id.startsWith('gen-call-')) {
    return `/training/call-scenarios/${encodeURIComponent(id)}`
  }
  return null
}

/** A built-in scenario by id, or one generated for this user. */
export function useScenario(id: string | undefined): ScenarioState {
  const { user } = useAuth()
  const uid = user?.uid
  const cached = getAdventure(uid).mission?.generated
  const local = getScenario(id) ?? (cached?.id === id ? cached : undefined)
  const path = !local && id ? generatedPath(id) : null
  const [fetched, setFetched] = useState<{
    id: string
    uid?: string
    scenario: Scenario | null
  }>()

  useEffect(() => {
    if (!path || !id) return
    const controller = new AbortController()
    api<Scenario>(path, { signal: controller.signal }, uid)
      .then((scenario) => {
        if (!controller.signal.aborted) {
          if (scenario) {
            saveCachedScenarioMeta({
              id: scenario.id,
              title: scenario.title,
              summary: scenario.summary,
              type: scenario.type,
              difficulty: scenario.difficulty,
            })
          }
          setFetched({ id, uid, scenario })
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setFetched({ id, uid, scenario: null })
      })
    return () => controller.abort()
  }, [id, path, uid])

  if (local) return { status: 'ready', scenario: local }
  if (!path) return { status: 'missing' }
  if (!fetched || fetched.id !== id || fetched.uid !== uid) {
    return { status: 'loading' }
  }
  return fetched.scenario
    ? { status: 'ready', scenario: fetched.scenario }
    : { status: 'missing' }
}
