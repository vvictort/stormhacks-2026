# Tellio profile backend

Firebase handles signup, login, password resets and authentication sessions. Express verifies Firebase ID tokens. TigerData stores personal profiles, keyed by the verified Firebase UID. No passwords or authentication tokens are stored in TigerData.

It also stores phone-call training attempts posted by the comms service, computes call progress and the vulnerability profile server-side, and generates call scenarios (Gemini, or built-in ones without a key). SMS/email practice progress stays browser-local. The shared contract is [`docs/call-integration.md`](../docs/call-integration.md).

## Setup

Requires Node.js 22.18+ and a TigerData/PostgreSQL database. Run commands from `backend/`:

```sh
npm install
cp .env.example .env
# Fill in DATABASE_URL and FIREBASE_PROJECT_ID.
npm run migrate
npm run dev
```

Use the same Firebase project as the frontend. The Admin SDK verifies client ID tokens using the configured project and Google's public signing keys; this backend performs no Firebase account administration.

The API listens on `127.0.0.1:3000`. `APP_ORIGIN` must match the frontend origin exactly (default `http://localhost:5173`). The frontend proxies `/api` to the backend. Production should expose both behind the same HTTPS origin; configure `APP_ORIGIN` accordingly.

TigerData TLS keeps certificate and hostname verification enabled. For a custom service CA, place the certificate bundle outside tracked source and add its absolute path as `sslrootcert` in `DATABASE_URL`. Local `.certs/` and `.env` are ignored. See [TigerData's strict SSL procedure](https://www.tigerdata.com/docs/use-timescale/latest/security/strict-ssl/). Database passwords containing special characters must be URL-encoded.

Migrations in `app/db/migrations` are transactional, serialized, and recorded in `schema_migrations`; `npm run migrate` applies any that are new. `001` creates `user_profiles`; `002` creates `training_attempts` (id = comms attempt id, so re-posts are no-ops; canonical channel/difficulty/outcome enforced by CHECKs; `metadata` holds only the redacted summary and transcript) and `generated_call_scenarios` (`gen-…` ids, the comms `CallScenario` JSON, `source` = `gemini` or `fallback`). Migration commands are repeatable and do not drop existing tables. Run migrations explicitly before serving traffic; API startup does not modify the schema.

## Structure

Organised by feature. Each feature owns its routes, schema, repository and logic; shared concerns live beside them.

```
app/
  main.ts               composition root: config → db pool → repositories → app → listen
  server.ts             HTTP assembly: shared middleware, then each feature's router
  config.ts             env schema (zod)
  repositories.ts       builds every feature's repository from one pool
  shared/vocabulary.ts  canonical channel, difficulty, outcome and tactic (docs/call-integration.md)
  http/                 errors, Firebase auth, internal-token auth, app-origin guard, rate limit
  db/                   pool, migrate, migrations/*.sql
  users/                onboarding profile: routes, repository, schema
  training/             attempts and progress: browser routes, internal route, repository, schema, progress (pure)
  scenarios/            generated call scenarios: routes, repository, call-scenario schema, generator (Gemini)
```

Dependency rules:

- Features depend on `shared/`, `http/` and `db/`, never the reverse. `server.ts` and `main.ts` are the only places that know every feature.
- The one feature-to-feature link is `scenarios → training/progress` (difficulty and weak categories personalise a scenario).
- Repositories are the only modules that run SQL. Routes get their repositories injected (`createApp({ repos })`), so tests use in-memory fakes.
- The API never imports comms code. It keeps its own copy of the call-scenario contract, and `tests/call-scenario.test.ts` fails if it drifts from comms.

## API

Every profile and training request requires `Authorization: Bearer <Firebase ID token>`; the uid always comes from the verified token.

| Method | Path | Behavior |
| --- | --- | --- |
| GET | `/api/health` | Process liveness |
| GET | `/api/users/me` | Persist/update Firebase identity details and return the caller's profile |
| PUT | `/api/users/me` | Save personal details and complete onboarding |
| GET | `/api/training/progress` | `{ attempts, stats, vulnerability }`: newest 50 attempts plus stats over the whole history |
| GET | `/api/training/attempts/:id` | One attempt with signals, summary and redacted transcript; 404 unless it is the caller's |
| POST | `/api/training/call-scenarios` | Generate and store a scenario; `201 { scenarioId, title, callerLabel, difficulty, tactics, source }`. Send `{}` as JSON with the app Origin. 5/min and 30/day per user, else `429 RATE_LIMITED` |

Progress `stats` are `{ total, successes, compromised }` over scored attempts (`error` attempts are listed but not counted). `vulnerability` is `{ weakCategories, vulnerableTactics, categoryAccuracy }`: categories are inferred from the scenario id/title, a category turns weak below 75% accuracy and recovers at 80%, and tactics are ranked by how often they appeared in compromised attempts. The same replay sets the difficulty used for generated scenarios.

### Internal routes (comms → backend)

Mounted at `/api/internal/*` before the browser Origin/JSON checks, with a 256kb JSON limit. Requests need `X-Internal-Token: <INTERNAL_API_TOKEN>` (timing-safe comparison). If `INTERNAL_API_TOKEN` is unset every internal route is 404; a missing or wrong token is 401 `INVALID_INTERNAL_TOKEN`. Never expose this prefix or the token to browsers.

| Method | Path | Behavior |
| --- | --- | --- |
| POST | `/api/internal/training-attempts` | Contract payload; `201 { id }`, or `200 { id, duplicate: true }` for a repeated `attemptId` |
| GET | `/api/internal/call-scenarios/:id?uid=` | The stored `CallScenario` (numeric difficulty) if `uid` owns it, else 404 |

### Environment

`DATABASE_URL`, `FIREBASE_PROJECT_ID`, `HOST`, `PORT`, `APP_ORIGIN`, `NODE_ENV`, plus optional `INTERNAL_API_TOKEN` (≥ 32 chars, same value in comms) and `GEMINI_API_KEY` (unset or failing Gemini uses built-in scenarios and reports `source: "fallback"`). All are read from `backend/.env` by `app/config.ts`.

GET creates an incomplete profile on first sign-in. Its returned fields are `id`, `uid`, `email`, `emailVerified`, `name`, `phone`, `profession`, `interests`, `onboardingComplete`, `createdAt`, and `updatedAt`. Email and verification status follow Firebase; subsequent logins preserve the user's saved personal name and preferences.

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

Browser writes require JSON and the configured Origin. Errors have `{ "error": { "code", "message" } }`; validation adds field names. Invalid sessions return 401. Provider/network/database failures return retryable 503 without raw credential or database details.

## Tests

```sh
npm run typecheck
npm test
```

Unit tests run without a database. Integration tests require a dedicated database with a name ending in `_test`:

```sh
TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/tellio_test' npm test
```

The suites truncate only `user_profiles`, `training_attempts` and `generated_call_scenarios` in that test database, and test files run serially. Training route tests also run without a database against an in-memory repository. Test Firebase verifiers are injected directly into the test app; production has no mock-auth mode. Tests cover internal-route auth, idempotent attempt posts, owner-only reads, progress/vulnerability updates, scenario fallback and rate limits, plus isolation, idempotent onboarding, identity synchronization, invalid input, persistence across reconstructed servers, safe failures and origin enforcement.
