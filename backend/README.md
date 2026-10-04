# Backend scaffold

This directory contains the planned backend structure only. Application files,
dependency manifests, and configuration placeholders are intentionally empty.
There is no runnable server or implemented provider integration yet.

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
templates to be committed. The example is currently empty; add variable names
and safe placeholder values as integrations are implemented.

Keep real credentials out of templates. Dependencies, build output, Python
virtual environments, caches, logs, and test coverage output are also ignored.

## Implementation order

1. Define shared models and request/response schemas.
2. Configure the API entry point and database layer.
3. Implement the Python personalization engine and TypeScript bridge.
4. Add campaign coordination and background processing.
5. Connect messaging and AI providers, then process their webhooks.
6. Add analytics and tests for the implemented flows.
