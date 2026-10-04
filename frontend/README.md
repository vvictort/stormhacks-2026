# Tellio frontend

React/TypeScript/Tailwind frontend with Firebase authentication, TigerData-backed onboarding, and the existing text-message practice experience.

## Run

```sh
npm install
cp .env.example .env
# Fill in your existing Firebase web-app configuration.
npm run dev
```

Start the backend separately from `backend/` after configuring its `.env` and running `npm run migrate`. Vite uses port 5173 and proxies `/api` to `127.0.0.1:3000`. Open **http://localhost:5173**; localhost is authorized in the existing Firebase project. The strict development port keeps the backend's `APP_ORIGIN` consistent.

## Flow

- `/signup` and `/login` use Firebase for credentials and authentication sessions. Existing Google login and password-reset functionality remains available.
- After authentication, the backend persists the account UID, email and verification status in TigerData.
- Incomplete profiles are directed to `/onboarding` before accessing home or messaging scenarios.
- Onboarding requires name and an international phone number. Account email is displayed read-only; profession and interests are optional.
- Saving opens the existing `/home` training page. Its profile summary links back to edit onboarding details.
- `/train/:scenarioId` retains the current messaging simulator and debrief.
- Profile data survives refresh, sign-out/login and browser changes. Messaging practice progress still uses browser-local storage; this milestone does not persist training results.

The profile provider clears displayed data when account identities differ and ignores responses from cancelled loads. While the profile is loading, protected routes show a loader. Failed profile loads show retry/sign-out controls; failed saves keep all form input. Firebase remains the sole authentication provider: application code never stores passwords or copies Firebase tokens into TigerData.

## Configuration

`src/lib/firebase.ts` reads the public `VITE_FIREBASE_*` settings. The backend's `FIREBASE_PROJECT_ID` must match that project. Firebase Email/Password must be enabled; retain the existing Google provider configuration if using Google login. No Firebase service-account private key is needed for the backend's token-verification-only use.

Production should expose frontend and `/api` under the same HTTPS origin and rewrite app navigation routes to `index.html`. Set backend `APP_ORIGIN` to that origin. See `backend/README.md` for TigerData connection and certificate setup.

## Validation

```sh
npm test
npm run lint
npm run build
```

Tests cover authentication validation/redirects, onboarding validation and existing messaging behavior. Backend tests cover profile ownership, persistence and safe failures. The frontend's gRPC transitive dependency is pinned to a compatible patched release; Firebase's browser auth code is otherwise unchanged.
