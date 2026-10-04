# Frontend notes

## Comms: simulated scam texts and calls

Before building any screen that starts or shows a simulated text thread or phone call, read the wiring guide:
https://claude.ai/code/artifact/a7bbfe38-8a0c-4eef-aa9f-0fb340c3fcbf. It's a Claude Doc, so read it with the Claude Docs tools, not a web fetch. If you can't open it, the same contract is in `backend/comms/README.md` and the JSDoc in `src/comms/`.

- Use `src/comms/`: the `comms` client (`api.ts`), `useScenarios`, `useTextThread` and `useSimulatedCall`. Don't call comms routes or open an `EventSource` yourself.
- `useSimulatedCall` must render inside `<ConversationProvider>` from `@elevenlabs/react`, and that provider must stay mounted for the whole call.
- Don't change `src/comms/` or `backend/comms/` without checking with Eric.
