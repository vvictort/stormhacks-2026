# Tellio frontend

React/TypeScript/Tailwind frontend with Firebase authentication, TigerData-backed onboarding, and the existing text-message practice experience.

## Run

```sh
npm install
cp .env.example .env
# Fill in your existing Firebase web-app configuration.
npm run dev
```

Start the backend separately from `backend/` after configuring its `.env` and running `npm run migrate`. Vite uses port 5173 and proxies `/api` to `localhost:3000`; that one server also serves the simulated texts and calls (`/api/comms`, including SSE). Open **http://localhost:5173**; localhost is authorized in the existing Firebase project. The strict development port keeps the backend's `APP_ORIGIN` consistent.

## Flow

- `/signup` and `/login` use Firebase for credentials and authentication sessions. Existing Google login and password-reset functionality remains available.
- After authentication, the backend persists the account UID, email and verification status in TigerData.
- Incomplete profiles are directed to `/onboarding` before accessing home or messaging scenarios.
- Onboarding requires name and an international phone number. Account email is displayed read-only; profession and interests are optional.
- Saving opens the existing `/home` training page. Its profile summary links back to edit onboarding details.
- `/train/:scenarioId` retains the current messaging simulator and debrief. Phone-call scenarios open a call screen on the practice phone instead (see below).
- `/caught?sim=<threadId>` is a public page that tracked practice links redirect to. It explains the simulated link and the red flags to check.
- Profile data survives refresh, sign-out/login and browser changes. Messaging practice progress still uses browser-local storage; this milestone does not persist training results.

The profile provider clears displayed data when account identities differ and ignores responses from cancelled loads. While the profile is loading, protected routes show a loader. Failed profile loads show retry/sign-out controls; failed saves keep all form input. Firebase remains the sole authentication provider: application code never stores passwords or copies Firebase tokens into TigerData.

## Phone calls

Call scenarios ring on the practice phone. Answering asks for the microphone and starts an ElevenLabs voice session through the backend; captions show what the caller says, and after hanging up the backend analyses the call and saves the attempt. The debrief prefers the saved attempt and falls back to the call record, and only ever shows the redacted transcript.

- Microphone access needs a secure context: `https://` or `localhost`. Over plain HTTP on a LAN address, calls explain why they can't connect.
- Without ElevenLabs keys on the backend (`503 elevenlabs_not_configured`), or when the backend is unreachable, the call shows that live voice is unavailable and offers a caption-only practice mode. Its results are saved in this browser only.
- The voice SDK is lazy-loaded with the call screen, so it never weighs on the rest of the app.
- Live-call progress comes from `GET /api/training/progress`; text and email progress stays in localStorage.

## Configuration

`src/lib/firebase.ts` reads the public `VITE_FIREBASE_*` settings. `VITE_COMMS_BASE_URL` (optional) sets where the browser calls the simulated text and call routes; it defaults to `/api/comms`, served through the same `/api` proxy. The backend's `FIREBASE_PROJECT_ID` must match that project. Firebase Email/Password must be enabled; retain the existing Google provider configuration if using Google login. No Firebase service-account private key is needed for the backend's token-verification-only use.

Production should expose frontend and `/api` under the same HTTPS origin and rewrite app navigation routes to `index.html`. Set backend `APP_ORIGIN` to that origin. See `backend/README.md` for TigerData connection and certificate setup.

## Validation

```sh
npm test
npm run lint
npm run build
```

Tests cover authentication validation/redirects, onboarding validation, messaging behavior, and the call logic (screen states, canonical outcomes, the navigation guard, the debrief view model and progress merging). Backend tests cover profile ownership, persistence and safe failures. The frontend's gRPC transitive dependency is pinned to a compatible patched release; Firebase's browser auth code is otherwise unchanged.
