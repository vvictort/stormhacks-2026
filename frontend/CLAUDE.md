# Frontend notes

## Comms: simulated scam texts and calls

The contract between the frontend, the comms service and the backend is `docs/call-integration.md`. Code to it, and update it in the same change if something must differ. For comms routes in detail, see `backend/comms/README.md` and the JSDoc in `src/comms/`.

- Use `src/comms/`: the `comms` client (`api.ts`), `useScenarios`, `useTextThread` and `useSimulatedCall`. Don't call comms routes or open an `EventSource` yourself.
- Scenarios are server-owned: start calls with `comms.startCall(scenarioId)` and texts with `{ scenarioId }`. Never send a scenario object.
- Keep `src/comms/` framework-light and its pure parts (`client`, `callState`, `threadState`, `poll`) testable in Node.

## Phone calls

- `features/training/scenarios.ts` holds `CallScenario`: teaching metadata only (title, tactics, indicators, a caption-only practice script). The caller's script and voice live on comms. The ids must match the comms fixtures exactly.
- `/train/:id` for a call renders `CallRun` in `ScenarioPage`, which lazy-loads `features/training/call/CallExperience.tsx`. That chunk is the only place `@elevenlabs/react` (and LiveKit) is imported: never import `useSimulatedCall` or `@elevenlabs/react` from anything in the main bundle. Check with `npm run build`.
- `CallExperience` mounts `<ConversationProvider>` once per call run (keyed by scenario id), around `useSimulatedCall()`. The provider must not unmount mid-call.
- Results: components never decide success. Read it through `features/training/callOutcome.ts` (`readCallResult`), which takes comms' `training` field or the backend attempt and holds the contract table as a safety net.
- Screens: `call/callModel.ts` maps the hook state to a screen (`callScreen`), decides when to offer caption-only practice (`offersPractice`) and builds the debrief view model. Keep that logic there, pure and tested.
- When live voice is unavailable (`503 elevenlabs_not_configured`, comms unreachable, no microphone), the call stays playable in caption-only practice mode. Those results go to localStorage only.
- Live captions are never stored or shown after the call; the debrief uses the redacted transcript from the backend attempt (`GET /api/training/attempts/:callId`) or the comms record.
- Navigation: while a call is connecting or live, `lib/navigationGuard.ts` makes `TransitionLink`, `Brand` and Sign out ask first. Use `TransitionLink` (not a bare `Link`) for in-app links so they're guarded.

## Progress

`useProgress` merges local SMS/email results (localStorage) with call attempts from `GET /api/training/progress` (`mergeProgress` in `progress.ts`). If the API is down, local results still work.
