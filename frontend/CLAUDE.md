# Frontend notes

## Comms: simulated scam texts and calls

The contract between the frontend and the backend is `docs/call-integration.md`. Code to it, and update it in the same change if something must differ. The simulated text and call routes live on the backend under `/api/comms`; for them in detail, see `backend/README.md` and the JSDoc in `src/comms/`.

- Use `src/comms/`: the `comms` client (`api.ts`), `useScenarios`, `useTextThread` and `useSimulatedCall`. Don't call `/api/comms` routes or open an `EventSource` yourself. The client sends JSON on every POST (the API's write guard requires it) and reads errors as `{ error: { code } }`.
- Scenarios are server-owned: start calls with `comms.startCall(scenarioId)` and texts with `{ scenarioId }`. Never send a scenario object.
- Keep `src/comms/` framework-light and its pure parts (`client`, `callState`, `threadState`, `poll`) testable in Node.

## Phone calls

- `features/training/scenarios.ts` holds `CallScenario`: teaching metadata only (title, tactics, indicators, a caption-only practice script). The caller's script and voice live on the backend. The ids must match `backend/fixtures/scenarios/call-*.json` exactly.
- Route pages are lazy chunks (`lib/lazyPage.ts`, wired in `App.tsx`): the page on screen loads first, the rest preload right after the first render, and `TransitionLink` waits for them so a View Transition never animates to the loading fallback. Vendor chunks (react, firebase, livekit, elevenlabs, icons) are set in `vite.config.ts`.
- `/train/:id` for a call renders `CallRun` in `ScenarioPage`, which lazy-loads `features/training/call/CallExperience.tsx`. That chunk is the only place `@elevenlabs/react` (and LiveKit) is imported: never import `useSimulatedCall` or `@elevenlabs/react` from anything in the main bundle. Check with `npm run build`.
- `CallExperience` mounts `<ConversationProvider>` once per call run (keyed by scenario id), around `useSimulatedCall()`. The provider must not unmount mid-call.
- Results: components never decide success. Read it through `features/training/callOutcome.ts` (`readCallResult`), which takes the call record's `training` field or the backend attempt and holds the contract table as a safety net.
- Screens: `call/callModel.ts` maps the hook state to a screen (`callScreen`), decides when to offer caption-only practice (`offersPractice`) and builds the debrief view model. Keep that logic there, pure and tested.
- When live voice is unavailable (`503 elevenlabs_not_configured`, the backend unreachable, no microphone), the call stays playable in caption-only practice mode. Those results go to localStorage only. Dropping a call that still rings on the server (practice mode, leaving the page, a new call) abandons it (`comms.abandonCall`, done inside `useSimulatedCall`), so the backend never turns it into a scored "missed" attempt.
- Live captions are never stored or shown after the call; the debrief uses the redacted transcript from the backend attempt (`GET /api/training/attempts/:callId`) or the call record.
- Stuck connecting: the connecting screen has a Cancel button, and `useSimulatedCall({ connectTimeoutMs = 20_000 })` gives up by itself (timer starts after the microphone check). Both go through `connectDrop` (`callState.ts`): abandon before the accept lands, `/ended` after it; the phone then shows `not_connected`, which offers caption practice.
- Navigation: while a call is connecting or live, `lib/navigationGuard.ts` makes `TransitionLink`, `Brand` and Sign out ask first. Use `TransitionLink` (not a bare `Link`) for in-app links so they're guarded.

## Progress

`useProgress` merges local SMS/email results (localStorage) with call attempts from `GET /api/training/progress` (`mergeProgress` in `progress.ts`). If the API is down, local results still work.
