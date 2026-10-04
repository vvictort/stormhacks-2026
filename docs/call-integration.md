# Call integration contract

Shared contract for the phone-call channel between the frontend and the backend API. One server
(`backend/`) serves both the training routes (`/api/training/*`) and the simulated texts and calls
(`/api/comms/*`); there is no internal service boundary. If an implementation needs to differ, update this file
in the same change.

## Identity

- Every route identifies a user by their **Firebase uid**, taken only from a **verified** Firebase ID token
  (`firebase-admin` `verifyIdToken`, `requireAuth` in `backend/app/http/auth.ts`, with an injectable verifier for
  tests). Never from a request body, query or header other than `Authorization`.
- The one exception to the header: the text SSE stream (`GET /api/comms/texts/:id/stream`) also accepts
  `?access_token=<ID token>`, because `EventSource` can't send headers. It is verified the same way; no other route
  reads it.
- A missing token is `401 UNAUTHENTICATED`; expired, malformed, unsigned or forged tokens are `401 INVALID_TOKEN`.
  There is no anonymous or dev user.
- Every non-GET `/api` request must come from the app's `Origin` as `application/json` (send `{}` when there are no
  arguments), else `403 INVALID_ORIGIN` / `415 JSON_REQUIRED`.
- Errors are `{ "error": { "code", "message", ...details } }`. Simulation codes are lowercase
  (`scenario_not_found`, `conversation_mismatch`, `elevenlabs_not_configured`, …); the frontend reads `error.code`.

## Canonical vocabulary

| Concept    | Values                                                  |
|------------|---------------------------------------------------------|
| channel    | `sms`, `email`, `call`                                  |
| difficulty | `easy`, `medium`, `hard` (scenario numeric `1/2/3` maps to these at boundaries) |
| outcome    | `resisted`, `compromised`, `declined`, `missed`, `error` |

Defined once in `backend/app/shared/vocabulary.ts`; the database enforces them with CHECK constraints.

### Call outcome normalisation (owned by the server; the frontend and progress code never reinterpret)

A call's raw outcome → canonical training outcome, and whether the attempt counts as a success
(`backend/app/calls/outcome.ts`):

| raw outcome    | canonical    | success |
|----------------|--------------|---------|
| `compromised`  | `compromised`| false   |
| `resisted`     | `resisted`   | true    |
| `reported`     | `resisted`   | true    |
| `declined`     | `declined`   | true    |
| `ignored`      | `missed`     | true    |
| `missed`       | `missed`     | true    |
| `error`        | `error`      | null (not scored) |

Every completed `CallRecord` (declined, missed, analysed or error) carries
`training: { outcome, success, difficulty }` with the canonical values above (`difficulty` as `easy|medium|hard`).

### Abandoned calls (not scored, not saved)

A call the browser gives up while it is still ringing is **abandoned**, not missed: the user switched to caption-only
practice after `503 elevenlabs_not_configured` / `502 elevenlabs_error` or a microphone refusal, or left the page while
it rang. `POST /api/comms/calls/:id/abandon` (owner only; `409 not_ringing` otherwise) completes it with raw outcome
`error`, `error: "abandoned"` and `training: { outcome: "error", success: null, … }`, and it is **never** saved as a
training attempt. The call sweeper treats a call still ringing after 2 minutes the same way (tab closed, or stuck on
a voice/mic error with the ring timer paused). Only the browser's ring timer reports a real `missed`
(`POST /api/comms/calls/:id/decline { reason: "missed" }`).

Rule: every call scenario is a scam. Declining, missing/ignoring, or ending the call without sharing a code,
payment, personal info or agreeing to act is a successful (resisted-type) outcome. Any compromising signal makes it
`compromised` regardless of anything else.

## Call scenarios are server-owned

- Clients start calls with `{ scenarioId }` only (or `{}` for a random fixture). Any `scenario` object or other key in
  the body is rejected (`400`).
- Unknown ids → `404 scenario_not_found`. A database failure while looking up a `gen-` id is
  `503 SERVICE_UNAVAILABLE`.
- Practice-path calls live in `backend/fixtures/scenarios/call-lib-call-*.json`. They are built from scam-library call
  patterns by `npm run build:practice` (`backend/scripts/build-practice.ts`), which also writes their frontend teaching
  copy under the same ids into `frontend/src/features/training/practice.json`. Never edit either by hand:
  - `lib-call-0e5cfce002d9`: courier says a delivery is on hold, wants a sign-in, remote access and a fee (1 / easy)
  - `lib-call-d6ff8dcc42ad`: prize win that needs card details and an upfront payment (1 / easy)
  - `lib-call-b5c8c2ff529a`: bank caller asks for the one-time code, then account and card details (2 / medium)
  - `lib-call-9489cf86c8ae`: tax office threatens arrest over money owed (2 / medium)
  - `lib-call-279c76aa6092`: account-security caller leans on authority for personal details (3 / hard)
- Generated (Gemini) scenarios: created only by `POST /api/training/call-scenarios`, stored in
  `generated_call_scenarios`, ids `gen-call-<uuid>` (older `gen-<uuid>` ids stay valid; everything matches on `gen-`).
  Without `GEMINI_API_KEY`, or when Gemini fails, a built-in call is built from a scam-library call pattern for the
  category (or one generic last-resort pattern when the library has none). Generated calls carry `scamCategory`, which the saved attempt and the
  `call.ringing` event (`data.scamCategory`) pass on. `ScenarioCatalog` (`backend/app/scenarios/catalog.ts`) resolves any
  id: a fixture, or a `gen-` scenario only if it belongs to the verified caller (another user's id is a 404).

## Conversation id binding

- On `accept`, the server binds the ElevenLabs `conversation_id` from the token response to the call when present.
- If the token has none, the **first** id reported by the browser (`POST /api/comms/calls/:id/connected` or `/ended`)
  binds it; any later different id is rejected with `409 conversation_mismatch`.
- `/ended` with an id that differs from the bound one → `409 conversation_mismatch`, and the call is not analysed
  with it. The call stays `in_call`, so the correct `/ended` (or the sweeper after the max call length) can still
  finish it. A call with no bound id is never analysed; it completes as `error`.
- `POST /api/comms/calls/:id/abandon` → `200` call record (unscored, never saved; see above); `409 not_ringing` once
  the call was answered, declined, missed or already abandoned.
- `POST /api/comms/calls/:id/connected { conversationId }` → `200` call record; `409 conversation_mismatch` as above;
  `409 not_in_call` before accept. The browser sends it from `onConnect`.

## Saving call results

When a call reaches `completed` (other than abandoned), the call service saves one `training_attempts` row through
the attempts repository, in-process. The row (`backend/app/calls/attempt.ts`, validated by
`backend/app/training/attempts.schema.ts`):

```json
{
  "attemptId": "call_…",            // the call id; the primary key, so a repeat save is a no-op
  "firebaseUid": "…",              // from the verified token at call start
  "channel": "call",
  "scenarioId": "lib-call-b5c8c2ff529a",
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

Limits: `summary` and each transcript `message` ≤ 4000 characters, `scenarioTitle` ≤ 200, ≤ 200 turns. Longer values
are clipped (ending in `…`) before saving, so an oversize ElevenLabs summary never loses the attempt. Raw captions,
codes and email addresses are never stored: the transcript and summary are redacted when the analysis arrives.

Saving is best-effort and runs in the background: a database error is logged and never breaks or delays the call
flow. The call record (with its `training` field) stays available from `GET /api/comms/calls/:id` either way.

## Browser-facing training routes (Firebase-authenticated)

- `GET /api/training/progress` → `{ attempts: [{ id, channel, scenarioId, scenarioTitle, difficulty, scamCategory, outcome, success, completedAt }], stats: { total, successes, compromised }, vulnerability: { weakCategories, vulnerableTactics, categoryAccuracy }, difficulty, focus }`
  (`difficulty`/`focus`: what the next generated scenario uses; see `docs/mvp-contracts.md`)
  (newest first, max 50 attempts).
- `GET /api/training/attempts/:id` → one attempt including its redacted transcript, signals and summary (owner only, else 404).
  For a call, `:id` is the call id.
- `POST /api/training/call-scenarios` → generates a scenario with Gemini (or a built-in fallback when no key),
  stores it, returns `{ scenarioId: "gen-call-…", title, callerLabel, difficulty, tactics, source: "gemini" | "fallback" }`
  (no prompt text). Rate-limited per uid (5/min and 30/day), `429 { error: { code: "RATE_LIMITED" } }`.
  The category comes from (in order) the insights' focus (`repos.insights.latestFocus`, read server-side), the
  user's weak categories, then their profile; the browser sends `{}`.
- `GET /api/training/call-scenarios/:id` → the frontend `CallScenario` (owner only, `404 scenario_not_found` otherwise):
  `{ id, type: "call", title, summary, situation, difficulty, callerLabel, callerNumber?, tactics, indicators: [{ title, detail }],
  explanation, nextTime, practice: { lines, complyLabel }, scamCategory, generated: { source, reason } }`. Never the
  system prompt or voice. `/train/gen-call-…` loads it through `useScenario`.

The simulated text and call routes are listed in [`backend/README.md`](../backend/README.md#simulated-texts-and-calls-apicomms).

## Frontend

- The browser reaches everything through the same origin: `/api` (the Vite dev proxy forwards it to the backend).
  `frontend/src/comms/` calls `/api/comms` (override with `VITE_COMMS_BASE_URL`).
- SMS/email progress stays in `localStorage` (unchanged). Call progress is read from `GET /api/training/progress`;
  the debrief prefers the saved attempt, falling back to the call record.
- Call UI never decides success itself: it uses the canonical outcome/success it receives (from the call record's
  `training` field or the saved attempt).
- When ElevenLabs isn't configured (`503 elevenlabs_not_configured`) or the API is unreachable, the call scenario stays
  usable through a clearly labelled caption-only practice mode; those local demo results are stored in localStorage only.
  Switching to practice from a ringing call, or leaving the page while it rings, abandons the call first.
- A call that never connects (no `onConnect` and no error) shows **Cancel** on the connecting screen, and gives up by
  itself 20 s after the microphone check. Either one abandons the call if the accept hasn't landed (an
  `409 not_ringing` falls back to `/ended`), or sends `/ended` without a connected conversation so the server
  completes it unscored as `error`; then the failure screen offers caption-only practice.
- Frontend call metadata (`frontend/src/features/training/practice.json`: title, caller label, difficulty, tactics)
  matches the fixture with the same id; both are written by one build, and `frontend/tests/call.test.mjs` and
  `backend/tests/practice.test.ts` fail on drift.
