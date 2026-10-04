# Tellio backend

One Express + TypeScript server for everything the browser talks to:

- **Profiles.** Firebase handles signup, login, password resets and authentication sessions. Express verifies Firebase ID tokens. TigerData stores personal profiles, keyed by the verified Firebase UID. No passwords or authentication tokens are stored in TigerData.
- **Simulated scam texts and calls** (`/api/comms/*`). Nothing goes to a real phone:
  - **Texts:** a fake messaging thread. The scammer's messages arrive over server-sent events (SSE), and the user replies through the API.
  - **Calls:** the site shows a ringing phone. On accept, the browser talks live to an ElevenLabs agent (Gemini LLM) using `@elevenlabs/react`.
- **Training results.** Finished calls are saved as training attempts; the server computes call progress and the vulnerability profile, and generates call scenarios (Gemini, or built-in ones without a key). SMS/email practice progress stays browser-local.

The contract with the frontend is [`docs/call-integration.md`](../docs/call-integration.md).

## Setup

Requires Node.js 22.18+ and a TigerData/PostgreSQL database. Run commands from `backend/`:

```sh
npm install
cp .env.example .env
# Fill in DATABASE_URL and FIREBASE_PROJECT_ID (and optionally the ElevenLabs keys, see below).
npm run migrate
npm run dev          # API on :3000
```

Use the same Firebase project as the frontend. The Admin SDK verifies client ID tokens using the configured project and Google's public signing keys; this backend performs no Firebase account administration.

The API listens on `127.0.0.1:3000`. `APP_ORIGIN` must match the frontend origin exactly (default `http://localhost:5173`). The frontend proxies `/api` to the backend, so the browser, the SSE stream and the tracked links are all same-origin. Production should expose both behind the same HTTPS origin; configure `APP_ORIGIN` accordingly.

TigerData TLS keeps certificate and hostname verification enabled. For a custom service CA, place the certificate bundle outside tracked source and add its absolute path as `sslrootcert` in `DATABASE_URL`. Local `.certs/` and `.env` are ignored. See [TigerData's strict SSL procedure](https://www.tigerdata.com/docs/use-timescale/latest/security/strict-ssl/). Database passwords containing special characters must be URL-encoded.

Migrations in `app/db/migrations` are transactional, serialized, and recorded in `schema_migrations`; `npm run migrate` applies any that are new. `001` creates `user_profiles`; `002` creates `training_attempts` (id = call id, so saving the same call twice is a no-op; canonical channel/difficulty/outcome enforced by CHECKs; `metadata` holds only the redacted summary and transcript) and `generated_call_scenarios` (`gen-…` ids, the `CallScenario` JSON, `source` = `gemini` or `fallback`); `003` creates the simulation tables `sim_text_threads`, `sim_calls` and `sim_events` (see **Simulation state**); `004` creates `scenario_generation_requests`, the log behind the scenario generation rate limit. Migration commands are repeatable and do not drop existing tables. Run migrations explicitly before serving traffic; API startup does not modify the schema.

### ElevenLabs (voice calls)

**Getting an API key:**

1. Sign up or log in at [elevenlabs.io](https://elevenlabs.io). The free plan is enough for testing.
2. Open [Settings → API Keys](https://elevenlabs.io/app/settings/api-keys) and click **Create API Key**.
3. Name the key (e.g. `tellio-dev`). Leaving **Restrict Key** off is simplest. If you turn it on, give the key **Write** access to **ElevenLabs Agents** (called **Conversational AI** on older dashboards). That access is needed to create and update the agent, issue call tokens, and read conversations. You can also set a credit limit so testing can't use up the account's credits.
4. Copy the key right away, because the dashboard only shows it once. It is server-only: keep it in `.env` (gitignored) and never put it in frontend code.

**One-time setup:**

1. Put `ELEVENLABS_API_KEY` in `.env`.
2. Run `npm run setup:agent` (it reads the same `.env` as the API, so `DATABASE_URL` and `FIREBASE_PROJECT_ID` must be set too).
3. Paste the printed `ELEVENLABS_AGENT_ID` into `.env` and restart the API.

Re-running `setup:agent` updates the existing agent. Then sign in to the frontend and start a call scenario to ring, talk and see the analysed result.

**Without ElevenLabs keys** everything else still works: the scenarios list, calls ring, and decline/missed complete, are scored and saved. Only `POST /api/comms/calls/:id/accept` fails, with `503 elevenlabs_not_configured`; the frontend falls back to its caption-only practice mode.

### Simulation state

Text threads, calls and their tracked links live in Postgres (`sim_text_threads`, `sim_calls`), one jsonb document per simulation, so restarts and every API process share them. Each update is a row-locked read-modify-write (`SELECT … FOR UPDATE` in a transaction), and a partial unique index allows one active text thread per user. Simulation events are appended to `sim_events`. Nothing is written to local files. Finished calls also become rows in `training_attempts`.

### Environment

All are read from `backend/.env` by `app/config.ts` and passed into the modules that need them; an empty `KEY=` counts as unset.

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | required | TigerData/Postgres connection |
| `FIREBASE_PROJECT_ID` | required | Firebase project whose ID tokens are accepted (match `VITE_FIREBASE_PROJECT_ID`) |
| `HOST`, `PORT` | `127.0.0.1`, `3000` | Listen address |
| `APP_ORIGIN` | `http://localhost:5173` | Frontend origin: required on browser writes, and where tracked links redirect (`/caught?sim=`) |
| `NODE_ENV` | `development` | `production` requires an HTTPS `APP_ORIGIN` |
| `GEMINI_API_KEY` | unset | Unset or failing Gemini uses built-in call scenarios (`source: "fallback"`) |
| `ELEVENLABS_API_KEY`, `ELEVENLABS_AGENT_ID` | unset | Voice calls; see above |
| `ELEVENLABS_DEFAULT_VOICE_ID` | unset | Agent default voice (setup:agent) |
| `ELEVENLABS_LLM` | `gemini-2.5-flash` | LLM the agent runs on (setup:agent) |
| `CALL_MAX_SECONDS` | `180` | Hard cap on a call; a call never reported as ended is analysed after this plus a minute |
| `TEXT_FOLLOWUP_SEC`, `TEXT_IDLE_END_SEC` | `120`, `600` | Text threads: nudge after this much silence, end after this much inactivity |

## Structure

Organised by feature. Each feature owns its routes, schema, repository or service and logic; shared concerns live beside them.

```
app/
  main.ts               composition root: config → db pool → repositories → simulation store/events → services → app → listen, sweepers, shutdown
  server.ts             HTTP assembly: shared middleware, then each feature's router
  config.ts             env schema (zod)
  repositories.ts       builds every feature's repository from one pool
  shared/               vocabulary.ts (canonical channel, difficulty, outcome, tactic), types.ts (scenario, text thread and call shapes), redact.ts, ids.ts
  http/                 errors, Firebase auth (with the SSE query-token option), app-origin guard
  db/                   pool, migrate, migrations/*.sql
  users/                onboarding profile: routes, repository, schema
  training/             attempts and progress: routes, repository, schema, progress (pure)
  scenarios/            catalog.ts (fixtures + the owner's gen- scenarios), generator (Gemini), repository, routes (generate, list)
  sim/                  simulation store and event sink: interfaces with in-memory versions (store.ts, events.ts), Postgres in sim.repository.ts
  texts/                service, routes (+ tracked-link redirect and SSE stream), sse, links, provider (reply generation), classify
  calls/                service, routes, elevenlabs client, outcome (canonical table), attempt (training-attempt payload), preamble
fixtures/scenarios/     sample text-*.json and call-*.json scenarios, loaded at startup
scripts/setup-agent.ts  creates or updates the ElevenLabs agent (npm run setup:agent)
```

Dependency rules:

- Features depend on `shared/`, `http/` and `db/`, never the reverse. `server.ts` and `main.ts` are the only places that know every feature.
- Feature-to-feature links: `scenarios → training/progress` (difficulty and weak categories personalise a scenario); `texts` and `calls → scenarios/catalog` (start by id) and `→ sim/` (state and events); `calls → training` (save attempts through the repository and its schema).
- Repositories are the only modules that run SQL. Routes and services get their repositories and clients injected (`createApp({ repos, services })`, `new CallService(store, events, { attempts, elevenLabs })`), so tests use in-memory fakes.
- No module reads `process.env` except `config.ts`.

## Auth

Every profile, training and simulation request requires `Authorization: Bearer <Firebase ID token>`, verified with firebase-admin `verifyIdToken` (signature, expiry, audience, issuer) by `requireAuth` in `app/http/auth.ts`. The uid always comes from the verified token (`req.user.uid`), never from a body, query or other header.

- Public, no token: `GET /api/health`, `GET /api/comms/scenarios`, and the tracked link `GET /api/comms/l/:token` (a plain browser navigation).
- The SSE stream `GET /api/comms/texts/:id/stream` alone also accepts `?access_token=<token>`, because `EventSource` can't send headers. It is mounted with `requireAuth(verify, { queryToken: true })`; every other route ignores the query token.
- A missing token is `401 UNAUTHENTICATED`; an expired, malformed, unsigned or forged token (or one without an email) is `401 INVALID_TOKEN`. Firebase outages are a retryable `503`.
- Another user's attempt, thread or call is a `404`, so ids can't be probed.

Browser writes (every non-GET under `/api`) require the configured `Origin` and an `application/json` body (send `{}` when there are no arguments). Errors have `{ "error": { "code", "message" } }`; validation adds `fields`, and a few add details (`threadId`, `status`). Provider/network/database failures return retryable `503 SERVICE_UNAVAILABLE` without raw credential or database details.

## API

| Method | Path | Behavior |
| --- | --- | --- |
| GET | `/api/health` | Process liveness |
| GET | `/api/users/me` | Persist/update Firebase identity details and return the caller's profile |
| PUT | `/api/users/me` | Save personal details and complete onboarding |
| GET | `/api/training/progress` | `{ attempts, stats, vulnerability }`: newest 50 attempts plus stats over the whole history |
| GET | `/api/training/attempts/:id` | One attempt with signals, summary and redacted transcript; 404 unless it is the caller's |
| POST | `/api/training/call-scenarios` | Generate and store a scenario; `201 { scenarioId, title, callerLabel, difficulty, tactics, source }`. Send `{}`. 5/min and 30/day per user, counted in Postgres so the limit holds across processes and restarts, else `429 RATE_LIMITED` |

Progress `stats` are `{ total, successes, compromised }` over scored attempts (`error` attempts are listed but not counted). `vulnerability` is `{ weakCategories, vulnerableTactics, categoryAccuracy }`: categories are inferred from the scenario id/title, a category turns weak below 75% accuracy and recovers at 80%, and tactics are ranked by how often they appeared in compromised attempts. The same replay sets the difficulty used for generated scenarios.

GET `/api/users/me` creates an incomplete profile on first sign-in. Its returned fields are `id`, `uid`, `email`, `emailVerified`, `name`, `phone`, `profession`, `interests`, `onboardingComplete`, `createdAt`, and `updatedAt`. Email and verification status follow Firebase; subsequent logins preserve the user's saved personal name and preferences.

PUT accepts only:

```json
{
  "name": "Alex Taylor",
  "phone": "+1 604 555 1234",
  "profession": "student",
  "interests": ["gaming", "travel"]
}
```

Name and international phone number are required. Phone formatting is normalized to `+16045551234`. Phone ownership verification is not implemented. Profession and interests are optional. Email, password, UID and internal ID overrides are rejected. Ownership always comes from the verified token. Concurrent retries cannot create duplicate profiles.

### Simulated texts and calls (`/api/comms`)

Use the wiring in **`frontend/src/comms/`** rather than calling these routes by hand:

| Module | Gives you |
| --- | --- |
| `api.ts` | `comms`: a typed client for every route below (base `/api/comms`, override with `VITE_COMMS_BASE_URL`). It attaches the Firebase token, sends JSON on every POST, and retries once with a fresh token on 401. |
| `useScenarios(channel?)` | Sample scenarios for a picker. |
| `useTextThread(threadId)` | A live text thread: messages, typing indicator, outcome, `send`, `report`, `reconnect`. |
| `useSimulatedCall()` | The call lifecycle (`start`, `accept`, `decline`, `hangUp`), live captions and the analysed result. It must render inside `<ConversationProvider>` from `@elevenlabs/react`. |

Simulation ids are unguessable, so they're safe to put in results URLs.

#### Texts

| Method & path | Body | Returns |
| --- | --- | --- |
| `GET /api/comms/scenarios?channel=text\|call` | – | `{ scenarios: [{ id, channel, title, tactics, difficulty, label }] }`. No auth, and no prompt text. |
| `POST /api/comms/texts` | `{ scenarioId }`, or `{}` for a random sample | `201 { threadId, streamUrl, thread }`. `409 active_thread_exists` (with `error.threadId`) if the user already has an active thread; `404 scenario_not_found` for an unknown id; `400` for any other key (e.g. `scenario`). |
| `GET /api/comms/texts/:id/stream?access_token=` | – | SSE stream (see below) |
| `POST /api/comms/texts/:id/replies` | `{ body }` | `202 { message }` (redacted copy of the user's message), or `409 thread_ended` |
| `POST /api/comms/texts/:id/report` | `{}` | Thread, ended with outcome `reported` (wire this to a "Report / block" button) |
| `GET /api/comms/texts/:id` | – | Full `TextThread` for results pages |

SSE events (`Content-Type: text/event-stream`, no compression, a `: ping` comment every 25 s):

- `message`: a `TextMessage` (`{ id, from: 'scammer' | 'user', body, at, links?, followUp? }`). History is replayed on connect. On reconnect, only messages after `Last-Event-ID` are sent. Dedupe by `id`.
- `typing`: `{ on: boolean }`. Show "…" while the scammer is "typing".
- `ended`: `{ outcome, reason }`. Close the `EventSource` when you get this.

**Links.** `body` contains the fake display URL (e.g. `postnorth-redelivery.info/pay`). `links: [{ text, href }]` tells you which text to make tappable and where it goes. `href` is our same-origin tracked redirect (`/api/comms/l/:token`). It records the tap and time-to-click, then redirects to `APP_ORIGIN/caught?sim=<threadId>`, the frontend's "this was a simulation" page.

#### Calls

| Method & path | Body | Returns |
| --- | --- | --- |
| `POST /api/comms/calls` | `{ scenarioId }`, or `{}` for a random sample | `201 { callId, callerLabel, call }`. Start ringing. `404 scenario_not_found` for an unknown id (or another user's `gen-` id), `400` for any other key (e.g. `scenario`). |
| `POST /api/comms/calls/:id/accept` | `{}` | `{ conversationToken, conversationId, overrides }`. `503 elevenlabs_not_configured` without ElevenLabs keys, `502 elevenlabs_error` if ElevenLabs fails. |
| `POST /api/comms/calls/:id/abandon` | `{}` | Call record, completed as an unscored `error` (`error: 'abandoned'`) and **not** saved. Send it when you drop a call that is still ringing (switching to caption practice, leaving the page). `409 not_ringing` otherwise. |
| `POST /api/comms/calls/:id/connected` | `{ conversationId }` | Call record. Send from `onConnect`. `409 conversation_mismatch` if a different id is already bound, `409 not_in_call` before accept. |
| `POST /api/comms/calls/:id/decline` | `{ reason: 'declined' \| 'missed' }` | Call record. Send `missed` when your ring timeout expires. |
| `POST /api/comms/calls/:id/ended` | `{ conversationId? }` | `202`. Analysis runs in the background. `409 conversation_mismatch` if the id differs from the bound one (the call stays `in_call`). |
| `GET /api/comms/calls/:id` | – | Call record. Poll every ~2 s while `status === 'analyzing'`. |

`status` moves through `ringing` → `in_call` → `analyzing` → `completed`, or straight from `ringing` to `completed` if declined, missed or abandoned. A call still ringing after 2 minutes (tab closed, or stuck on a voice/mic error) is abandoned by the sweeper, not missed: only your ring timer reports a real miss. `outcome` and `training` are set once the status is `completed`. The sweepers run every 15 s and once at startup, so analyses interrupted by a restart resume.

**Scenarios are server-owned.** Fixed ones (`fixtures/scenarios/call-*.json`):

| id | difficulty | theme |
| --- | --- | --- |
| `bank-fraud-dept-otp-1` | 2 / medium | Bank fraud department asks for a verification code |
| `cra-tax-arrears-1` | 2 / medium | CRA impersonator demands payment for tax arrears |
| `courier-customs-fee-1` | 1 / easy | Courier asks for a small customs fee by card |
| `tech-support-remote-1` | 2 / medium | Tech support wants remote access |
| `exec-vendor-payment-1` | 3 / hard | Executive asks for an urgent payment to a new vendor account |

`gen-…` ids come from `POST /api/training/call-scenarios`; `ScenarioCatalog` resolves them from `generated_call_scenarios` for the verified uid only, so another user's id is a 404.

**Conversation binding.** The ElevenLabs `conversation_id` from the token is bound on accept when present. Otherwise the first id reported via `/connected` or `/ended` is bound. Any different id later is `409 conversation_mismatch`; a mismatched `/ended` leaves the call `in_call`, so the correct `/ended` (or the sweeper after max duration) can still finish it. Only the bound id is ever analysed; a call with none ends as `error`.

**Training result.** Every completed call (declined, missed, analysed or error) carries `training: { outcome, success, difficulty }`, the canonical result from the table in [`docs/call-integration.md`](../docs/call-integration.md) (`app/calls/outcome.ts`). Use it as-is; never derive success from `outcome`.

| raw `outcome` | `training.outcome` | `training.success` |
| --- | --- | --- |
| `compromised` | `compromised` | `false` |
| `resisted`, `reported` | `resisted` | `true` |
| `declined` | `declined` | `true` |
| `ignored`, `missed` | `missed` | `true` |
| `error` | `error` | `null` (not scored) |

`difficulty` is `easy` / `medium` / `hard` for 1 / 2 / 3.

**Saving results.** When a call reaches `completed`, the call service saves it through the attempts repository (`app/calls/attempt.ts` builds the row, `attemptSchema` validates it): uid from the verified token, the redacted transcript only (max 200 turns), canonical outcome/success/difficulty. Text is clipped first (summary and each turn ≤ 4000 characters, title ≤ 200) so an oversize summary never loses the attempt. The row id is the call id, so a repeat is a no-op. Abandoned calls are never saved. Saving runs in the background: a database error is logged and never affects the call (there is no retry; the result stays in the call record).

If you use `@elevenlabs/react` directly instead of `useSimulatedCall`, note two things:

- `useConversation` must be rendered inside `<ConversationProvider>`.
- `startSession({ conversationToken, connectionType: 'webrtc', overrides })` returns `void`, so failures arrive through `onError`, not a rejected promise.

`onDisconnect` also fires when the agent hangs up (its `end_call` tool) or the max duration is reached.

### Scenario content and reply generation

- **Scenario shapes:** `TextScenario` and `CallScenario` in `app/shared/types.ts` (zod-validated). Use `{{link}}` in text messages; the server swaps it for the fake display URL plus our tracked link.
- **Sample scenarios:** `fixtures/scenarios/text-*.json` and `call-*.json` (each shaped `{ userId, scenario }`) are loaded at startup and served by `GET /api/comms/scenarios`. Drop new samples there; an invalid file stops the server with the file name. Clients can only start these by id (plus their own `gen-` call scenarios); custom scenarios in request bodies are rejected.
- **Text replies:** implement `ScenarioProvider` in `app/texts/provider.ts`:
  - `nextTextTurn({ scenario, messages, preSignals })` → `{ reply, signals, done }`
  - `followUp(...)` → a nudge, or `null`

  The `StubProvider` is used until yours is ready; swap it in `app/main.ts`. User messages arrive **already redacted** (`[NUMBER:6 digits]`, `[EMAIL]`). `preSignals` are rule-based hints. The signals you return are authoritative and decide the thread's outcome.
- **Calls:** the scenario's `systemPrompt` and `firstMessage` override the ElevenLabs agent per call. `app/calls/preamble.ts` is prepended to every prompt.
- **Scoring:** texts only set a preliminary `outcome`. Use the events below, including the full redacted transcript in `call.analyzed`, for real scoring and feedback.

### Events

`EventSink` (`app/sim/events.ts`) receives every simulation event. `PgEventSink` stores each one in `sim_events` (the whole envelope in `event`, plus `type`, `at`, `user_id`, `simulation_id` and `channel` columns); a failed write is logged and never interrupts a simulation. Envelope:

```ts
{ id, type, at, userId, simulationId, channel: 'text' | 'call', scenarioId, tactics, data }
```

| type | `data` |
| --- | --- |
| `text.thread_started` | `senderLabel, difficulty` |
| `text.message_sent` / `text.follow_up_sent` | `messageId, body, hasLink, turn` |
| `text.reply_received` | `messageId, body` (redacted), `latencyMs` (since last scammer message), `preSignals` |
| `text.reply_classified` | `messageIds, preSignals, signals, done` |
| `link.clicked` | `timeToClickMs, afterEnd` |
| `text.reported` | – |
| `text.thread_ended` | `outcome, reason, signals, scammerTurns, userReplies, durationMs` |
| `call.ringing` | `callerLabel, difficulty` |
| `call.accepted` / `call.declined` / `call.missed` / `call.abandoned` | `ringMs` |
| `call.ended` | `conversationId` |
| `call.analyzed` | `outcome, signals, resisted, durationSecs, terminationReason, dataCollection, summary, transcript` |
| `call.failed` | `error` |

**Signals:** `clicked_link`, `shared_code`, `shared_personal_info`, `shared_payment_info`, `agreed_to_action` (these five count as compromised), plus `engaged`, `challenged`, `asked_to_verify`, `reported`, `stop`.

**Raw outcomes:** `compromised`, `resisted`, `reported`, `ignored`, `declined`, `missed`, `error`.

## Tests

```sh
npm run typecheck
npm test
```

Unit and route tests run without a database, against in-memory repositories, an in-memory simulation store and a stubbed `fetch` (they never read `.env` or reach ElevenLabs, Gemini or Firebase). Integration tests require a dedicated database with a name ending in `_test`:

```sh
TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/tellio_test' npm test
```

The suites truncate only `user_profiles`, `training_attempts`, `generated_call_scenarios`, `scenario_generation_requests` and the `sim_*` tables in that test database, and test files run serially. Test Firebase verifiers are injected directly into the test app (`tests/harness.ts`); production has no mock-auth mode. Tests cover token verification (forged, unsigned, expired), the SSE query token, the Origin/JSON guard, unknown and client-supplied scenarios, `gen-` owner scope, conversation binding, abandon and the sweeper, the simulation store contract (in memory and in Postgres: atomic updates, one active thread per user, sweeper queries, link lookups), the canonical outcome table, redaction and clipping of saved attempts, the no-ElevenLabs fallback, idempotent saves, owner-only reads, progress/vulnerability updates, scenario fallback and rate limits, plus profile isolation, idempotent onboarding, identity synchronization, invalid input, persistence across reconstructed servers, safe failures and origin enforcement.
