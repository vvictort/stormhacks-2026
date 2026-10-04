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
  Emails (`backend/app/scenarios/email-generator.ts`): checked against exactly what `EmailView` highlights, i.e.
  `fromAddress`, `replyTo`, `subject`, body paragraphs, `attachment` (via `markText`) and whole link URLs (`markFor`);
  `fromName` is not highlighted, so it never counts. Overlapping quotes count as hidden.
- `generateEmailScenario({ ..., focus?: ScamCategory[] })`: the first valid `focus` category wins over weak categories.
  Both the email and the call route pass `focus: await repos.insights.latestFocus(uid)` (Snowflake's `nextTrainingFocus`
  when cached and current, else the built-in analysis), with `difficulty` from `summarizeAttempts` over the server
  attempts (every channel).

## Behaviour events and metrics (Agent 2)

Code: `backend/app/behavior/` (routes, repository, call bridge), `frontend/src/features/insights/` (tracker, card).

- `POST /api/training/events` `{ events: [...] }` → `202 { accepted: n }`; 1–50 events, any invalid event rejects the whole
  batch (400). The uid comes from the token only. Each browser event:
  `type` (any `BehaviorEventType` except the `call_*` ones), `channel` (`sms` | `email`; calls are server-side only),
  `scenarioId`, `scenarioTitle` (required: category inference and the attempt row need it), `attemptId` (a browser
  `crypto.randomUUID()`, one per run), `difficulty` (required), optional `scamCategory` (else `inferCategory`),
  `outcome` (a message outcome; required on `scenario_completed`, not allowed elsewhere), `responseTimeMs` (since the run
  opened), `metadata` (≤ 8 flat string/number/boolean keys, ≤ 512 bytes; sensitive-looking keys dropped, strings
  redacted; never anything the user typed), `at` (clamped to [server now − 10 min, server now]; missing = server now).
  One multi-row INSERT into `behavior_events`.
- Texts and emails: a `scenario_completed` also records a `training_attempts` row (id = `attemptId`, idempotent,
  `success = outcomeSuccess(outcome)`, `scam_category` set, `tactics: []`, started/duration from `responseTimeMs`), so
  the vulnerability profile and adaptive difficulty cover every channel. The frontend keeps its local text/email
  progress; `mergeProgress` folds in only `channel === 'call'` server attempts, so nothing is counted twice.
- Calls: `CallBehaviorSink` wraps the sim `EventSink` (wired in `main.ts`): `call.ringing` → `call_received`,
  `call.accepted` → `call_answered`, `call.declined` / `call.missed` → `call_declined` / `call_missed` + `scenario_completed`
  (`declined` / `missed`), `call.ended` → `call_ended`, `call.analyzed` → `scenario_completed` (canonical outcome).
  `responseTimeMs` = time since the phone started ringing. Abandoned and failed calls add no scored event. Never throws.
- `GET /api/training/metrics` (own data only; empty history → zeros/nulls/empty lists, 200):
  `{ attempts, accuracy, reportRate, avgDetectionMs, trend: { window, then: Period, now: Period } | null,
     categories: [{ category, attempts, accuracy, avgDetectionMs }], mostImproved: { category, then, now } | null,
     timeline: [{ day: 'YYYY-MM-DD', attempts, correct, avgDetectionMs }],
     recent: [{ at, correct: boolean, detectionMs }] (latest 12, oldest first), storage: 'timescale' | 'postgres' }`,
  `Period = { accuracy, avgDetectionMs }`. `storage` is `timescale` only when `behavior_events` is a hypertable.
  Over completed, scored attempts (one per `attempt_id`, errors excluded). Percentages are 0–100 integers.
  `reportRate` = scam texts/emails reported ÷ scam texts/emails seen. Detection time = decision time on texts/emails and
  time-to-decline on declined calls (answered calls have none). `trend` compares the first k with the latest k attempts,
  k = min(5, ⌊n/2⌋) (null under 2). `mostImproved`: per category, the same halves; the biggest accuracy gain, or with
  equal accuracy the biggest drop in detection time; null without a real gain. `timeline` is per UTC day.

## Vulnerability analysis (Agent 3)

- `GET /api/training/insights` →
  `{ strongestAreas: string[], weakAreas: string[], behavioralPattern: string, recommendation: string,
     nextTrainingFocus: ScamCategory[], source: 'cortex' | 'snowflake' | 'fallback', generatedAt: string, basedOn: { attempts: number } }`.
  `cortex`: Cortex wrote the text over Snowflake's results; `snowflake`: computed in Snowflake (ranking, cohort, tactic-pair
  and quick-catch interpretation), text from the backend; `fallback`: built in. `nextTrainingFocus` is the same
  deterministic pick for all three. UI labels: "Interpreted by Snowflake Cortex" / "Analysed in Snowflake" / "Built-in analysis".
- Snowflake (SQL API over HTTPS, `SNOWFLAKE_*` config) analyses the aggregated summary; without credentials, or on any
  error or timeout, the backend computes the same shape deterministically. The latest result is cached per user so
  generators can read `nextTrainingFocus` cheaply.
- Generators: `repos.insights.latestFocus(uid): Promise<ScamCategory[]>` never calls Snowflake: the cached focus when it
  covers the newest attempt, else the built-in analysis of the current history; `[]` for a new user.
- Snowflake only receives `HMAC(SNOWFLAKE_ID_SALT, uid)` and counts and rates per category, tactic, tactic pair and channel (setup:
  `backend/scripts/snowflake-setup.sql`).

## The adaptive loop (Agent 5)

- `GET /api/training/progress` also returns `difficulty` (`easy|medium|hard`) and `focus: ScamCategory[]`: exactly what
  the next generated email or call will use (`summarizeAttempts(history).difficulty`, `repos.insights.latestFocus(uid)`).
  Home's "Next for you" shows `focus[0]`, why (from `vulnerability.categoryAccuracy` / `vulnerableTactics`) and the
  difficulty (`frontend/src/features/training/adaptive.ts`). Without the API it falls back to the local level.
- Adaptive difficulty (`summarizeAttempts`): replayed per attempt; from the 3rd scored attempt, step up when the last 5
  are ≥ 85% right with none fallen for, step down when 2 or more of the last 5 were fallen for.
- Debriefs ("What Tellio learned from this", `useLearning`): a snapshot (insights, progress and metrics in parallel; insights
  given up after 6 s) when the
  run opens and again once the run's attempt id appears in `progress.attempts` (texts/emails after the tracker flush,
  calls after the server saves the analysed call; polled every 1.5 s, 7 tries). Lines are only real before/after
  differences (difficulty, focus, this category's accuracy, average decision time when faster, overall accuracy);
  with none, it says what Tellio keeps practising. The panel hides when the "before" state couldn't be read; caption-only
  practice calls (local only) show none.
- Metrics `mostImproved`: a faster decision with equal accuracy counts only when that accuracy is above 0.

## UI copy

- Personalised content says so plainly ("Generated for your training profile"), without leaning on "AI".
  A generated scenario adds "Written by Gemini" only when `generated.source === 'gemini'`.
- Each sponsor-backed panel carries one quiet, **honest** source line (e.g. "Analysed in Snowflake" only when it was;
  "Built-in analysis" on the fallback).
