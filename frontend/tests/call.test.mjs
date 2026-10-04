import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import test from 'node:test'
import { channelReady, channels, getScenario, hasLink, isScam, scenarios } from '../src/features/training/scenarios.ts'
import { OUTCOME_TABLE, isScored, normalizeCommsOutcome, readCallResult } from '../src/features/training/callOutcome.ts'
import { buildCallDebrief, callScreen, debriefSource, formatDuration, importantMoments, offersPractice, practiceResult } from '../src/features/training/call/callModel.ts'
import { confirmNavigation, guardsNavigation, leaveDecision, navigationGuarded, setNavigationGuard } from '../src/lib/navigationGuard.ts'
import { mergeProgress, recordAttempt, recommend, summarize, currentLevel } from '../src/features/training/progress.ts'

const CONTRACT_IDS = {
  'bank-fraud-dept-otp-1': 'medium',
  'cra-tax-arrears-1': 'medium',
  'courier-customs-fee-1': 'easy',
  'tech-support-remote-1': 'medium',
  'exec-vendor-payment-1': 'hard',
}
const calls = scenarios.filter((scenario) => scenario.type === 'call')

// --- Channel and scenarios ---

test('the call channel is ready with exactly the five contract scenarios and difficulties', () => {
  assert.equal(channelReady('call'), true)
  assert.ok(channels.every((channel) => channel.ready))
  assert.deepEqual(Object.fromEntries(calls.map((scenario) => [scenario.id, scenario.difficulty])), CONTRACT_IDS)
})

// The live caller is the comms fixture with the same id; the page around it must describe the same call.
const fixtureDir = new URL('../../backend/fixtures/scenarios/', import.meta.url)
const fixtures = readdirSync(fixtureDir)
  .filter((file) => file.startsWith('call-') && file.endsWith('.json'))
  .map((file) => JSON.parse(readFileSync(new URL(file, fixtureDir), 'utf8')).scenario)

test('call metadata matches the server fixtures: ids, titles, caller labels, numbers, difficulty, tactics', () => {
  assert.deepEqual(calls.map((scenario) => scenario.id).sort(), fixtures.map((fixture) => fixture.id).sort())
  for (const fixture of fixtures) {
    const scenario = getScenario(fixture.id)
    assert.equal(scenario.title, fixture.title, `${fixture.id}: title`)
    assert.equal(scenario.callerLabel, fixture.callerLabel, `${fixture.id}: caller label`)
    assert.equal(scenario.difficulty, { 1: 'easy', 2: 'medium', 3: 'hard' }[fixture.difficulty], `${fixture.id}: difficulty`)
    assert.deepEqual([...scenario.tactics].sort(), [...fixture.tactics].sort(), `${fixture.id}: tactics`)
    // A caller that shows up as a number gets no second, different number on the ringing screen.
    if (/^\+?[\d\s().-]+$/.test(fixture.callerLabel)) assert.equal(scenario.callerNumber, undefined, `${fixture.id}: number`)
  }
})

test('call scenarios carry teaching metadata only and work with shared helpers', () => {
  for (const scenario of calls) {
    assert.ok(scenario.callerLabel && scenario.tactics.length && scenario.indicators.length >= 3, scenario.id)
    assert.ok(scenario.indicators.every((indicator) => !indicator.quote), `${scenario.id}: no quote matching for calls`)
    assert.ok(scenario.practice.lines.length >= 3 && scenario.practice.complyLabel, scenario.id)
    assert.equal(hasLink(scenario), false)
    assert.equal(isScam(scenario), true)
    assert.ok(!('systemPrompt' in scenario) && !('firstMessage' in scenario), 'the caller script stays server-side')
  }
  assert.equal(isScam(getScenario('dental-reminder')), false)
  assert.equal(isScam(getScenario('parcel-redelivery')), true)
  assert.equal(new Set(scenarios.map((scenario) => scenario.id)).size, scenarios.length)
})

// --- Canonical outcomes ---

test('the contract table: declined and missed count as success, compromised fails, error is not scored', () => {
  assert.deepEqual(normalizeCommsOutcome('declined'), { outcome: 'declined', success: true })
  assert.deepEqual(normalizeCommsOutcome('ignored'), { outcome: 'missed', success: true })
  assert.deepEqual(normalizeCommsOutcome('missed'), { outcome: 'missed', success: true })
  assert.deepEqual(normalizeCommsOutcome('reported'), { outcome: 'resisted', success: true })
  assert.deepEqual(normalizeCommsOutcome('compromised'), { outcome: 'compromised', success: false })
  assert.deepEqual(normalizeCommsOutcome('error'), { outcome: 'error', success: null })
  assert.equal(normalizeCommsOutcome('toString'), null)
  assert.equal(normalizeCommsOutcome(undefined), null)
  assert.equal(Object.keys(OUTCOME_TABLE).length, 7)
  assert.equal(isScored(normalizeCommsOutcome('error')), false)
  assert.equal(isScored(normalizeCommsOutcome('declined')), true)
  assert.equal(isScored(null), false)
})

test('readCallResult prefers the training field, then a canonical attempt, then the table', () => {
  // The training field wins even when the raw comms outcome disagrees.
  assert.deepEqual(readCallResult({ outcome: 'resisted', training: { outcome: 'compromised', success: false, difficulty: 'medium' } }), { outcome: 'compromised', success: false })
  assert.deepEqual(readCallResult({ id: 'a1', channel: 'call', outcome: 'declined', success: true }), { outcome: 'declined', success: true })
  assert.deepEqual(readCallResult({ status: 'completed', outcome: 'ignored', signals: [] }), { outcome: 'missed', success: true })
  // An error is never scored, whatever success says.
  assert.deepEqual(readCallResult({ training: { outcome: 'error', success: true } }), { outcome: 'error', success: null })
  assert.equal(readCallResult({ status: 'ringing' }), null)
  assert.equal(readCallResult(null), null)
  // Malformed training falls through to the raw outcome.
  assert.deepEqual(readCallResult({ outcome: 'reported', training: { outcome: 'won', success: 'yes' } }), { outcome: 'resisted', success: true })
})

// --- Screen states ---

const screen = (phase, error = null, extra = {}) => callScreen({ phase, callId: 'call-1', error, result: null, ...extra })

test('callScreen maps each hook state to a phone screen', () => {
  assert.equal(screen('idle'), 'idle')
  assert.equal(screen('starting'), 'starting')
  assert.equal(screen('ringing'), 'ringing')
  assert.equal(screen('connecting'), 'connecting')
  assert.equal(screen('in_call'), 'active')
  assert.equal(screen('analyzing'), 'analyzing')
  assert.equal(screen('ringing', 'microphone_denied'), 'mic_denied')
  assert.equal(screen('ringing', 'microphone_unavailable'), 'mic_unavailable')
  assert.equal(screen('ringing', 'insecure_context'), 'insecure')
  assert.equal(screen('ringing', 'elevenlabs_not_configured'), 'voice_unavailable')
  assert.equal(screen('ringing', 'elevenlabs_error'), 'voice_unavailable')
  assert.equal(screen('error', 'network_error', { callId: null }), 'comms_unavailable')
  assert.equal(screen('error', 'http_502', { callId: null }), 'comms_unavailable')
  assert.equal(screen('error', 'SERVICE_UNAVAILABLE', { callId: null }), 'comms_unavailable')
  assert.equal(screen('error', 'unauthorized', { callId: null }), 'failed')
  assert.equal(screen('error', 'not_ringing'), 'failed')
  assert.equal(screen('error', 'not_in_call'), 'failed')
  assert.equal(screen('error', 'scenario_not_found', { callId: null }), 'failed')
  assert.equal(screen('error', 'network_error'), 'failed', 'a network error after the call began is not "comms unavailable"')
  assert.equal(screen('error', 'conversation_mismatch'), 'failed')
  assert.equal(screen('error', 'connect_cancelled'), 'not_connected')
  assert.equal(screen('error', 'connect_timeout'), 'not_connected')
  assert.equal(screen('completed', null, { result: { outcome: 'declined', success: true } }), 'declined')
  assert.equal(screen('completed', null, { result: { outcome: 'missed', success: true } }), 'missed')
  assert.equal(screen('completed', null, { result: { outcome: 'resisted', success: true } }), 'ended')
  assert.equal(screen('completed', null, { result: { outcome: 'compromised', success: false } }), 'ended')
})

test('caption-only practice is offered only when live voice is unavailable or failed', () => {
  for (const s of ['comms_unavailable', 'voice_unavailable', 'mic_denied', 'mic_unavailable', 'insecure', 'not_connected', 'failed']) assert.equal(offersPractice(s), true, s)
  for (const s of ['idle', 'starting', 'ringing', 'connecting', 'active', 'analyzing', 'ended', 'declined', 'missed']) assert.equal(offersPractice(s), false, s)
})

test('practice-mode results use the same contract table', () => {
  assert.deepEqual(practiceResult('hang_up'), { outcome: 'resisted', success: true })
  assert.deepEqual(practiceResult('comply'), { outcome: 'compromised', success: false })
  assert.deepEqual(practiceResult('decline'), { outcome: 'declined', success: true })
  assert.equal(formatDuration(74), '1:14')
  assert.equal(formatDuration(5.6), '0:05')
  assert.equal(formatDuration(-3), '0:00')
})

// --- Navigation guard ---

test('leaveDecision: only live phases ask; Back restores its entry or hangs up then goes back', () => {
  assert.equal(guardsNavigation('connecting'), true)
  assert.equal(guardsNavigation('in_call'), true)
  for (const phase of ['idle', 'ringing', 'analyzing', 'completed', 'error']) assert.equal(leaveDecision(phase, 'link'), 'allow', phase)
  assert.equal(leaveDecision('in_call', 'link'), 'confirm')
  assert.equal(leaveDecision('in_call', 'sign_out'), 'confirm')
  assert.equal(leaveDecision('in_call', 'unload'), 'browser_prompt')
  assert.equal(leaveDecision('in_call', 'link', 'stay'), 'stay')
  assert.equal(leaveDecision('in_call', 'link', 'leave'), 'hang_up_then_go')
  assert.equal(leaveDecision('connecting', 'sign_out', 'leave'), 'hang_up_then_go')
  assert.equal(leaveDecision('in_call', 'back_button', 'stay'), 'restore_entry')
  assert.equal(leaveDecision('in_call', 'back_button', 'leave'), 'hang_up_then_back')
  // The call ended while the dialog was open: just go.
  assert.equal(leaveDecision('analyzing', 'back_button', 'stay'), 'allow')
})

test('the guard registry: one guard, removed only by its own unregister', async () => {
  assert.equal(navigationGuarded(), false)
  assert.equal(await confirmNavigation(), true)
  const off = setNavigationGuard(async () => false)
  assert.equal(navigationGuarded(), true)
  assert.equal(await confirmNavigation(), false)
  const offNext = setNavigationGuard(async () => true)
  off()
  assert.equal(navigationGuarded(), true, 'a stale unregister does not remove the newer guard')
  offNext()
  assert.equal(navigationGuarded(), false)
})

// --- Debrief ---

const bank = getScenario('bank-fraud-dept-otp-1')
const transcript = [
  { role: 'agent', message: "Hi, this is Daniel from the fraud team.", timeInCallSecs: 1 },
  { role: 'user', message: 'Okay, hello.', timeInCallSecs: 4 },
  { role: 'agent', message: 'Can you read me the code we just texted?', timeInCallSecs: 9 },
  { role: 'user', message: "No. I'll call the number on my card instead.", timeInCallSecs: 15 },
  { role: 'agent', message: 'The charge goes through in five minutes.', timeInCallSecs: 70 },
]

test('debriefSource prefers the stored attempt and falls back to the comms record', () => {
  const record = { status: 'completed', signals: ['engaged'], transcript, scenario: { tactics: ['urgency'] }, training: { outcome: 'resisted', success: true, difficulty: 'medium' } }
  const attempt = { id: 'call_1', outcome: 'compromised', success: false, signals: ['shared_code'], tactics: ['otp_request'], transcript: [transcript[0]] }
  const fromAttempt = debriefSource(attempt, record)
  assert.equal(fromAttempt.from, 'attempt')
  assert.deepEqual(fromAttempt.result, { outcome: 'compromised', success: false })
  assert.deepEqual(fromAttempt.signals, ['shared_code'])
  const fromRecord = debriefSource(null, record)
  assert.equal(fromRecord.from, 'record')
  assert.deepEqual(fromRecord.result, { outcome: 'resisted', success: true })
  assert.deepEqual(fromRecord.tactics, ['urgency'])
  assert.equal(fromRecord.transcript.length, 5)
  // A 404 body or junk is not an attempt.
  assert.equal(debriefSource({ error: 'not_found' }, record).from, 'record')
})

test('buildCallDebrief: a resisted call with a challenge', () => {
  const view = buildCallDebrief(bank, { from: 'record', result: { outcome: 'resisted', success: true }, signals: ['engaged', 'challenged'], tactics: ['urgency', 'authority'], transcript })
  assert.equal(view.tone, 'success')
  assert.equal(view.mood, 'happy')
  assert.ok(view.didWell.some((line) => line.includes('questioned')))
  assert.deepEqual(view.improve, [bank.nextTime])
  assert.deepEqual(view.warningSigns, bank.indicators)
  assert.equal(new Set(view.tactics).size, view.tactics.length, 'tactics are deduped')
  assert.ok(view.detected.includes('You questioned the caller'))
  assert.equal(view.practice, false)
})

test('buildCallDebrief: compromised, declined, missed and unscored', () => {
  const lost = buildCallDebrief(bank, { from: 'attempt', result: { outcome: 'compromised', success: false }, signals: ['shared_code', 'agreed_to_action'] })
  assert.equal(lost.tone, 'missed')
  assert.equal(lost.mood, 'alert')
  assert.equal(lost.didWell.length, 0)
  assert.equal(lost.improve.length, 2)
  const declined = buildCallDebrief(bank, { from: 'record', result: { outcome: 'declined', success: true } })
  assert.equal(declined.tone, 'success')
  assert.match(declined.title, /Declining/)
  assert.ok(declined.didWell[0].includes("didn't pick up"))
  const missed = buildCallDebrief(bank, { from: 'record', result: { outcome: 'missed', success: true } })
  assert.equal(missed.tone, 'success')
  const unscored = buildCallDebrief(bank, { from: 'record', result: { outcome: 'error', success: null } })
  assert.equal(unscored.tone, 'unscored')
  assert.equal(buildCallDebrief(bank, { from: 'record', result: null }).tone, 'unscored')
  assert.equal(buildCallDebrief(bank, { from: 'practice', result: practiceResult('hang_up') }).practice, true)
})

test('importantMoments keeps the opener and pressure lines in order, capped', () => {
  const moments = importantMoments(transcript)
  assert.deepEqual(moments.map((moment) => moment.time), ['0:01', '0:09', '0:15', '1:10'])
  assert.equal(importantMoments(transcript, 2).length, 2)
  assert.deepEqual(importantMoments(undefined), [])
  const long = importantMoments([{ role: 'agent', message: 'x'.repeat(400), timeInCallSecs: 0 }])
  assert.ok(long[0].message.length <= 220 && long[0].message.endsWith('…'))
})

// --- Progress merge ---

const server = (scenarioId, success, completedAt, channel = 'call') => ({ id: `a-${completedAt}`, channel, scenarioId, outcome: 'resisted', success, completedAt })

test('mergeProgress folds scored server calls into local progress, oldest first', () => {
  const local = recordAttempt(recordAttempt({}, 'parcel-redelivery', true, 1000), 'courier-customs-fee-1', false, 3000)
  const merged = mergeProgress(local, [
    server('courier-customs-fee-1', true, new Date(5000).toISOString()),
    server('courier-customs-fee-1', false, new Date(2000).toISOString()),
    server('bank-fraud-dept-otp-1', null, new Date(4000).toISOString()), // error: not scored
    server('parcel-redelivery', false, new Date(6000).toISOString(), 'sms'), // texts stay local
    server('bank-fraud-dept-otp-1', true, 'not a date'),
  ])
  assert.deepEqual(merged['courier-customs-fee-1'].history.map((a) => [a.at, a.correct]), [[2000, false], [3000, false], [5000, true]])
  assert.equal(merged['courier-customs-fee-1'].correct, true)
  assert.equal(merged['bank-fraud-dept-otp-1'], undefined)
  assert.deepEqual(merged['parcel-redelivery'], local['parcel-redelivery'])
  assert.equal(mergeProgress(local, []), local, 'no server data: local unchanged (API unavailable fallback)')
  assert.equal(local['courier-customs-fee-1'].history.length, 1, 'local progress is not mutated')
})

test('merged call results feed summary, level and recommendation', () => {
  const merged = mergeProgress({}, [
    server('courier-customs-fee-1', true, '2026-10-01T10:00:00Z'),
    server('bank-fraud-dept-otp-1', true, '2026-10-01T11:00:00Z'),
  ])
  assert.equal(summarize(merged).done, 2)
  const callsOnly = calls
  assert.equal(currentLevel(merged, callsOnly), 'medium')
  assert.notEqual(recommend(merged, 'bank-fraud-dept-otp-1', callsOnly)?.id, 'bank-fraud-dept-otp-1')
  assert.equal(recommend(merged, 'bank-fraud-dept-otp-1', callsOnly)?.type, 'call')
})
