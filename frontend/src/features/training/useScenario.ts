import { useEffect, useState } from 'react'
import { api } from '../../lib/api'
import { getScenario, type Scenario } from './scenarios'

export type ScenarioState =
  | { status: 'ready'; scenario: Scenario }
  | { status: 'loading' }
  | { status: 'missing' }

/** Generated scenarios live on the backend, owner-only; the GET returns the frontend `Scenario` shape. */
function generatedPath(id: string) {
  if (id.startsWith('gen-email-')) return `/training/email-scenarios/${encodeURIComponent(id)}`
  if (id.startsWith('gen-sms-')) return `/training/sms-scenarios/${encodeURIComponent(id)}`
  if (id.startsWith('gen-call-')) return `/training/call-scenarios/${encodeURIComponent(id)}`
  return null
}

/** A built-in scenario by id, or one generated for this user. */
export function useScenario(id: string | undefined): ScenarioState {
  const local = getScenario(id)
  const path = !local && id ? generatedPath(id) : null
  const [fetched, setFetched] = useState<{ id: string; scenario: Scenario | null }>()

  useEffect(() => {
    if (!path || !id) return
    const controller = new AbortController()
    api<Scenario>(path, { signal: controller.signal })
      .then((scenario) => { if (!controller.signal.aborted) setFetched({ id, scenario }) })
      .catch(() => { if (!controller.signal.aborted) setFetched({ id, scenario: null }) })
    return () => controller.abort()
  }, [id, path])

  if (local) return { status: 'ready', scenario: local }
  if (!path) return { status: 'missing' }
  if (!fetched || fetched.id !== id) return { status: 'loading' }
  return fetched.scenario ? { status: 'ready', scenario: fetched.scenario } : { status: 'missing' }
}
