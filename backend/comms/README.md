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

**Getting an ElevenLabs API key:**
1. Sign up or log in at [elevenlabs.io](https://elevenlabs.io). The free plan is enough for testing.
2. Open [Settings → API Keys](https://elevenlabs.io/app/settings/api-keys) and click **Create API Key**.
3. Name the key (e.g. `comms-dev`). Leaving **Restrict Key** off is simplest. If you turn it on, give the key **Write** access to **ElevenLabs Agents** (called **Conversational AI** on older dashboards). That access is needed to create and update the agent, issue call tokens, and read conversations. You can also set a credit limit so testing can't use up the account's credits.
4. Copy the key right away, because the dashboard only shows it once. It is server-only: keep it in `.env` (gitignored) and never put it in frontend code.

**Calls, one-time setup:**
1. Put `ELEVENLABS_API_KEY` in `.env`.
2. Run `npm run setup:agent`.
3. Paste the printed `ELEVENLABS_AGENT_ID` into `.env`.

Re-running `setup:agent` updates the existing agent. Then open **http://localhost:3001/comms/dev/call** (dev-only test page) to ring, talk and see the analyzed result.

**State:**
- Threads, calls and links are kept in memory and snapshotted to `data/store.json`, which survives restarts.
- Events are appended to `data/events.jsonl`.

Both files are gitignored.

## Auth

Browser requests carry the signed-in user's Firebase ID token:
- `Authorization: Bearer <token>` on every route except `/health`, `/scenarios`, `/l/:token` and `/dev/*`.
- The SSE stream takes it as `?access_token=<token>` instead, because `EventSource` can't send headers.

Comms takes the user id from the token (`getUserId` in `src/auth.ts`). **The token is decoded but its signature is not verified yet**, so any client can claim any uid. Swap in firebase-admin `verifyIdToken` there before real users.

- A missing (in production), expired or malformed token returns `401 { error: 'unauthorized', reason }`.
- Another user's thread or call returns `404`, so results pages only work for the signed-in owner.
- Outside production, a request with **no** token runs as `dev-user`, so the dev call page and the curl fixtures keep working.

## For Victor: frontend contract

Use the wiring in **`frontend/src/comms/`** rather than calling the routes by hand. In dev, Vite proxies `/comms` to `http://localhost:3001` (override with `COMMS_URL`).

| Module | Gives you |
|---|---|
| `api.ts` | `comms`: a typed client for every route below. It attaches the Firebase token and retries once with a fresh token on 401. |
| `useScenarios(channel?)` | Sample scenarios for a picker. |
| `useTextThread(threadId)` | A live text thread: messages, typing indicator, outcome, `send`, `report`, `reconnect`. |
| `useSimulatedCall()` | The call lifecycle (`start`, `accept`, `decline`, `hangUp`), live captions and the analyzed result. It must render inside `<ConversationProvider>` from `@elevenlabs/react`. |

```tsx
import { ConversationProvider } from '@elevenlabs/react'
import { comms } from './comms/api'

// Texts: start (or resume) a thread, then render it.
const { threadId, resumed } = await comms.startText({ scenarioId })   // {} picks a random sample
const thread = useTextThread(threadId)   // thread.messages, thread.typing, thread.send(text), thread.outcome

// Calls: render the provider once around the call screen, and keep it mounted for the whole call
// (unmounting it ends the session).
<ConversationProvider><CallScreen /></ConversationProvider>
function CallScreen() {
  const call = useSimulatedCall()   // call.phase: idle → starting → ringing → connecting → in_call → analyzing → completed
  // call.start({ scenarioId }), call.accept(), call.decline(), call.hangUp(), call.captions, call.outcome
}
```

Simulation ids are unguessable, so they're safe to put in results URLs.

### Texts

| Method & path | Body | Returns |
|---|---|---|
| `GET /comms/scenarios?channel=text\|call` | – | `{ scenarios: [{ id, channel, title, tactics, difficulty, label }] }`. No auth, and no prompt text. |
| `POST /comms/texts` | `{ scenarioId }`, `{ scenario }`, or `{}` for a random sample | `201 { threadId, streamUrl, thread }`. `409 { threadId }` if the user already has an active thread; `404 scenario_not_found` for an unknown id. |
| `GET /comms/texts/:id/stream?access_token=` | – | SSE stream (see below) |
| `POST /comms/texts/:id/replies` | `{ body }` | `202 { message }` (redacted copy of the user's message), or `409` if the thread ended |
| `POST /comms/texts/:id/report` | – | Thread, ended with outcome `reported` (wire this to a "Report / block" button) |
| `GET /comms/texts/:id` | – | Full `TextThread` for results pages |

SSE events:

- `message`: a `TextMessage` (`{ id, from: 'scammer' | 'user', body, at, links?, followUp? }`). History is replayed on connect. On reconnect, only messages after `Last-Event-ID` are sent. Dedupe by `id`.
- `typing`: `{ on: boolean }`. Show "…" while the scammer is "typing".
- `ended`: `{ outcome, reason }`. Close the `EventSource` when you get this.

**Links.** `body` contains the fake display URL (e.g. `postnorth-redelivery.info/pay`). `links: [{ text, href }]` tells you which text to make tappable and where it goes. `href` is our tracked redirect (`/comms/l/:token`). It records the tap and time-to-click, then redirects to `FRONTEND_BASE_URL + CAUGHT_PATH?sim=<threadId>`.

**To agree:** the "this was a simulation" page route. Currently `CAUGHT_PATH=/caught`.

### Calls

| Method & path | Body | Returns |
|---|---|---|
| `POST /comms/calls` | `{ scenarioId }`, `{ scenario }`, or `{}` for a random sample | `201 { callId, callerLabel, call }`. Start ringing. |
| `POST /comms/calls/:id/accept` | – | `{ conversationToken, conversationId, overrides }`. Returns `503` if ElevenLabs isn't configured. |
| `POST /comms/calls/:id/decline` | `{ reason: 'declined' \| 'missed' }` | Call record. Send `missed` when your ring timeout expires. |
| `POST /comms/calls/:id/ended` | `{ conversationId? }` | `202`. Analysis runs in the background. |
| `GET /comms/calls/:id` | – | Call record. Poll every ~2 s while `status === 'analyzing'`. |

`status` moves through `ringing` → `in_call` → `analyzing` → `completed`, or straight from `ringing` to `completed` if declined or missed. The `outcome` is set once the status is `completed`.

If you use `@elevenlabs/react` directly instead of `useSimulatedCall`, note two things:
- `useConversation` must be rendered inside `<ConversationProvider>`.
- `startSession({ conversationToken, connectionType: 'webrtc', overrides })` returns `void`, so failures arrive through `onError`, not a rejected promise.

`onDisconnect` also fires when the agent hangs up (its `end_call` tool) or the max duration is reached. See `src/dev/call.html` for a plain-JS example.

## For Sijing: scenario content and reply generation

- **Scenario shapes:** `TextScenario` and `CallScenario` in `src/types.ts` (zod-validated). Use `{{link}}` in text messages; comms swaps it for the fake display URL plus our tracked link.
- **Sample scenarios:** `fixtures/scenarios/text-*.json` and `call-*.json` (each shaped `{ userId, scenario }`) are loaded at startup and served by `GET /comms/scenarios`. Drop new samples there; an invalid file stops the server with the file name.
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
