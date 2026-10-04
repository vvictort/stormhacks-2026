import type { Outcome, TrainingOutcome } from '../../comms/types.ts'

// The one place the call UI gets a result from. Comms owns outcome normalisation (docs/call-integration.md):
// screens read the canonical `training` field or the backend attempt and never decide success themselves.

export interface CallResult {
  outcome: TrainingOutcome
  /** null: not scored (the call errored). */
  success: boolean | null
}

/** Contract table, comms Outcome → canonical. Used for practice mode and as a safety net for records without `training`. */
export const OUTCOME_TABLE: Record<Outcome, CallResult> = {
  compromised: { outcome: 'compromised', success: false },
  resisted: { outcome: 'resisted', success: true },
  reported: { outcome: 'resisted', success: true },
  declined: { outcome: 'declined', success: true },
  ignored: { outcome: 'missed', success: true },
  missed: { outcome: 'missed', success: true },
  error: { outcome: 'error', success: null },
}

const CANONICAL = new Set<string>([
  'resisted',
  'compromised',
  'declined',
  'missed',
  'error',
])

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

export function normalizeCommsOutcome(outcome: unknown): CallResult | null {
  return typeof outcome === 'string' && Object.hasOwn(OUTCOME_TABLE, outcome)
    ? { ...OUTCOME_TABLE[outcome as Outcome] }
    : null
}

function canonical(value: unknown): CallResult | null {
  if (
    !isRecord(value) ||
    typeof value.outcome !== 'string' ||
    !CANONICAL.has(value.outcome)
  ) {
    return null
  }
  if (value.success !== null && typeof value.success !== 'boolean') return null
  const outcome = value.outcome as TrainingOutcome
  return { outcome, success: outcome === 'error' ? null : value.success }
}

/**
 * The canonical result of a comms call record (its `training` field) or a backend attempt (`outcome` + `success`).
 * Falls back to the contract table for a record that only has comms' raw `outcome`. Null while there is no result.
 */
export function readCallResult(source: unknown): CallResult | null {
  if (!isRecord(source)) return null
  return (
    canonical(source.training) ??
    canonical(source) ??
    normalizeCommsOutcome(source.outcome)
  )
}

export const isScored = (
  result: CallResult | null,
): result is CallResult & { success: boolean } =>
  result !== null && result.success !== null
