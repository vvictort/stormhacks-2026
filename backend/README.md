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

## Directory responsibilities

| Path | Planned responsibility |
| --- | --- |
| `app/main.ts` | TypeScript API entry point |
| `app/api/` | Authentication, users, campaigns, messages, analytics, and webhook routes |
| `app/core/` | Configuration, security, and shared error handling |
| `app/models/` | User, campaign, attempt, message, and event records |
| `app/schemas/` | Request/response validation and personalization contracts |
| `app/db/` | Database connection, repositories, and migrations |
| `app/services/` | Simulation coordination, personalization, AI, SMS, and voice logic |
| `app/integrations/` | Gemini, Twilio, ElevenLabs, TigerData, and Snowflake adapters |
| `app/workers/` | Background campaign processing |
| `personalization/main.py` | Python personalization service entry point |
| `personalization/features.py` | Summaries derived from participant history |
| `personalization/engine.py` | Rules for choosing scenario and difficulty |
| `personalization/requirements.txt` | Future Python dependencies |
| `tests/api/` | API tests |
| `tests/services/` | Service tests |
| `personalization/tests/` | Personalization tests |

## Environment files

Use `backend/.env` for local environment values. The root `.gitignore` excludes
environment files throughout the repository while allowing `.env.example`
templates to be committed. Add variable names and safe placeholder values to the
example as integrations are implemented.

Keep real credentials out of templates. Dependencies, build output, Python
virtual environments, caches, logs, and test coverage output are also ignored.

## Implementation order

1. Define shared models and request/response schemas.
2. Configure the API entry point and database layer.
3. Implement the Python personalization engine and TypeScript bridge.
4. Add campaign coordination and background processing.
5. Connect messaging and AI providers, then process their webhooks.
6. Add analytics and tests for the implemented flows.
