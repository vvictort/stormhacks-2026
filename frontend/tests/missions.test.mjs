import assert from 'node:assert/strict'
import test from 'node:test'
import { badges, completeAdventure, completeCallAdventure, createMission, emptyAdventure, missionComplete, missionNext, prepareMission, readAdventure } from '../src/features/training/missions.ts'
import { OUTCOME_TABLE } from '../src/features/training/callOutcome.ts'
import { getAdventure, updateAdventure } from '../src/features/training/adventureStore.ts'
import { scenarios } from '../src/features/training/scenarios.ts'

function fixture(id = 'mission-test') {
  const state = { ...emptyAdventure(), mission: createMission({}, 'medium', id) }
  return prepareMission(state, id)
}
function finish(state, extra = {}) {
  const scenarioId = missionNext(state.mission)
  const scenario = scenarios.find(s => s.id === scenarioId)
  return completeAdventure(state, { attemptId: `attempt-${scenarioId}`, scenarioId, correct: false, scam: scenario.correctAction === 'report', previouslyMissed: false, missionId: state.mission.id, at: 100, ...extra })
}

test('missions include an email, a text and a call, with one genuine message, at every difficulty', () => {
  for (const difficulty of ['easy', 'medium', 'hard']) {
    const m = createMission({}, difficulty, difficulty)
    const selected = m.scenarioIds.map(id => scenarios.find(s => s.id === id))
    assert.equal(selected.length, 3)
    assert.equal(new Set(m.scenarioIds).size, 3)
    assert(selected.some(s => s.type === 'sms'))
    assert(selected.some(s => s.type === 'email'))
    assert(selected.some(s => s.type === 'call'))
    assert.equal(selected.filter(s => s.correctAction === 'safe').length, 1)
  }
})
test('the genuine message varies between text and email and is never replaced during preparation', () => {
  const genuineChannels = new Set()
  for (const id of ['a', 'b', 'c']) {
    const mission = createMission({}, 'easy', id)
    const genuine = mission.scenarioIds.map(id => scenarios.find(s => s.id === id)).find(s => s.correctAction === 'safe')
    genuineChannels.add(genuine.type)
    const original = scenarios.find(s => s.type === 'email' && s.correctAction === 'report')
    const prepared = prepareMission({ ...emptyAdventure(), mission }, id, { ...original, id: 'gen-email-variant' })
    assert(prepared.mission.scenarioIds.includes(genuine.id))
    if (genuine.type === 'email') assert.equal(prepared.mission.generated, undefined)
  }
  assert.deepEqual(genuineChannels, new Set(['sms', 'email']))
})
test('mission calls prefer an untried call near the learner’s difficulty', () => {
  const calls = scenarios.filter(s => s.type === 'call' && s.difficulty === 'medium')
  assert(calls.length > 1)
  const progress = { [calls[0].id]: { correct: true, at: 1 } }
  const mission = createMission(progress, 'medium', 'call-ranking')
  assert(mission.scenarioIds.includes(calls[1].id))
})
test('incorrect decisions still complete all three steps and earn First Steps once', () => {
  let state = fixture()
  const first = state.mission.scenarioIds[0]
  state = finish(state)
  const duplicate = completeAdventure(state, { attemptId: 'another-try', scenarioId: first, correct: false, scam: true, missionId: state.mission.id, at: 110 })
  assert.equal(duplicate.mission.completed.length, 1)
  state = finish(finish(state))
  assert(missionComplete(state.mission))
  assert.equal(state.completedMissions, 1)
  assert.deepEqual(state.earned, { 'first-steps': 100 })
  const repeat = completeAdventure(state, { attemptId: 'reload', scenarioId: first, correct: false, scam: true, missionId: state.mission.id, at: 120 })
  assert.equal(repeat.completedMissions, 1)
})
test('badges require the correct behavior, are never revoked, and retain the original earning time', () => {
  let state = emptyAdventure()
  const result = { attemptId: 'miss', scenarioId: 's', correct: false, scam: true, previouslyMissed: false, missionId: null, at: 1 }
  state = completeAdventure(state, result)
  assert.deepEqual(state.earned, {})
  state = completeAdventure(state, { ...result, attemptId: 'recovery', correct: true, previouslyMissed: true, at: 2 })
  assert.deepEqual(state.earned, { 'good-catch': 2, comeback: 2 })
  assert.equal(completeAdventure(state, { ...result, attemptId: 'recovery', at: 3 }), state)
  state = completeAdventure(state, { ...result, attemptId: 'again', correct: true, previouslyMissed: true, at: 4 })
  assert.deepEqual(state.earned, { 'good-catch': 2, comeback: 2 })
  const safe = completeAdventure(emptyAdventure(), { ...result, attemptId: 'safe', correct: true, scam: false })
  assert.equal(safe.earned['good-catch'], undefined)
})
test('standalone and out-of-order attempts do not advance a mission', () => {
  const state = fixture()
  assert.equal(finish(state, { missionId: null }).mission.completed.length, 0)
  assert.equal(finish(state, { missionId: 'old-mission' }).mission.completed.length, 0)
  assert.equal(finish(state, { scenarioId: state.mission.scenarioIds[2] }).mission.completed.length, 0)
})
test('scored call outcomes advance once, including a mistake; errors and pending results do not advance', () => {
  const selected = fixture()
  const callIndex = selected.mission.scenarioIds.findIndex(id => scenarios.find(s => s.id === id).type === 'call')
  let state = selected
  for (let i = 0; i < callIndex; i++) state = finish(state)
  const base = { attemptId: 'live-call', scenarioId: missionNext(state.mission), previouslyMissed: false, missionId: state.mission.id, at: 200 }
  for (const outcome of ['resisted', 'compromised', 'declined', 'missed']) {
    const finished = completeCallAdventure(state, { ...base, result: OUTCOME_TABLE[outcome] })
    assert.equal(finished.mission.completed.length, callIndex + 1, outcome)
    assert.equal(completeCallAdventure(finished, { ...base, result: OUTCOME_TABLE[outcome] }), finished)
    assert.equal(finished.earned['good-catch'], outcome === 'resisted' ? 200 : undefined)
  }
  assert.equal(completeCallAdventure(state, { ...base, result: OUTCOME_TABLE.error }), state)
  assert.equal(completeCallAdventure(state, { ...base, result: null }), state)
  assert.equal(completeCallAdventure(state, { ...base, missionId: null, result: OUTCOME_TABLE.resisted }).mission.completed.length, callIndex)
})
test('a call finishing the mission earns First Steps, and a successful call revisit earns Comeback', () => {
  let state = fixture('call-last')
  const callId = state.mission.scenarioIds.find(id => scenarios.find(s => s.id === id).type === 'call')
  state = { ...state, mission: { ...state.mission, scenarioIds: [...state.mission.scenarioIds.filter(id => id !== callId), callId] } }
  state = finish(finish(state))
  state = completeCallAdventure(state, { attemptId: 'caption-call', scenarioId: callId, previouslyMissed: true, missionId: state.mission.id, at: 300, result: OUTCOME_TABLE.resisted })
  assert(missionComplete(state.mission))
  assert.equal(state.completedMissions, 1)
  assert.deepEqual(state.earned, { 'good-catch': 300, comeback: 300, 'first-steps': 300 })
  assert.deepEqual(readAdventure(JSON.stringify(state)), state)
})
test('older text/email missions still restore without discarding their selection or progress', () => {
  const ids = [
    scenarios.find(s => s.type === 'email' && s.correctAction === 'report').id,
    scenarios.find(s => s.type === 'sms' && s.correctAction === 'report').id,
    scenarios.find(s => s.type === 'sms' && s.correctAction === 'safe').id,
  ]
  const state = { ...emptyAdventure(), mission: { id: 'old-mission', scenarioIds: ids, completed: [ids[0]], ready: true } }
  assert.deepEqual(readAdventure(JSON.stringify(state)), state)
})
test('failed generation retains selection through reload; fallback and success both preserve the genuine message', () => {
  const mission = createMission({}, 'easy', 'generation')
  let selected = { ...emptyAdventure(), mission }
  const restored = readAdventure(JSON.stringify(selected))
  assert.deepEqual(restored.mission.scenarioIds, mission.scenarioIds)
  assert.equal(restored.mission.ready, false)
  const original = scenarios.find(s => s.type === 'email' && s.correctAction === 'report')
  const generated = { ...original, id: 'gen-email-fixture' }
  selected = prepareMission(restored, mission.id, generated)
  assert(selected.mission.scenarioIds.includes(generated.id))
  assert.deepEqual(readAdventure(JSON.stringify(selected)), selected)
  assert.equal(prepareMission(selected, mission.id), selected)
  const fallback = prepareMission(restored, mission.id)
  assert.deepEqual(fallback.mission.scenarioIds, mission.scenarioIds)
  assert.equal(fallback.mission.ready, true)
  assert.equal(prepareMission(restored, 'stale', generated), restored)
})
test('completed steps and rewards survive serialization; corrupt or unknown saves are rejected', () => {
  const state = finish(fixture(), { correct: true })
  assert.deepEqual(readAdventure(JSON.stringify(state)), state)
  for (const raw of [null, 'garbage', '{}', JSON.stringify({ ...state, version: 2 }), JSON.stringify({ ...state, mission: { ...state.mission, completed: ['unknown'] } }), JSON.stringify({ ...state, earned: { fake: 10 } })]) {
    assert.equal(readAdventure(raw), null)
  }
})
test('blocked storage falls back to memory and accounts stay isolated', () => {
  const previous = globalThis.localStorage
  globalThis.localStorage = { getItem() { throw new Error('blocked') }, setItem() { throw new Error('blocked') } }
  try {
    const a = updateAdventure('mission-account-a', () => finish(fixture(), { correct: true }))
    assert.equal(getAdventure('mission-account-a'), a)
    assert.deepEqual(getAdventure('mission-account-b'), emptyAdventure())
    updateAdventure('mission-account-b', s => ({ ...s, tipSeen: false }))
    assert.equal(getAdventure('mission-account-a').tipSeen, true)
    assert.equal(badges.length, 3)
  } finally { globalThis.localStorage = previous }
})
