import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import test from 'node:test'
import {
  channelReady,
  channels,
  getScenario,
  hasLink,
  isScam,
  scenarios,
} from '../src/features/training/scenarios.ts'
import {
  OUTCOME_TABLE,
  isScored,
  normalizeCommsOutcome,
  readCallResult,
} from '../src/features/training/callOutcome.ts'
import {
  buildCallDebrief,
  callScreen,
  debriefSource,
  formatDuration,
  importantMoments,
  offersPractice,
  practiceResult,
  riskyExchange,
} from '../src/features/training/call/callModel.ts'
import {
  confirmNavigation,
  guardsNavigation,
  leaveDecision,
  navigationGuarded,
  setNavigationGuard,
} from '../src/lib/navigationGuard.ts'
import {
  mergeProgress,
  recordAttempt,
  recommend,
  summarize,
  currentLevel,
} from '../src/features/training/progress.ts'

const calls = scenarios.filter((scenario) => scenario.type === 'call')

// --- Channel and scenarios ---

test('the call channel is ready with five library-built calls across every difficulty', () => {
  assert.equal(channelReady('call'), true)
  assert.ok(channels.every((channel) => channel.ready))
  assert.equal(calls.length, 5)
  assert.ok(
    calls.every((scenario) => scenario.id.startsWith('lib-call-')),
    'built from scam-library call patterns',
  )
  assert.deepEqual(
    new Set(calls.map((scenario) => scenario.difficulty)),
    new Set(['easy', 'medium', 'hard']),
  )
})

// The live caller is the comms fixture with the same id; the page around it must describe the same call.
const fixtureDir = new URL('../../backend/fixtures/scenarios/', import.meta.url)
const fixtures = readdirSync(fixtureDir)
  .filter((file) => file.startsWith('call-') && file.endsWith('.json'))
  .map(
    (file) =>
      JSON.parse(readFileSync(new URL(file, fixtureDir), 'utf8')).scenario,
  )

test('call metadata matches the server fixtures: ids, titles, caller labels, numbers, difficulty, tactics', () => {
  assert.deepEqual(
    calls.map((scenario) => scenario.id).sort(),
    fixtures.map((fixture) => fixture.id).sort(),
  )
  for (const fixture of fixtures) {
    const scenario = getScenario(fixture.id)
    assert.equal(scenario.title, fixture.title, `${fixture.id}: title`)
    assert.equal(
      scenario.callerLabel,
      fixture.callerLabel,
      `${fixture.id}: caller label`,
    )
    assert.equal(
      scenario.difficulty,
      { 1: 'easy', 2: 'medium', 3: 'hard' }[fixture.difficulty],
      `${fixture.id}: difficulty`,
    )
    assert.deepEqual(
      [...scenario.tactics].sort(),
      [...fixture.tactics].sort(),
      `${fixture.id}: tactics`,
    )
    // A caller that shows up as a number gets no second, different number on the ringing screen.
    if (/^\+?[\d\s().-]+$/.test(fixture.callerLabel)) {
      assert.equal(scenario.callerNumber, undefined, `${fixture.id}: number`)
    }
  }
})

test('call scenarios carry teaching metadata only and work with shared helpers', () => {
  for (const scenario of calls) {
    assert.ok(
      scenario.callerLabel &&
        scenario.tactics.length &&
        scenario.indicators.length >= 3,
      scenario.id,
    )
    assert.ok(
      scenario.indicators.every((indicator) => !indicator.quote),
      `${scenario.id}: no quote matching for calls`,
    )
    assert.ok(
      scenario.practice.lines.length >= 3 && scenario.practice.complyLabel,
      scenario.id,
    )
    assert.equal(hasLink(scenario), false)
    assert.equal(isScam(scenario), true)
    assert.ok(
      !('systemPrompt' in scenario) && !('firstMessage' in scenario),
      'the caller script stays server-side',
    )
  }
  assert.equal(isScam(getScenario('dental-reminder')), false)
  assert.equal(isScam(getScenario('lib-sms-shipping')), true)
  assert.equal(
    new Set(scenarios.map((scenario) => scenario.id)).size,
    scenarios.length,
  )
})

// --- Canonical outcomes ---

test('the contract table: declined and missed count as success, compromised fails, error is not scored', () => {
  assert.deepEqual(normalizeCommsOutcome('declined'), {
    outcome: 'declined',
    success: true,
  })
  assert.deepEqual(normalizeCommsOutcome('ignored'), {
    outcome: 'missed',
    success: true,
  })
  assert.deepEqual(normalizeCommsOutcome('missed'), {
    outcome: 'missed',
    success: true,
  })
  assert.deepEqual(normalizeCommsOutcome('reported'), {
    outcome: 'resisted',
    success: true,
  })
  assert.deepEqual(normalizeCommsOutcome('compromised'), {
    outcome: 'compromised',
    success: false,
  })
  assert.deepEqual(normalizeCommsOutcome('error'), {
    outcome: 'error',
    success: null,
  })
  assert.equal(normalizeCommsOutcome('toString'), null)
  assert.equal(normalizeCommsOutcome(undefined), null)
  assert.equal(Object.keys(OUTCOME_TABLE).length, 7)
  assert.equal(isScored(normalizeCommsOutcome('error')), false)
  assert.equal(isScored(normalizeCommsOutcome('declined')), true)
  assert.equal(isScored(null), false)
})

test('readCallResult prefers the training field, then a canonical attempt, then the table', () => {
  // The training field wins even when the raw comms outcome disagrees.
  assert.deepEqual(
    readCallResult({
      outcome: 'resisted',
      training: {
        outcome: 'compromised',
        success: false,
        difficulty: 'medium',
      },
    }),
    { outcome: 'compromised', success: false },
  )
  assert.deepEqual(
    readCallResult({
      id: 'a1',
      channel: 'call',
      outcome: 'declined',
      success: true,
    }),
    { outcome: 'declined', success: true },
  )
  assert.deepEqual(
    readCallResult({ status: 'completed', outcome: 'ignored', signals: [] }),
    { outcome: 'missed', success: true },
  )
  // An error is never scored, whatever success says.
  assert.deepEqual(
    readCallResult({ training: { outcome: 'error', success: true } }),
    { outcome: 'error', success: null },
  )
  assert.equal(readCallResult({ status: 'ringing' }), null)
  assert.equal(readCallResult(null), null)
  // Malformed training falls through to the raw outcome.
  assert.deepEqual(
    readCallResult({
      outcome: 'reported',
      training: { outcome: 'won', success: 'yes' },
    }),
    { outcome: 'resisted', success: true },
  )
})

// --- Screen states ---

const screen = (phase, error = null, extra = {}) =>
  callScreen({ phase, callId: 'call-1', error, result: null, ...extra })

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
  assert.equal(
    screen('ringing', 'elevenlabs_not_configured'),
    'voice_unavailable',
  )
  assert.equal(screen('ringing', 'elevenlabs_error'), 'voice_unavailable')
  assert.equal(
    screen('error', 'network_error', { callId: null }),
    'comms_unavailable',
  )
  assert.equal(
    screen('error', 'http_502', { callId: null }),
    'comms_unavailable',
  )
  assert.equal(
    screen('error', 'SERVICE_UNAVAILABLE', { callId: null }),
    'comms_unavailable',
  )
  assert.equal(screen('error', 'unauthorized', { callId: null }), 'failed')
  assert.equal(screen('error', 'not_ringing'), 'failed')
  assert.equal(screen('error', 'not_in_call'), 'failed')
  assert.equal(
    screen('error', 'scenario_not_found', { callId: null }),
    'failed',
  )
  assert.equal(
    screen('error', 'network_error'),
    'failed',
    'a network error after the call began is not "comms unavailable"',
  )
  assert.equal(screen('error', 'conversation_mismatch'), 'failed')
  assert.equal(screen('error', 'connect_cancelled'), 'not_connected')
  assert.equal(screen('error', 'connect_timeout'), 'not_connected')
  assert.equal(
    screen('completed', null, {
      result: { outcome: 'declined', success: true },
    }),
    'declined',
  )
  assert.equal(
    screen('completed', null, { result: { outcome: 'missed', success: true } }),
    'missed',
  )
  assert.equal(
    screen('completed', null, {
      result: { outcome: 'resisted', success: true },
    }),
    'ended',
  )
  assert.equal(
    screen('completed', null, {
      result: { outcome: 'compromised', success: false },
    }),
    'ended',
  )
})

test('caption-only practice is offered only when live voice is unavailable or failed', () => {
  for (const s of [
    'comms_unavailable',
    'voice_unavailable',
    'mic_denied',
    'mic_unavailable',
    'insecure',
    'not_connected',
    'failed',
  ]) {
    assert.equal(offersPractice(s), true, s)
  }
  for (const s of [
    'idle',
    'starting',
    'ringing',
    'connecting',
    'active',
    'analyzing',
    'ended',
    'declined',
    'missed',
  ]) {
    assert.equal(offersPractice(s), false, s)
  }
})

test('practice-mode results use the same contract table', () => {
  assert.deepEqual(practiceResult('hang_up'), {
    outcome: 'resisted',
    success: true,
  })
  assert.deepEqual(practiceResult('comply'), {
    outcome: 'compromised',
    success: false,
  })
  assert.deepEqual(practiceResult('decline'), {
    outcome: 'declined',
    success: true,
  })
  assert.equal(formatDuration(74), '1:14')
  assert.equal(formatDuration(5.6), '0:05')
  assert.equal(formatDuration(-3), '0:00')
})

// --- Navigation guard ---

test('leaveDecision: only live phases ask; Back restores its entry or hangs up then goes back', () => {
  assert.equal(guardsNavigation('connecting'), true)
  assert.equal(guardsNavigation('in_call'), true)
  for (const phase of ['idle', 'ringing', 'analyzing', 'completed', 'error']) {
    assert.equal(leaveDecision(phase, 'link'), 'allow', phase)
  }
  assert.equal(leaveDecision('in_call', 'link'), 'confirm')
  assert.equal(leaveDecision('in_call', 'sign_out'), 'confirm')
  assert.equal(leaveDecision('in_call', 'unload'), 'browser_prompt')
  assert.equal(leaveDecision('in_call', 'link', 'stay'), 'stay')
  assert.equal(leaveDecision('in_call', 'link', 'leave'), 'hang_up_then_go')
  assert.equal(
    leaveDecision('connecting', 'sign_out', 'leave'),
    'hang_up_then_go',
  )
  assert.equal(leaveDecision('in_call', 'back_button', 'stay'), 'restore_entry')
  assert.equal(
    leaveDecision('in_call', 'back_button', 'leave'),
    'hang_up_then_back',
  )
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
  assert.equal(
    navigationGuarded(),
    true,
    'a stale unregister does not remove the newer guard',
  )
  offNext()
  assert.equal(navigationGuarded(), false)
})

// --- Debrief ---

const bank = getScenario('lib-call-b5c8c2ff529a')
const transcript = [
  {
    role: 'agent',
    message: 'Hi, this is Daniel from the fraud team.',
    timeInCallSecs: 1,
  },
  { role: 'user', message: 'Okay, hello.', timeInCallSecs: 4 },
  {
    role: 'agent',
    message: 'Can you read me the code we just texted?',
    timeInCallSecs: 9,
  },
  {
    role: 'user',
    message: "No. I'll call the number on my card instead.",
    timeInCallSecs: 15,
  },
  {
    role: 'agent',
    message: 'The charge goes through in five minutes.',
    timeInCallSecs: 70,
  },
]

test('debriefSource prefers the stored attempt and falls back to the comms record', () => {
  const record = {
    status: 'completed',
    signals: ['engaged'],
    transcript,
    scenario: { tactics: ['urgency'] },
    training: { outcome: 'resisted', success: true, difficulty: 'medium' },
  }
  const attempt = {
    id: 'call_1',
    outcome: 'compromised',
    success: false,
    signals: ['shared_code'],
    tactics: ['otp_request'],
    transcript: [transcript[0]],
  }
  const fromAttempt = debriefSource(attempt, record)
  assert.equal(fromAttempt.from, 'attempt')
  assert.deepEqual(fromAttempt.result, {
    outcome: 'compromised',
    success: false,
  })
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
  const view = buildCallDebrief(bank, {
    from: 'record',
    result: { outcome: 'resisted', success: true },
    signals: ['engaged', 'challenged'],
    tactics: ['urgency', 'authority'],
    transcript,
  })
  assert.equal(view.tone, 'success')
  assert.equal(view.mood, 'happy')
  assert.equal(view.answered, true)
  assert.equal(view.pretext, bank.summary)
  assert.ok(view.didWell.some((line) => line.includes('questioned')))
  assert.ok(
    view.didWell.includes('You kept the code to yourself.'),
    'what the user held back on, from the tactics',
  )
  assert.equal(view.recommendation, bank.nextTime)
  assert.equal(view.nearMiss, null, 'a flat refusal is not a near miss')
  assert.deepEqual(view.ask, {
    role: 'agent',
    message: 'Can you read me the code we just texted?',
    time: '0:09',
  })
  assert.ok(
    !view.moments.some((m) => m.time === '0:09'),
    'the quoted ask is not repeated in the moments',
  )
  assert.deepEqual(view.warningSigns, bank.indicators)
  assert.equal(
    new Set(view.tactics).size,
    view.tactics.length,
    'tactics are deduped',
  )
  assert.equal(view.practice, false)
})

test('buildCallDebrief: a resisted call that nearly went wrong, and a lingering one', () => {
  const wobble = [
    {
      role: 'agent',
      message: 'I just texted you a code. Read it to me please.',
      timeInCallSecs: 5,
    },
    {
      role: 'user',
      message: 'Okay, hold on, let me find it.',
      timeInCallSecs: 9,
    },
    {
      role: 'user',
      message: "Actually no, I'll call my bank myself.",
      timeInCallSecs: 20,
    },
  ]
  const view = buildCallDebrief(bank, {
    from: 'attempt',
    result: { outcome: 'resisted', success: true },
    signals: ['engaged'],
    transcript: wobble,
  })
  assert.match(view.nearMiss.line, /started to go along/)
  assert.deepEqual(
    [view.nearMiss.exchange.ask.time, view.nearMiss.exchange.reply.time],
    ['0:05', '0:09'],
  )
  assert.match(view.recommendation, /Hang up sooner/)
})

test('buildCallDebrief: compromised shows where the caller got through and one fix', () => {
  const gave = [
    {
      role: 'agent',
      message: 'Can you read me the code we just texted?',
      timeInCallSecs: 9,
    },
    {
      role: 'user',
      message: "Sure, it's [NUMBER:6 digits].",
      timeInCallSecs: 14,
    },
  ]
  const lost = buildCallDebrief(bank, {
    from: 'attempt',
    result: { outcome: 'compromised', success: false },
    signals: ['engaged', 'shared_code', 'agreed_to_action'],
    transcript: gave,
  })
  assert.equal(lost.tone, 'missed')
  assert.equal(lost.mood, 'alert')
  assert.equal(lost.didWell.length, 0)
  assert.equal(
    lost.nearMiss.line,
    'You read out a code. You agreed to do what they asked.',
  )
  assert.equal(
    lost.nearMiss.exchange.reply.message,
    "Sure, it's [NUMBER:6 digits].",
  )
  assert.match(lost.recommendation, /Never read out a code/)
  const practice = buildCallDebrief(bank, {
    from: 'practice',
    result: practiceResult('comply'),
  })
  assert.equal(
    practice.nearMiss.line,
    `You chose "${bank.practice.complyLabel}". That was exactly what the caller was after.`,
  )
  assert.equal(practice.practice, true)
})

test('buildCallDebrief: declined, missed and unscored', () => {
  const declined = buildCallDebrief(bank, {
    from: 'record',
    result: { outcome: 'declined', success: true },
  })
  assert.equal(declined.tone, 'success')
  assert.match(declined.title, /Declining/)
  assert.equal(declined.answered, false)
  assert.equal(declined.nearMiss, null)
  assert.ok(declined.didWell[0].includes("didn't pick up"))
  assert.equal(declined.recommendation, bank.nextTime)
  const missed = buildCallDebrief(bank, {
    from: 'record',
    result: { outcome: 'missed', success: true },
  })
  assert.equal(missed.tone, 'success')
  const unscored = buildCallDebrief(bank, {
    from: 'record',
    result: { outcome: 'error', success: null },
    transcript,
  })
  assert.equal(unscored.tone, 'unscored')
  assert.equal(unscored.ask, null)
  assert.equal(
    buildCallDebrief(bank, { from: 'record', result: null }).tone,
    'unscored',
  )
  assert.equal(
    buildCallDebrief(bank, {
      from: 'practice',
      result: practiceResult('hang_up'),
    }).practice,
    true,
  )
})

test('riskyExchange finds the ask and a reply that went along, ignoring refusals', () => {
  assert.equal(riskyExchange([]), null)
  assert.equal(riskyExchange(transcript).reply, null)
  assert.equal(
    riskyExchange([
      { role: 'agent', message: 'Hello there.', timeInCallSecs: 0 },
    ]),
    null,
  )
  const gave = riskyExchange([
    {
      role: 'agent',
      message: 'What is your date of birth?',
      timeInCallSecs: 3,
    },
    {
      role: 'user',
      message: 'Um, [NUMBER:8 digits]? No wait.',
      timeInCallSecs: 6,
    },
  ])
  assert.equal(
    gave.reply.time,
    '0:06',
    'a redacted number in the reply counts even next to a "no"',
  )
})

// A generated call as GET /api/training/call-scenarios/:id returns it (backend/app/scenarios/generator.ts).
const generated = {
  id: 'gen-call-1b4e28ba-2fa1-4d3b-a3f5-ef19f6b1c2d3',
  type: 'call',
  title: 'IT needs your sign-in code',
  summary:
    'Your IT helpdesk calls about an urgent sign-in upgrade and asks for your MFA code.',
  situation: 'You sign in to work systems with a code.',
  difficulty: 'medium',
  callerLabel: 'IT Service Desk',
  callerNumber: '+1 (604) 555-0158',
  tactics: ['authority', 'otp_request'],
  indicators: [
    {
      title: 'Asking you to read out a code',
      detail: 'A one-time code is only for you.',
    },
  ],
  explanation: 'This is a helpdesk impersonation scam.',
  nextTime: 'Real IT staff never need your sign-in code.',
  practice: {
    lines: ['Hi, this is Sarah.', 'Read me the code.'],
    complyLabel: 'Read out the sign-in code',
  },
  scamCategory: 'workplace',
  generated: {
    source: 'fallback',
    reason: 'Matched to your work as an accountant.',
  },
}

test('a generated call debriefs like a built-in one and never becomes the recommendation', () => {
  const view = buildCallDebrief(generated, {
    from: 'record',
    result: { outcome: 'resisted', success: true },
    signals: ['engaged', 'asked_to_verify'],
    tactics: generated.tactics,
  })
  assert.equal(view.pretext, generated.summary)
  assert.deepEqual(view.tactics, [
    'Posing as someone in charge',
    'Asking for a one-time code',
  ])
  assert.ok(
    view.didWell.includes('You said you would check who was really calling.'),
  )
  assert.equal(view.recommendation, generated.nextTime)
  assert.equal(
    getScenario(generated.id),
    undefined,
    'generated ids load from the API, not the local list',
  )
  assert.notEqual(recommend({}, generated.id)?.id, generated.id)
})

test('requestPersonalisedCall lives outside the call chunk', () => {
  const source = readFileSync(
    new URL('../src/features/training/call/requestCall.ts', import.meta.url),
    'utf8',
  )
  assert.ok(
    !/@elevenlabs|useSimulatedCall|livekit/.test(
      source.replace(/^\s*\/\/.*$/gm, ''),
    ),
  )
  assert.match(
    source,
    /'\/training\/call-scenarios',\s*\{ method: 'POST', body: '\{\}'/,
  )
})

test('importantMoments keeps the opener and pressure lines in order, capped', () => {
  const moments = importantMoments(transcript)
  assert.deepEqual(
    moments.map((moment) => moment.time),
    ['0:01', '0:09', '0:15', '1:10'],
  )
  assert.equal(importantMoments(transcript, 2).length, 2)
  assert.deepEqual(importantMoments(undefined), [])
  const long = importantMoments([
    { role: 'agent', message: 'x'.repeat(400), timeInCallSecs: 0 },
  ])
  assert.ok(long[0].message.length <= 220 && long[0].message.endsWith('…'))
})

// --- Progress merge ---

const server = (scenarioId, success, completedAt, channel = 'call') => ({
  id: `a-${completedAt}`,
  channel,
  scenarioId,
  outcome: 'resisted',
  success,
  completedAt,
})

test('mergeProgress folds scored server calls into local progress, oldest first', () => {
  const local = recordAttempt(
    recordAttempt({}, 'lib-sms-shipping', true, 1000),
    'lib-call-0e5cfce002d9',
    false,
    3000,
  )
  const merged = mergeProgress(local, [
    server('lib-call-0e5cfce002d9', true, new Date(5000).toISOString()),
    server('lib-call-0e5cfce002d9', false, new Date(2000).toISOString()),
    server('lib-call-b5c8c2ff529a', null, new Date(4000).toISOString()), // error: not scored
    server('lib-sms-shipping', false, new Date(6000).toISOString(), 'sms'), // texts stay local
    server('lib-call-b5c8c2ff529a', true, 'not a date'),
  ])
  assert.deepEqual(
    merged['lib-call-0e5cfce002d9'].history.map((a) => [a.at, a.correct]),
    [
      [2000, false],
      [3000, false],
      [5000, true],
    ],
  )
  assert.equal(merged['lib-call-0e5cfce002d9'].correct, true)
  assert.equal(merged['lib-call-b5c8c2ff529a'], undefined)
  assert.deepEqual(merged['lib-sms-shipping'], local['lib-sms-shipping'])
  assert.equal(
    mergeProgress(local, []),
    local,
    'no server data: local unchanged (API unavailable fallback)',
  )
  assert.equal(
    local['lib-call-0e5cfce002d9'].history.length,
    1,
    'local progress is not mutated',
  )
})

test('merged call results feed summary, level and recommendation', () => {
  const merged = mergeProgress({}, [
    server('lib-call-0e5cfce002d9', true, '2026-10-01T10:00:00Z'),
    server('lib-call-b5c8c2ff529a', true, '2026-10-01T11:00:00Z'),
  ])
  assert.equal(summarize(merged).done, 2)
  const callsOnly = calls
  assert.equal(currentLevel(merged, callsOnly), 'medium')
  assert.notEqual(
    recommend(merged, 'lib-call-b5c8c2ff529a', callsOnly)?.id,
    'lib-call-b5c8c2ff529a',
  )
  assert.equal(
    recommend(merged, 'lib-call-b5c8c2ff529a', callsOnly)?.type,
    'call',
  )
})
