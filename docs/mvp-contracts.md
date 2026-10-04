# Adaptive MVP contracts

The shared interfaces for the adaptive training loop. `docs/call-integration.md` still owns the call contract.
If an implementation must differ from this file, update this file in the same change.

```
profile ─▶ scenario generation (Gemini) ─▶ training (email · text · call/ElevenLabs)
   ▲                                              │
   │                                    behaviour events (TigerData hypertable)
   │                                              │
   └── adaptation ◀── vulnerability analysis (Snowflake) ◀── metrics (TigerData SQL)
```

## Canonical vocabulary (`backend/app/shared/vocabulary.ts`)

| Concept | Values |
|---|---|
| channel | `sms`, `email`, `call` |
| difficulty | `easy`, `medium`, `hard` |
| outcome (calls) | `resisted`, `compromised`, `declined`, `missed`, `error` |
| outcome (texts, emails) | `reported_correct`, `reported_incorrect`, `safe_correct`, `safe_incorrect` |
| scam category | `banking`, `government`, `shipping`, `account_security`, `workplace`, `promotional` |
| behaviour event | `scenario_started`, `message_opened`, `sender_inspected`, `link_clicked`, `attachment_opened`, `message_reported`, `message_marked_safe`, `call_received`, `call_answered`, `call_declined`, `call_missed`, `call_ended`, `scenario_completed`, `debrief_viewed` |

- `outcomeSuccess(outcome)`: `error` → null (unscored); `compromised`, `reported_incorrect`, `safe_incorrect` → false; everything else → true.
- `fellForScam(outcome)`: `compromised` or `safe_incorrect`.
- Message outcomes: `reported_*` = the user chose Report; `safe_*` = Looks safe; `_correct` = matches the scenario's `correctAction`.
- Category: stored when known (`training_attempts.scam_category`, `behavior_events.scam_category`), else
  `inferCategory({ id, title })` (`backend/app/training/progress.ts`). `summarizeAttempts` prefers the stored one.

## Database (migration `005_adaptive_mvp.sql`)

- `training_attempts`: outcome CHECK widened to the message outcomes; new nullable `scam_category`.
- `behavior_events`: append-only time series, a TimescaleDB hypertable on TigerData (plain table elsewhere, e.g. PGlite
  tests). Columns: `event_time`, `firebase_uid`, `event_type`, `channel`, `scenario_id`, `attempt_id`, `scam_category`,
  `difficulty`, `outcome`, `response_time_ms` (since the run started), `metadata` jsonb. No primary key (hypertable).
  Portable SQL only in app queries (`date_trunc`, not `time_bucket`), unless guarded.
- `generated_message_scenarios`: `id` (`gen-email-…` / `gen-sms-…`), `firebase_uid`, `channel`, `scenario` jsonb
  (the frontend `Scenario` shape), `source` (`gemini` | `fallback`).
- Reserved migration numbers if an agent needs one: 006 behaviour (Agent 2), 007 generation (Agent 1),
  008 insights (Agent 3), 009 calls (Agent 4).

## Generated scenarios

Ids carry the channel: `gen-email-<uuid>`, `gen-sms-<uuid>`, `gen-call-<uuid>` (older call ids `gen-<uuid>` stay valid).
The frontend resolves any scenario with `useScenario(id)` (`frontend/src/features/training/useScenario.ts`): built-in
ids from `scenarios.ts`, generated ones from a GET that returns the **frontend `Scenario` shape**
(`frontend/src/features/training/scenarios.ts`) including `generated: { source, reason }` and `scamCategory`.

| Route (all authenticated, owner-only reads) | Owner |
|---|---|
| `POST /api/training/email-scenarios` → `201 { scenario: EmailScenario }` | Agent 1 |
| `GET /api/training/email-scenarios/:id` → `EmailScenario` (404 for anyone else's) | Agent 1 |
| `POST/GET /api/training/sms-scenarios[/:id]` (optional) | Agent 1 |
| `POST /api/training/call-scenarios` (exists), `GET /api/training/call-scenarios/:id` → frontend `CallScenario` (teaching metadata only, never the system prompt) | Agent 4 |

- Generation inputs are read **server-side** (profile, history via `summarizeAttempts`, latest insights); the browser
  never sends profile context. Profile text goes through `cleanProfileText` before any prompt.
- Every generator validates the model output with zod and falls back to a built-in scenario; nothing malformed reaches
  the browser. Rate limit: `repos.scenarios.claimGeneration(uid, perMinute, perDay)` (shared budget).
- Every red flag / indicator `quote` must appear verbatim in the rendered text (sender, subject, body, links), so
  `markText` can highlight it.

## Behaviour events and metrics (Agent 2)

- `POST /api/training/events` `{ events: [...] }` (batched, small). Each: `type`, `channel`, `scenarioId`,
  `attemptId`, optional `scamCategory`, `difficulty`, `outcome`, `responseTimeMs`, `metadata`, `at`. The uid comes from
  the token only. Texts and emails: a `scenario_completed` event with an outcome also records a `training_attempts`
  row (id = `attemptId`, idempotent), so the vulnerability profile and adaptive difficulty cover every channel.
- Calls: events are derived server-side from the call lifecycle (the sim event sink); the browser does not post them.
- `GET /api/training/metrics`: accuracy, report rate, average detection time, a then-vs-now trend, per-category
  stats, most improved category, per-day timeline. Empty history returns nulls/empty arrays, never an error.

## Vulnerability analysis (Agent 3)

- `GET /api/training/insights` →
  `{ strongestAreas: string[], weakAreas: string[], behavioralPattern: string, recommendation: string,
     nextTrainingFocus: ScamCategory[], source: 'snowflake' | 'fallback', generatedAt: string, basedOn: { attempts: number } }`.
- Snowflake (SQL API over HTTPS, `SNOWFLAKE_*` config) analyses the aggregated summary; without credentials, or on any
  error or timeout, the backend computes the same shape deterministically. The latest result is cached per user so
  generators can read `nextTrainingFocus` cheaply.
- Generators: `repos.insights.latestFocus(uid): Promise<ScamCategory[]>` never calls Snowflake: the cached focus when it
  covers the newest attempt, else the built-in analysis of the current history; `[]` for a new user.
- Snowflake only receives `HMAC(SNOWFLAKE_ID_SALT, uid)` and per-category/per-tactic counts and rates (setup:
  `backend/scripts/snowflake-setup.sql`).

## UI copy

- Personalised content says so plainly ("Generated for your training profile"), without leaning on "AI".
- Each sponsor-backed panel carries one quiet, **honest** source line (e.g. "Analysed in Snowflake" only when it was;
  "Built-in analysis" on the fallback).
