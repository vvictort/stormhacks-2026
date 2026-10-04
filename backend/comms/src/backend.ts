import { CallScenario, type CallRecord } from './types.ts';

// Internal boundary to the backend API (docs/call-integration.md). The secret never reaches browsers.

/** The backend couldn't be reached or answered unexpectedly (surfaced as a 502). */
export class BackendError extends Error {}

const TIMEOUT_MS = 10_000;
const MAX_TRANSCRIPT_TURNS = 200;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** `POST /api/internal/training-attempts` body for a completed call. */
export function trainingAttempt(call: CallRecord) {
  const training = call.training!;
  return {
    attemptId: call.id,
    firebaseUid: call.userId,
    channel: 'call' as const,
    scenarioId: call.scenario.id,
    scenarioTitle: call.scenario.title,
    difficulty: training.difficulty,
    tactics: call.scenario.tactics,
    outcome: training.outcome,
    success: training.success,
    signals: call.signals,
    startedAt: call.createdAt,
    completedAt: call.completedAt!,
    durationSecs: call.durationSecs ?? null,
    summary: call.summary ?? null,
    // Already redacted when the analysis was stored; raw captions never reach comms.
    transcript: (call.transcript ?? []).slice(0, MAX_TRANSCRIPT_TURNS),
  };
}

export interface Backend {
  /** A generated (`gen-`) scenario owned by `uid`, or null when unknown, not theirs, or the backend isn't configured. */
  callScenario(id: string, uid: string): Promise<CallScenario | null>;
  /** Best-effort with one retry; never throws. Only for completed calls. */
  postAttempt(call: CallRecord): Promise<void>;
}

export function backendClient(baseUrl: string | undefined, token: string | undefined, retryDelayMs = 1000): Backend {
  let warned = false;
  const request = (path: string, init: RequestInit = {}) =>
    fetch(`${baseUrl!.replace(/\/$/, '')}${path}`, {
      ...init,
      headers: { 'x-internal-token': token!, ...init.headers },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

  return {
    async callScenario(id, uid) {
      if (!baseUrl || !token) return null;
      const res = await request(`/api/internal/call-scenarios/${encodeURIComponent(id)}?uid=${encodeURIComponent(uid)}`).catch((err) => {
        throw new BackendError(`call-scenarios request failed: ${err instanceof Error ? err.message : err}`);
      });
      if (res.status === 404) return null;
      if (!res.ok) throw new BackendError(`call-scenarios returned HTTP ${res.status}`);
      const parsed = CallScenario.safeParse(await res.json().catch(() => null));
      if (!parsed.success || parsed.data.id !== id) throw new BackendError('call-scenarios returned an invalid scenario');
      return parsed.data;
    },

    async postAttempt(call) {
      if (!baseUrl || !token) {
        if (!warned) console.warn('[backend] BACKEND_INTERNAL_URL or INTERNAL_API_TOKEN unset; call results stay local');
        warned = true;
        return;
      }
      const body = JSON.stringify(trainingAttempt(call));
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const res = await request('/api/internal/training-attempts', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body,
          });
          if (res.ok) return;
          console.error(`[backend] training-attempts ${call.id}: HTTP ${res.status}`);
          // A rejected payload won't pass on retry.
          if (res.status < 500) return;
        } catch (err) {
          console.error(`[backend] training-attempts ${call.id} failed:`, err instanceof Error ? err.message : err);
        }
        if (attempt === 1) await sleep(retryDelayMs);
      }
    },
  };
}
