# comms

Simulated scam **texts** and **calls** for the training site. Nothing goes to a real phone:

- **Texts:** a fake messaging thread. The scammer's messages arrive over server-sent events (SSE), and the user replies through the API.
- **Calls:** the site shows a ringing phone. On accept, the browser talks live to an ElevenLabs agent (Gemini LLM) using `@elevenlabs/react`.

This is a self-contained Express + TypeScript service. All routes live under `/comms`, so it can be mounted into the main backend later.

## Run

```bash
cd backend/comms
npm install
cp .env.example .env      # texts work as-is; calls need the ElevenLabs keys
npm run dev               # http://localhost:3001/comms
npm run typecheck
```

**Calls, one-time setup:**
1. Put `ELEVENLABS_API_KEY` in `.env`.
2. Run `npm run setup:agent`.
3. Paste the printed `ELEVENLABS_AGENT_ID` into `.env`.

Re-running `setup:agent` updates the existing agent. Then open **http://localhost:3001/comms/dev/call** (dev-only test page) to ring, talk and see the analyzed result.

**State:**
- Threads, calls and links are kept in memory and snapshotted to `data/store.json`, which survives restarts.
- Events are appended to `data/events.jsonl`.

Both files are gitignored.

## For Victor: frontend contract

Every simulation is started by the caller, who passes in the scenario. Example request bodies are in `fixtures/scenarios/*.json`. Simulation ids are unguessable, so they're safe to put in results URLs.

The paths below are relative. From the Vite dev server you can either:
- add a proxy for `/comms` → `http://localhost:3001` in `vite.config.ts`, or
- call `http://localhost:3001/comms/...` directly (CORS allows `FRONTEND_BASE_URL`).

### Texts

| Method & path | Body | Returns |
|---|---|---|
| `POST /comms/texts` | `{ userId, scenario: TextScenario }` | `201 { threadId, streamUrl, thread }`, or `409 { threadId }` if the user already has an active thread |
| `GET /comms/texts/:id/stream` | – | SSE stream (see below) |
| `POST /comms/texts/:id/replies` | `{ body }` | `202 { message }` (redacted copy of the user's message), or `409` if the thread ended |
| `POST /comms/texts/:id/report` | – | Thread, ended with outcome `reported` (wire this to a "Report / block" button) |
| `GET /comms/texts/:id` | – | Full `TextThread` for results pages |

SSE events (`new EventSource(streamUrl)`):

- `message`: a `TextMessage` (`{ id, from: 'scammer' | 'user', body, at, links?, followUp? }`). History is replayed on connect. On reconnect, only messages after `Last-Event-ID` are sent. Dedupe by `id`.
- `typing`: `{ on: boolean }`. Show "…" while the scammer is "typing".
- `ended`: `{ outcome, reason }`. Close the `EventSource` when you get this.

**Links.** `body` contains the fake display URL (e.g. `postnorth-redelivery.info/pay`). `links: [{ text, href }]` tells you which text to make tappable and where it goes. `href` is our tracked redirect (`/comms/l/:token`). It records the tap and time-to-click, then redirects to `FRONTEND_BASE_URL + CAUGHT_PATH?sim=<threadId>`.

**To agree:** the "this was a simulation" page route. Currently `CAUGHT_PATH=/caught`.

### Calls

| Method & path | Body | Returns |
|---|---|---|
| `POST /comms/calls` | `{ userId, scenario: CallScenario }` | `201 { callId, callerLabel, call }`. Start ringing. |
| `POST /comms/calls/:id/accept` | – | `{ conversationToken, conversationId, overrides }`. Returns `503` if ElevenLabs isn't configured. |
| `POST /comms/calls/:id/decline` | `{ reason: 'declined' \| 'missed' }` | Call record. Send `missed` when your ring timeout expires. |
| `POST /comms/calls/:id/ended` | `{ conversationId? }` | `202`. Analysis runs in the background. |
| `GET /comms/calls/:id` | – | Call record. Poll every ~2 s while `status === 'analyzing'`. |

`status` moves through `ringing` → `in_call` → `analyzing` → `completed`, or straight from `ringing` to `completed` if declined or missed. The `outcome` is set once the status is `completed`.

```tsx
import { useConversation } from '@elevenlabs/react';

const conversation = useConversation({
  onMessage: ({ role, message }) => { /* live captions */ },
  onDisconnect: () => fetch(`/comms/calls/${callId}/ended`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ conversationId: conversation.getId() }),
  }),
});

// On "Accept":
const { conversationToken, overrides } = await (await fetch(`/comms/calls/${callId}/accept`, { method: 'POST' })).json();
await conversation.startSession({ conversationToken, connectionType: 'webrtc', overrides });
```

`onDisconnect` also fires when the agent hangs up (its `end_call` tool) or the max duration is reached. See `src/dev/call.html` for a complete working example.

## For Sijing: scenario content and reply generation

- **Scenario shapes:** `TextScenario` and `CallScenario` in `src/types.ts` (zod-validated). Use `{{link}}` in text messages; comms swaps it for the fake display URL plus our tracked link.
- **Text replies:** implement `ScenarioProvider` in `src/provider.ts`:
  - `nextTextTurn({ scenario, messages, preSignals })` → `{ reply, signals, done }`
  - `followUp(...)` → a nudge, or `null`

  The `StubProvider` is used until yours is ready; swap it in `src/server.ts`. User messages arrive **already redacted** (`[NUMBER:6 digits]`, `[EMAIL]`). `preSignals` are rule-based hints. The signals you return are authoritative and decide the thread's outcome.
- **Calls:** the scenario's `systemPrompt` and `firstMessage` override the ElevenLabs agent per call. `src/calls/preamble.ts` is prepended to every prompt; please review the wording.
- **Scoring:** comms only sets a preliminary `outcome`. Use the events below, including the full redacted transcript in `call.analyzed`, for real scoring and feedback.

## For Kelvin: events

`EventSink` (`src/events.ts`) receives every event. Today it writes JSONL; swap in a TigerData sink in `src/server.ts`. Envelope:

```ts
{ id, type, at, userId, simulationId, channel: 'text' | 'call', scenarioId, tactics, data }
```

| type | `data` |
|---|---|
| `text.thread_started` | `senderLabel, difficulty` |
| `text.message_sent` / `text.follow_up_sent` | `messageId, body, hasLink, turn` |
| `text.reply_received` | `messageId, body` (redacted), `latencyMs` (since last scammer message), `preSignals` |
| `text.reply_classified` | `messageIds, preSignals, signals, done` |
| `link.clicked` | `timeToClickMs, afterEnd` |
| `text.reported` | – |
| `text.thread_ended` | `outcome, reason, signals, scammerTurns, userReplies, durationMs` |
| `call.ringing` | `callerLabel, difficulty` |
| `call.accepted` / `call.declined` / `call.missed` | `ringMs` |
| `call.ended` | `conversationId` |
| `call.analyzed` | `outcome, signals, resisted, durationSecs, terminationReason, dataCollection, summary, transcript` |
| `call.failed` | `error` |

**Signals:** `clicked_link`, `shared_code`, `shared_personal_info`, `shared_payment_info`, `agreed_to_action` (these five count as compromised), plus `engaged`, `challenged`, `asked_to_verify`, `reported`, `stop`.

**Outcomes:** `compromised`, `resisted`, `reported`, `ignored`, `declined`, `missed`, `error`.
