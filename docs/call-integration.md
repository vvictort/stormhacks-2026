# Call integration contract

Shared contract for the phone-call channel across the frontend, the comms service and the backend API.
If an implementation needs to differ, update this file in the same change.

## Identity

- Every service identifies a user by their **Firebase uid**, taken only from a **verified** Firebase ID token
  (`firebase-admin` `verifyIdToken`). Never from a request body, query or header other than `Authorization`.
- Comms must verify tokens cryptographically (same pattern as `backend/app/http/auth.ts`, with an injectable
  verifier for tests). Expired, malformed, unsigned or forged tokens are `401`.
- Dev-only anonymous user: allowed **only** when `NODE_ENV !== 'production'` **and** `COMMS_ALLOW_DEV_USER=true`.
  In production that combination must refuse to start. Default is off.

## Canonical vocabulary

| Concept    | Values                                                  |
|------------|---------------------------------------------------------|
| channel    | `sms`, `email`, `call`                                  |
| difficulty | `easy`, `medium`, `hard` (comms numeric `1/2/3` maps to these at boundaries) |
| outcome    | `resisted`, `compromised`, `declined`, `missed`, `error` |

### Call outcome normalisation (owned by comms; frontend and backend never reinterpret)

Comms' internal `Outcome` → canonical training outcome, and whether the attempt counts as a success:

| comms Outcome  | canonical    | success |
|----------------|--------------|---------|
| `compromised`  | `compromised`| false   |
| `resisted`     | `resisted`   | true    |
| `reported`     | `resisted`   | true    |
| `declined`     | `declined`   | true    |
| `ignored`      | `missed`     | true    |
| `missed`       | `missed`     | true    |
| `error`        | `error`      | null (not scored) |

Every completed comms `CallRecord` (declined, missed, analysed or error) carries
`training: { outcome, success, difficulty }` with the canonical values above (`difficulty` as `easy|medium|hard`).

### Abandoned calls (not scored, not posted)

A call the browser gives up while it is still ringing is **abandoned**, not missed: the user switched to caption-only
practice after `503 elevenlabs_not_configured` / `502 elevenlabs_error` or a microphone refusal, or left the page while
it rang. `POST /comms/calls/:id/abandon` (owner only; `409 not_ringing` otherwise) completes it with comms outcome
`error`, `error: "abandoned"` and `training: { outcome: "error", success: null, … }`, and comms does **not** post it
to the backend. Comms' sweeper treats a call still ringing after 2 minutes the same way (tab closed, or stuck on a
voice/mic error with the ring timer paused). Only the browser's ring timer reports a real `missed`
(`POST /decline { reason: "missed" }`).

Rule: every call scenario is a scam. Declining, missing/ignoring, or ending the call without sharing a code,
payment, personal info or agreeing to act is a successful (resisted-type) outcome. Any compromising signal makes it
`compromised` regardless of anything else.

## Call scenarios are server-owned

- Clients start calls with `{ scenarioId }` only. Any `scenario` object in the body is rejected (`400`).
- Unknown ids → `404 scenario_not_found`. If the backend lookup for a `gen-` id fails (network, 5xx, invalid
  shape) comms answers `502 backend_unavailable`.
- Fixed scenarios live in `backend/comms/fixtures/scenarios/call-*.json`. Ids (frontend metadata uses the same ids):
  - `bank-fraud-dept-otp-1`: bank fraud department asks for a verification code (difficulty 2 / medium)
  - `cra-tax-arrears-1`: CRA impersonation demanding payment (2 / medium)
  - `courier-customs-fee-1`: delivery company "confirming" account and a customs fee (1 / easy)
  - `tech-support-remote-1`: tech support wants remote access (2 / medium)
  - `exec-vendor-payment-1`: executive / vendor urgent payment change (3 / hard)
- Generated (Gemini) scenarios: created only by the backend (`POST /api/training/call-scenarios`), stored server-side,
  ids prefixed `gen-`. Comms resolves a `gen-` id by calling the backend internal route below, which only returns it
  if it belongs to the verified caller.

## Conversation id binding

- On `accept`, comms binds the ElevenLabs `conversation_id` from the token response to the call when present.
- If the token has none, the **first** id reported by the browser (`POST /comms/calls/:id/connected` or `/ended`)
  binds it; any later different id is rejected with `409 conversation_mismatch`.
- `/ended` with an id that differs from the bound one → `409 conversation_mismatch`, and the call is not analysed
  with it. The call stays `in_call`, so the correct `/ended` (or comms' sweeper after the max call length) can still
  finish it. A call with no bound id is never analysed; it completes as `error`.
- `POST /comms/calls/:id/abandon` → `200` call record (unscored, never posted; see above); `409 not_ringing` once the
  call was answered, declined, missed or already abandoned.
- `POST /comms/calls/:id/connected { conversationId }` → `200` call record; `409 conversation_mismatch` as above;
  `409 not_in_call` before accept. The browser sends it from `onConnect`.

## Internal boundary (comms ↔ backend API)

- Shared secret header `X-Internal-Token: <INTERNAL_API_TOKEN>` (env var on both services, never sent to browsers;
  at least 32 characters, e.g. `openssl rand -hex 32`, or the service refuses to start).
- Backend internal routes are mounted under `/api/internal/*`, skip the browser Origin/JSON-from-app checks, use a
  timing-safe secret comparison, and return `404` for every request when `INTERNAL_API_TOKEN` is unset (fail closed).
- Comms posts results only when both `BACKEND_INTERNAL_URL` and `INTERNAL_API_TOKEN` are set; otherwise it logs once
  and keeps working locally.

### `POST /api/internal/training-attempts` (comms → backend, idempotent on `attemptId`)

```json
{
  "attemptId": "call_…",            // comms call id; unique
  "firebaseUid": "…",              // from the verified token at call start
  "channel": "call",
  "scenarioId": "bank-fraud-dept-otp-1",
  "scenarioTitle": "…",
  "difficulty": "medium",
  "tactics": ["authority", "urgency"],
  "outcome": "resisted",          // canonical
  "success": true,                 // true | false | null
  "signals": ["engaged", "challenged"],
  "startedAt": "ISO", "completedAt": "ISO",
  "durationSecs": 74,              // or null
  "summary": "redacted summary or null",
  "transcript": [{ "role": "agent", "message": "redacted", "timeInCallSecs": 3 }]  // redacted only, ≤ 200 turns
}
```
Response `201 { id }`, or `200 { id, duplicate: true }` for a repeat `attemptId`. Body limit ≥ 256kb on this route.
Limits: `summary` and each transcript `message` ≤ 4000 characters, `scenarioTitle` ≤ 200, ≤ 200 turns. Comms clips
longer values (ending in `…`) before posting, so an oversize ElevenLabs summary never loses the attempt.

### `GET /api/internal/call-scenarios/:id?uid=<firebaseUid>` (comms → backend)

Returns the stored generated scenario in comms' `CallScenario` shape (numeric difficulty) if it belongs to `uid`,
else `404`.

## Browser-facing backend routes (Firebase-authenticated)

- `GET /api/training/progress` → `{ attempts: [{ id, channel, scenarioId, scenarioTitle, difficulty, outcome, success, completedAt }], stats: { total, successes, compromised }, vulnerability: { weakCategories, vulnerableTactics, categoryAccuracy } }`
  (newest first, max 50 attempts).
- `GET /api/training/attempts/:id` → one attempt including its redacted transcript, signals and summary (owner only, else 404).
- `POST /api/training/call-scenarios` → generates a scenario with Gemini (or a built-in fallback when no key),
  stores it, returns `{ scenarioId: "gen-…", title, callerLabel, difficulty, tactics, source: "gemini" | "fallback" }`
  (no prompt text). Rate-limited per uid (e.g. 5/min and 30/day), `429 { error: { code: "RATE_LIMITED" } }`.

## Frontend

- SMS/email progress stays in `localStorage` (unchanged). Call progress is read from `GET /api/training/progress`;
  the debrief prefers the server attempt, falling back to the comms call record.
- Call UI never decides success itself: it uses the canonical outcome/success it receives (from comms' call record
  `training` field or the backend attempt).
- When ElevenLabs isn't configured (`503 elevenlabs_not_configured`) or comms is unreachable, the call scenario stays
  usable through a clearly labelled caption-only practice mode; those local demo results are stored in localStorage only.
  Switching to practice from a ringing call, or leaving the page while it rings, abandons the comms call first.
