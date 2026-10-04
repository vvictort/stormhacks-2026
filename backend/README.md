# Backend

TypeScript API (Express 5, run with `tsx`). Every `/api` route except
`/api/health` requires a signed-in Firebase user.

```bash
cd backend
npm install
cp .env.example .env   # set FIREBASE_PROJECT_ID
npm run dev            # http://localhost:3000/api
npm test
npm run typecheck
```

## Auth

- **Authentication** (`requireAuth` in `app/core/security.ts`): the frontend sends
  `Authorization: Bearer <Firebase ID token>`. The token is verified with Firebase
  Admin and the decoded token is available as `req.user` (`uid`, `email`, ...).
  Missing or invalid tokens get `401`, and the frontend signs the user out.
- **Authorization** (`requireSelf`): routes with a `:uid` parameter only serve the
  caller's own records; anyone else gets `403`. For per-user data, scope every query
  by `req.user.uid` rather than trusting ids in the request body.
- Public routes (for example provider webhooks) must be mounted above
  `app.use('/api', requireAuth())` in `app/main.ts`.

| Route | Returns |
| --- | --- |
| `GET /api/health` | `{ ok: true }` (public) |
| `GET /api/users/me` | the caller's profile from their token |
| `GET /api/users/:uid` | the same, `403` unless `:uid` is the caller |

## Run locally

Requirements: Node.js 22+, Python 3.11+, and a PostgreSQL-compatible database
(TigerData or a local PostgreSQL instance). Run Node commands from `backend/`.

```sh
npm install
cp .env.example .env
```

Use `backend/.env` for local environment values. The root `.gitignore` excludes
environment files throughout the repository while allowing `.env.example`
templates to be committed. Add variable names and safe placeholder values to the
example as integrations are implemented.

Create the target database, then apply the versioned migration and seed:

```sh
npm run migrate
npm run seed
```

Both commands are repeatable. Migrations are serialized and transactional.
The seed contains 24 explicitly synthetic examples, not a claimed real-world
corpus: 15 scams covering five tactics across three channels, and nine legitimate
communications. Source URLs can be recorded for future sourced patterns. Existing
pattern rows are not overwritten; add new IDs for revised reference material.

In a second terminal, from `backend/personalization/`:

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
export PERSONALIZATION_SERVICE_KEY='the-same-secret-as-express'
python -m uvicorn main:app --host 127.0.0.1 --port 8000
```

Python receives no database credentials. Its `.env.example` documents the service
key; Python does not automatically load an `.env` file. Set the environment
variable explicitly. Request models use FastAPI/Pydantic validation.

Start Express from `backend/`:

```sh
npm run dev
```

Default addresses: Express `http://127.0.0.1:3001`, Python
`http://127.0.0.1:8000`. Both expose `/health` as process liveness only.
`npm run build` and `npm start` run the compiled API. Run migration/seed commands
from the backend root so they can locate SQL and fixture files.

## Account authentication handoff

Account signup/login remains a team dependency. The data layer links a verified
authentication subject to one persistent internal user ID. It never accepts a user
ID or auth identity from the profile body.

Your team's Express middleware must export `authenticate`, verify the account's
session or token, then set `res.locals.auth = { subject: verifiedSubject }` before
calling `next()`. Set `AUTH_MIDDLEWARE_MODULE` to that module's filesystem path,
or supply it directly to `createApp` in the team's application. The module must
be executable by the chosen Node runtime; compile TypeScript for `npm start`.
Use a stable provider/tenant-qualified subject when supporting multiple providers.

Without this adapter, protected routes deliberately return 401. No demo header
or fake login is enabled in the running application. Test middleware is confined
to the tests. Cookie authentication should also provide its CSRF protection.

## Frontend API

| Method | Path | Behavior |
| --- | --- | --- |
| GET | `/api/v1/users/me` | Current profile; 404 until onboarding |
| PUT | `/api/v1/users/me` | Create/update the authenticated user's profile |
| GET | `/api/v1/analytics/me` | Weakness evidence, classification rates, difficulty, scores |
| GET | `/api/v1/game-sessions/current` | Current session and safe active-attempt recovery |

Profile example:

```json
{
  "name": "Kelvin",
  "profession": "student",
  "interests": ["shopping", "gaming"],
  "enabledChannels": ["text", "email", "call"]
}
```

A name and at least one unique enabled channel are required. Channel changes
apply to future attempts, preserving active challenges. Public responses omit
authentication identities. Before scoring, attempt responses contain only display
content, messages, channel, ID, status, and timestamps. Reference labels, warning
signs, targeted tactics, and recommendation reasoning are private. Assessed
feedback includes the classification, warning signs, provenance, and assessment.

Errors use `{ "error": { "code", "message" } }` (validation also lists field
names). Internal Python errors use FastAPI's `detail` shape. Express translates
Python failures, invalid responses, and five-second timeouts into retryable 503s.

## Gameplay and AI integration

The gameplay coordinator should load the current user, call `SimulationService.start`,
and invoke `CampaignWorker.tick(user, sessionId)` when an active session becomes
due. The worker is an integration component, not an automatically running timer.
The coordinator owns polling, browser notifications, and the gameplay HTTP routes;
Kelvin's API currently exposes recovery reads only.

`SimulationService` provides `start`, `pause`, `resume`, `acknowledge`, and `end`.
Starting or acknowledging feedback draws a random delay of 15–45 seconds. Paused
sessions have no scheduled arrival. Resume preserves an active attempt or draws a
new delay if there is none. Session/attempt state survives API restarts.

The worker reserves an attempt transactionally before calling Sijing's
`ScenarioGenerator.generate({ attemptId, user, pattern, recommendation })`.
Generation returns only `{ title, sender, openingText }`. Additional private fields
are rejected. The validated scenario becomes `ready`; failures mark the attempt
`generation_failed` and release its reservation for a later retry. No fabricated
AI content or scores are produced. If a coordinator crashes during generation,
recover its reserved attempt with `abandonAttempt(userId, attemptId, true)` before
rescheduling; there is no automatic generation-lease expiry in this milestone.

Eric/the gameplay backend records simulated actions using `appendEvent` and text
or call transcripts using `appendMessage`. These accept validated IDs, timestamps,
action metadata, and content. Repeated IDs are idempotent; IDs cannot be reassigned
to another user or attempt. Only ready/active attempts in active sessions accept
new observations.

Sijing obtains the private `assessmentContext(userId, attemptId)` and calls
`finalizeAssessment(userId, assessment)` from verified server-side code. The
assessment contract is in `contracts/assessment.json`. There is intentionally no
browser-accessible assessment endpoint. Findings must match reference tactics;
legitimate scenarios have no scam-tactic findings. The first assessment wins,
even if concurrent retries submit different scores. After feedback acknowledgement,
the attempt completes and the next arrival is scheduled.

PostgreSQL composite foreign keys enforce ownership. A partial unique index and
session row locks enforce one active attempt. The states are:

```text
reserved -> ready -> active -> awaiting_feedback -> completed
         -> generation_failed
ready/active/reserved -> abandoned
```

Scoring may also transition a ready attempt directly to awaiting feedback.
Ending a session abandons unfinished attempts and retains assessed outcomes.

## Personalization policy

Internal endpoints `/v1/profile` and `/v1/recommend` require `X-Service-Key`.
Matching TypeScript/Pydantic JSON examples live in `contracts/`.

- Each tactic uses its latest 20 known scam findings. Weakness is
  `(missed + 1) / (caught + missed + 2)`; zero evidence is shown as untested.
- False alarms on legitimate messages and missed-scam classification rates are
  separate. Unknown findings do not count. Fully unknown assessments do not
  affect score history or difficulty; abandoned attempts have no assessment.
- Difficulty begins at beginner. Five assessed scam attempts at the current
  level increase difficulty at a mean score of 80+, decrease it below 50, or keep
  it unchanged. A level change resets the window; unchanged levels use the latest
  five. Legitimate-message scores do not drive scam difficulty.
- Choose an enabled channel uniformly; draw a 70% scam / 30% legitimate mix.
  For scams, exploit the greatest weakness with at least three findings 70% of
  the time; otherwise explore the least-tested available tactic.
- Exclude the last three patterns when alternatives exist for the selected tactic
  and channel. Exact case-insensitive profession/interest tag matches receive
  twice the selection weight. Small catalogs can still repeat a pattern.
- Seeds and `rules-v1` recommendations are stored with attempts. Python recomputes
  the supplied profile from history and rejects stale/inconsistent input.

Profiles are derived from authoritative assessment history rather than stored in
an additional mutable cache. Analytics returns `finalizedCount` (all finalized
assessments) and `assessedCount` (those with known evidence). Rates without evidence
are null. Scores are raw rubric scores accompanied by difficulty and timestamps;
these baseline rules are game settings, not validated psychological measures.
Trained scikit-learn models and reference-corpus enrichment are later work.

## Validation and fixture demonstration

```sh
npm run typecheck
npm run build
npm test
```

Unit/contract tests run by default. Database integration tests require a separate
PostgreSQL database whose name ends in `_test` and a running Python service:

```sh
export TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/scam_training_test'
export TEST_PERSONALIZATION_URL='http://127.0.0.1:8000'
export PERSONALIZATION_SERVICE_KEY='the-same-secret-as-python'
npm test
```

Integration tests truncate tables only in that explicitly configured test database.
They cover ownership, duplicate processing, concurrency, hidden ground truth,
pause/resume, recovery, failed providers, and differing recommendations for two
players. Without both test URLs the integration suite is skipped.

Python tests, from `backend/personalization/`:

```sh
.venv/bin/python -m pytest -q
```

For an end-to-end fixture demonstration, point `.env` at a development/test database
and run `npm run demo` while Python is running. This creates two new fixture profiles
and three missed-tactic attempts for each, reads them back by identity, and prints
personalized recommendations plus analytics. It writes demonstration data and is
not an account-login UI or a Gemini integration. It needs no Gemini or voice key.

Unused auth/provider/messaging scaffold files remain team-owned placeholders.
No Twilio/Snowflake adapter is invoked. Team authentication, Gemini generation and
scoring, interactive voice, and the frontend gameplay coordinator remain the
integration work required for the complete product.

Framework references: [parameterized PostgreSQL queries](https://node-postgres.com/features/queries),
[TLS configuration](https://node-postgres.com/features/ssl), and
[FastAPI request validation](https://fastapi.tiangolo.com/tutorial/body/).
