# Tellio profile backend

Firebase handles signup, login, password resets and authentication sessions. Express verifies Firebase ID tokens. TigerData stores personal profiles, keyed by the verified Firebase UID. No passwords or authentication tokens are stored in TigerData.

This milestone covers profiles and onboarding only. The existing messaging frontend remains intact, including its browser-local practice progress. Python, Snowflake, Twilio and Gemini are outside this milestone.

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

Migrations are transactional, serialized, and recorded in `schema_migrations`. The new `user_profiles` table requires no old-data migration. Migration commands are repeatable and do not drop existing tables. Run migrations explicitly before serving traffic; API startup does not modify the schema.

## API

Every profile request requires `Authorization: Bearer <Firebase ID token>`.

| Method | Path | Behavior |
| --- | --- | --- |
| GET | `/api/health` | Process liveness |
| GET | `/api/users/me` | Persist/update Firebase identity details and return the caller's profile |
| PUT | `/api/users/me` | Save personal details and complete onboarding |

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

The suite truncates only `user_profiles` in that test database. Test Firebase verifiers are injected directly into the test app; production has no mock-auth mode. Tests cover isolation, idempotent onboarding, identity synchronization, invalid input, persistence across reconstructed servers, safe failures and origin enforcement.
