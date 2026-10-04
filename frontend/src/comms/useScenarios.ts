import { useEffect, useState } from 'react'
import { comms } from './api'
import { describeError, isAbortError } from './client'
import type { Channel, ScenarioSummary } from './types'

interface ScenariosResult {
  channel: Channel | undefined
  scenarios: ScenarioSummary[]
  error: string | null
}

const NO_SCENARIOS: ScenarioSummary[] = []

/** Sample scenarios for the picker, optionally filtered by channel. */
export function useScenarios(channel?: Channel): {
  scenarios: ScenarioSummary[]
  loading: boolean
  error: string | null
} {
  const [result, setResult] = useState<ScenariosResult | null>(null)

  useEffect(() => {
    const abort = new AbortController()
    comms.listScenarios(channel, abort.signal).then(
      (scenarios) => setResult({ channel, scenarios, error: null }),
      (error) => {
        if (!isAbortError(error)) {
          setResult({
            channel,
            scenarios: NO_SCENARIOS,
            error: describeError(error),
          })
        }
      },
    )
    return () => abort.abort()
  }, [channel])

  // A result for another channel is stale: treat it as still loading.
  const current = result && result.channel === channel ? result : null
  return {
    scenarios: current?.scenarios ?? NO_SCENARIOS,
    loading: current === null,
    error: current?.error ?? null,
  }
}
