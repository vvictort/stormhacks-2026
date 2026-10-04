import assert from 'node:assert/strict'
import test from 'node:test'
import { initialThreadState, parseThreadEvent, threadReducer, threadStatus } from '../src/comms/threadState.ts'
import { callReducer, INITIAL_CALL_STATE } from '../src/comms/callState.ts'
import { CommsError, createCommsClient, describeError } from '../src/comms/client.ts'

const T = 'thread-1'
const msg = (id, at, from = 'scammer', body = `body ${id}`) => ({ id, from, body, at: `2026-10-03T10:00:${at}.000Z` })
const thread = (overrides = {}) => ({
  id: T, userId: 'u1', status: 'active', messages: [], signals: [], scammerTurns: 0, userMessagesHandled: 0,
  createdAt: '2026-10-03T10:00:00.000Z', ...overrides,
})
const reduce = (actions, state = initialThreadState(T)) => actions.reduce(threadReducer, state)

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
}

// --- Thread reducer ---

test('messages are deduped by id across the stream and snapshots', () => {
  const state = reduce([
    { type: 'message', threadId: T, message: msg('a', '01') },
    { type: 'message', threadId: T, message: msg('a', '01') },
    { type: 'snapshot', threadId: T, thread: thread({ messages: [msg('a', '01'), msg('b', '02', 'user')] }) },
    { type: 'message', threadId: T, message: msg('b', '02', 'user') },
  ])
  assert.deepEqual(state.messages.map((m) => m.id), ['a', 'b'])
})

test('a duplicate message returns the same state object', () => {
  const state = reduce([{ type: 'message', threadId: T, message: msg('a', '01') }])
  assert.equal(threadReducer(state, { type: 'message', threadId: T, message: msg('a', '01') }), state)
})

test('late arrivals are kept in chronological order', () => {
  const state = reduce([
    { type: 'message', threadId: T, message: msg('c', '03') },
    { type: 'message', threadId: T, message: msg('a', '01') },
    { type: 'snapshot', threadId: T, thread: thread({ messages: [msg('b', '02', 'user'), msg('d', '04')] }) },
  ])
  assert.deepEqual(state.messages.map((m) => m.id), ['a', 'b', 'c', 'd'])
})

test('typing is cleared by a scammer message and by ended, and ignored after ended', () => {
  let state = reduce([{ type: 'typing', threadId: T, on: true }])
  assert.equal(state.typing, true)
  state = threadReducer(state, { type: 'message', threadId: T, message: msg('u', '01', 'user') })
  assert.equal(state.typing, true, 'user messages leave typing alone')
  state = threadReducer(state, { type: 'message', threadId: T, message: msg('s', '02') })
  assert.equal(state.typing, false)

  state = reduce([
    { type: 'typing', threadId: T, on: true },
    { type: 'ended', threadId: T, outcome: 'resisted', reason: 'max_turns' },
  ], state)
  assert.equal(state.typing, false)
  assert.equal(threadReducer(state, { type: 'typing', threadId: T, on: true }), state)
})

test('an ended snapshot sets outcome, reason and status ended', () => {
  const state = reduce([
    { type: 'connection', threadId: T, connection: 'open' },
    { type: 'typing', threadId: T, on: true },
    { type: 'snapshot', threadId: T, thread: thread({ status: 'ended', outcome: 'reported', endReason: 'reported', messages: [msg('a', '01')] }) },
  ])
  assert.equal(state.outcome, 'reported')
  assert.equal(state.endReason, 'reported')
  assert.equal(state.typing, false)
  assert.equal(threadStatus(state), 'ended')
  assert.equal(threadReducer(state, { type: 'connection', threadId: T, connection: 'reconnecting' }), state)
})

test('an active snapshot does not end the thread', () => {
  const state = reduce([{ type: 'snapshot', threadId: T, thread: thread({ messages: [msg('a', '01')] }) }])
  assert.equal(state.outcome, null)
  assert.equal(state.messages.length, 1)
})

test('an action for another thread starts from fresh state', () => {
  const old = reduce([
    { type: 'message', threadId: T, message: msg('a', '01') },
    { type: 'ended', threadId: T, outcome: 'compromised', reason: 'link_clicked' },
    { type: 'send', threadId: T, phase: 'start' },
  ])
  const state = threadReducer(old, { type: 'message', threadId: 'thread-2', message: msg('x', '05') })
  assert.equal(state.threadId, 'thread-2')
  assert.deepEqual(state.messages.map((m) => m.id), ['x'])
  assert.equal(state.outcome, null)
  assert.equal(state.pendingSends, 0)
})

test('pendingSends never goes negative', () => {
  const state = reduce([
    { type: 'send', threadId: T, phase: 'done' },
    { type: 'send', threadId: T, phase: 'start' },
    { type: 'send', threadId: T, phase: 'start' },
    { type: 'send', threadId: T, phase: 'done' },
    { type: 'send', threadId: T, phase: 'done' },
    { type: 'send', threadId: T, phase: 'done' },
  ])
  assert.equal(state.pendingSends, 0)
})

test('connection open clears transient errors; fatal errors set connection error', () => {
  let state = reduce([{ type: 'error', threadId: T, error: 'network_error', fatal: false }])
  assert.equal(state.connection, 'connecting')
  assert.equal(state.error, 'network_error')
  state = threadReducer(state, { type: 'connection', threadId: T, connection: 'open' })
  assert.equal(state.error, null)
  state = threadReducer(state, { type: 'error', threadId: T, error: 'not_found', fatal: true })
  assert.equal(state.connection, 'error')
})

test('the thread reducer never mutates prior state', () => {
  const prior = deepFreeze(reduce([
    { type: 'message', threadId: T, message: msg('b', '02') },
    { type: 'typing', threadId: T, on: true },
    { type: 'send', threadId: T, phase: 'start' },
  ]))
  const snapshot = structuredClone(prior)
  const actions = [
    { type: 'connection', threadId: T, connection: 'open' },
    { type: 'message', threadId: T, message: msg('a', '01') },
    { type: 'typing', threadId: T, on: false },
    { type: 'snapshot', threadId: T, thread: thread({ status: 'ended', outcome: 'resisted', endReason: 'idle', messages: [msg('c', '03')] }) },
    { type: 'ended', threadId: T, outcome: 'resisted', reason: 'idle' },
    { type: 'send', threadId: T, phase: 'done' },
    { type: 'error', threadId: T, error: 'x', fatal: true },
    { type: 'message', threadId: 'other', message: msg('z', '09') },
  ]
  for (const action of actions) threadReducer(prior, deepFreeze(action))
  assert.deepEqual(prior, snapshot)
})

test('parseThreadEvent maps valid SSE frames', () => {
  const message = msg('a', '01')
  assert.deepEqual(parseThreadEvent('message', JSON.stringify(message), T), { type: 'message', threadId: T, message })
  assert.deepEqual(parseThreadEvent('typing', '{"on":true}', T), { type: 'typing', threadId: T, on: true })
  assert.deepEqual(parseThreadEvent('ended', '{"outcome":"resisted","reason":"max_turns"}', T),
    { type: 'ended', threadId: T, outcome: 'resisted', reason: 'max_turns' })
  assert.deepEqual(parseThreadEvent('ended', '{"outcome":"error"}', T),
    { type: 'ended', threadId: T, outcome: 'error', reason: null })
})

test('parseThreadEvent rejects malformed and unknown frames', () => {
  assert.equal(parseThreadEvent('message', 'nope', T), null)
  assert.equal(parseThreadEvent('message', '{"id":1}', T), null)
  assert.equal(parseThreadEvent('message', JSON.stringify({ ...msg('a', '01'), from: 'bot' }), T), null)
  assert.equal(parseThreadEvent('message', 'null', T), null)
  assert.equal(parseThreadEvent('typing', '{}', T), null)
  assert.equal(parseThreadEvent('typing', '{"on":"yes"}', T), null)
  assert.equal(parseThreadEvent('ended', '{}', T), null)
  assert.equal(parseThreadEvent('ended', '{"outcome":"resisted","reason":3}', T), null)
  assert.equal(parseThreadEvent('ping', '{"on":true}', T), null)
})

test('threadStatus covers idle, connecting, live, reconnecting, ended and error', () => {
  assert.equal(threadStatus(initialThreadState(null)), 'idle')
  assert.equal(threadStatus(initialThreadState(T)), 'connecting')
  const live = reduce([{ type: 'connection', threadId: T, connection: 'open' }])
  assert.equal(threadStatus(live), 'live')
  assert.equal(threadStatus(threadReducer(live, { type: 'connection', threadId: T, connection: 'reconnecting' })), 'reconnecting')
  assert.equal(threadStatus(threadReducer(live, { type: 'ended', threadId: T, outcome: 'ignored', reason: 'idle' })), 'ended')
  assert.equal(threadStatus(threadReducer(live, { type: 'error', threadId: T, error: 'not_found', fatal: true })), 'error')
})

// --- Call reducer ---

const callRecord = (status, extra = {}) => ({ id: 'call-1', userId: 'u1', status, signals: [], createdAt: '2026-10-03T10:00:00.000Z', ...extra })
const ringing = callReducer(callReducer(INITIAL_CALL_STATE, { type: 'start' }),
  { type: 'ringing', callId: 'call-1', callerLabel: 'Bank', record: callRecord('ringing') })

test('call actions with a stale callId are ignored', () => {
  assert.equal(ringing.phase, 'ringing')
  for (const action of [
    { type: 'connecting', callId: 'old' },
    { type: 'connected', callId: 'old' },
    { type: 'caption', callId: 'old', caption: { role: 'agent', message: 'hi' } },
    { type: 'hung_up', callId: 'old' },
    { type: 'record', callId: 'old', record: callRecord('completed') },
    { type: 'failed', callId: 'old', error: 'x', phase: 'error' },
    { type: 'failed', callId: null, error: 'x' },
  ]) assert.equal(callReducer(ringing, action), ringing)
})

test('a completed record moves the call to completed', () => {
  let state = callReducer(ringing, { type: 'connecting', callId: 'call-1' })
  state = callReducer(state, { type: 'connected', callId: 'call-1' })
  state = callReducer(state, { type: 'caption', callId: 'call-1', caption: { role: 'agent', message: 'Hello' } })
  state = callReducer(state, { type: 'hung_up', callId: 'call-1' })
  assert.equal(state.phase, 'analyzing')
  assert.equal(state.captions.length, 1)
  state = callReducer(state, { type: 'record', callId: 'call-1', record: callRecord('analyzing') })
  assert.equal(state.phase, 'analyzing')
  state = callReducer(state, { type: 'record', callId: 'call-1', record: callRecord('completed', { outcome: 'resisted' }) })
  assert.equal(state.phase, 'completed')
  assert.equal(state.record.outcome, 'resisted')
})

test('failed sets the error and keeps or overrides the phase', () => {
  const kept = callReducer(ringing, { type: 'failed', callId: 'call-1', error: 'network_error' })
  assert.equal(kept.phase, 'ringing')
  assert.equal(kept.error, 'network_error')
  const moved = callReducer(ringing, { type: 'failed', callId: 'call-1', error: 'elevenlabs_error', phase: 'error' })
  assert.equal(moved.phase, 'error')
  const startFailed = callReducer(callReducer(INITIAL_CALL_STATE, { type: 'start' }), { type: 'failed', callId: null, error: 'unauthorized', phase: 'error' })
  assert.equal(startFailed.phase, 'error')
  assert.equal(callReducer(moved, { type: 'reset' }), INITIAL_CALL_STATE)
})

// --- Client ---

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

function fakeClient(responses) {
  const calls = []
  const tokens = []
  const client = createCommsClient({
    baseUrl: '/comms',
    getToken: async (forceRefresh) => {
      tokens.push(forceRefresh)
      return forceRefresh ? 'fresh-token' : 'cached-token'
    },
    fetch: async (url, init) => {
      calls.push({ url, ...init })
      return responses.shift()
    },
  })
  return { client, calls, tokens }
}

test('a 401 retries once with a force-refreshed token', async () => {
  const { client, calls, tokens } = fakeClient([
    json(401, { error: 'unauthorized', reason: 'expired' }),
    json(200, thread()),
  ])
  const result = await client.getThread('a b/c')
  assert.equal(result.id, T)
  assert.deepEqual(tokens, [false, true])
  assert.equal(calls.length, 2)
  assert.equal(calls[0].url, '/comms/texts/a%20b%2Fc')
  assert.equal(calls[0].headers.authorization, 'Bearer cached-token')
  assert.equal(calls[1].headers.authorization, 'Bearer fresh-token')
})

test('a second 401 is not retried again', async () => {
  const { client, calls } = fakeClient([
    json(401, { error: 'unauthorized', reason: 'expired' }),
    json(401, { error: 'unauthorized', reason: 'revoked' }),
  ])
  await assert.rejects(client.report(T), (error) => error instanceof CommsError && error.status === 401 && error.code === 'unauthorized')
  assert.equal(calls.length, 2)
})

test('startText resumes the active thread on 409 active_thread_exists', async () => {
  const { client, calls } = fakeClient([json(409, { error: 'active_thread_exists', threadId: 'existing' })])
  assert.deepEqual(await client.startText({ scenarioId: 'text-bank-alert' }), { threadId: 'existing', resumed: true })
  assert.equal(calls[0].method, 'POST')
  assert.equal(calls[0].headers['content-type'], 'application/json')
  assert.deepEqual(JSON.parse(calls[0].body), { scenarioId: 'text-bank-alert' })
})

test('startText returns a new thread on 201', async () => {
  const { client } = fakeClient([json(201, { threadId: 'new', streamUrl: '/comms/texts/new/stream', thread: thread({ id: 'new' }) })])
  assert.deepEqual(await client.startText(), { threadId: 'new', resumed: false })
})

test('non-ok responses throw CommsError with the code from the body', async () => {
  const { client } = fakeClient([
    json(404, { error: 'scenario_not_found' }),
    new Response('<html>Bad gateway</html>', { status: 502 }),
  ])
  await assert.rejects(client.startCall({ scenarioId: 'missing' }), (error) => {
    assert.ok(error instanceof CommsError)
    assert.equal(error.status, 404)
    assert.equal(error.code, 'scenario_not_found')
    assert.deepEqual(error.details, { error: 'scenario_not_found' })
    assert.equal(describeError(error), 'scenario_not_found')
    return true
  })
  await assert.rejects(client.acceptCall('call-1'), (error) => error instanceof CommsError && error.code === 'http_502')
  assert.equal(describeError(new TypeError('Failed to fetch')), 'network_error')
})

test('listScenarios is unauthenticated and streamUrl carries the token in the query', async () => {
  const { client, calls, tokens } = fakeClient([json(200, { scenarios: [{ id: 's1', channel: 'call' }] })])
  assert.deepEqual(await client.listScenarios('call'), [{ id: 's1', channel: 'call' }])
  assert.equal(calls[0].url, '/comms/scenarios?channel=call')
  assert.equal(calls[0].headers.authorization, undefined)
  assert.deepEqual(tokens, [])
  assert.equal(await client.streamUrl('t/1'), '/comms/texts/t%2F1/stream?access_token=cached-token')
})
