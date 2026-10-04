import assert from 'node:assert/strict'
import test from 'node:test'
import { hasLink, markFor, markText, scenarios, siteOf } from '../src/features/training/scenarios.ts'
import { currentLevel, loadProgress, recommend, recordAttempt, saveProgress, summarize, timeline } from '../src/features/training/progress.ts'

test('every quoted indicator appears in its scenario text and ids are unique', () => {
  for (const scenario of scenarios.filter((item) => item.type !== 'call')) {
    const text = scenario.type === 'email'
      ? [scenario.subject, scenario.fromName, scenario.fromAddress, scenario.replyTo, ...scenario.body, ...(scenario.links ?? []), scenario.attachment].join(' ')
      : scenario.messages.map((message) => `${message.text} ${message.link ?? ''}`).join(' ')
    for (const indicator of scenario.indicators) {
      if (indicator.quote) assert.ok(text.includes(indicator.quote), `${scenario.id}: "${indicator.quote}"`)
    }
    assert.ok(['report', 'safe'].includes(scenario.correctAction))
  }
  assert.equal(new Set(scenarios.map((scenario) => scenario.id)).size, scenarios.length)
  const emails = scenarios.filter((scenario) => scenario.type === 'email')
  assert.ok(emails.some((scenario) => scenario.correctAction === 'safe'), 'at least one genuine email')
  assert.deepEqual(new Set(emails.map((scenario) => scenario.difficulty)), new Set(['easy', 'medium', 'hard']))
})

test('hasLink covers both channels', () => {
  assert.equal(hasLink(scenarios.find((scenario) => scenario.id === 'parcel-redelivery')), true)
  assert.equal(hasLink(scenarios.find((scenario) => scenario.id === 'dental-reminder')), false)
  assert.equal(hasLink(scenarios.find((scenario) => scenario.id === 'bank-sign-in')), true)
  assert.equal(hasLink(scenarios.find((scenario) => scenario.id === 'contractor-invoice')), false)
})

test('markText splits text into plain and numbered pieces without losing characters', () => {
  const indicators = [{ quote: 'fee', title: '', detail: '' }, { quote: 'missing', title: '', detail: '' }, { quote: 'A $2', title: '', detail: '' }]
  const segments = markText('A $2 fee is due', indicators)
  assert.deepEqual(segments, [{ text: 'A $2', mark: 3 }, { text: ' ' }, { text: 'fee', mark: 1 }, { text: ' is due' }])
  assert.equal(segments.map((segment) => segment.text).join(''), 'A $2 fee is due')
  assert.deepEqual(markText('abc', []), [{ text: 'abc' }])
  assert.equal(markFor('missing', indicators), 2)
  assert.equal(markFor('nope', indicators), undefined)
})

const list = [
  { id: 'e1', difficulty: 'easy' }, { id: 'e2', difficulty: 'easy' },
  { id: 'm1', difficulty: 'medium' }, { id: 'm2', difficulty: 'medium' },
  { id: 'h1', difficulty: 'hard' },
]
const play = (calls) => calls.reduce((progress, [id, correct], at) => recordAttempt(progress, id, correct, at), {})

test('recommend starts easy and prefers untried after the current one, then missed, then nothing', () => {
  assert.equal(recommend({}, undefined, list)?.id, 'e1')
  assert.equal(recommend({}, 'e1', list)?.id, 'e2')
  // One miss at easy: stay easy, and retry it before moving to medium.
  let progress = play([['e1', false]])
  assert.equal(currentLevel(progress, list), 'easy')
  assert.equal(recommend(progress, 'e1', list)?.id, 'e2')
  progress = play([['e1', false], ['e2', true]])
  assert.equal(recommend(progress, 'e2', list)?.id, 'e1')
  assert.deepEqual(summarize(progress, list), { total: 5, done: 2, correct: 1 })
  progress = play(list.map((scenario) => [scenario.id, true]))
  assert.equal(recommend(progress, undefined, list), undefined)
})

test('the level steps up after two right calls and back down after a miss', () => {
  const twoEasy = play([['e1', true], ['e2', true]])
  assert.equal(currentLevel(twoEasy, list), 'medium')
  assert.equal(recommend(twoEasy, 'e2', list)?.id, 'm1')
  const fourRight = play([['e1', true], ['e2', true], ['m1', true], ['m2', true]])
  assert.equal(currentLevel(fourRight, list), 'hard')
  assert.equal(recommend(fourRight, 'm2', list)?.id, 'h1')
  // A miss on a medium drops back to easy; with easy all done, the missed medium comes back first.
  const missed = play([['e1', true], ['e2', true], ['m1', false]])
  assert.equal(currentLevel(missed, list), 'easy')
  assert.equal(recommend(missed, 'm1', list)?.id, 'm2')
  assert.equal(recommend(missed, 'm2', list)?.id, 'm1')
  // A miss on a stretch scenario above the level doesn't count against you.
  assert.equal(currentLevel(play([['h1', false]]), list), 'easy')
  // Scenarios not in the list (another channel, removed) are ignored.
  assert.equal(currentLevel(play([['gone', true], ['gone', true]]), list), 'easy')
})

test('history keeps every attempt and old saves without history still load', () => {
  const old = { e1: { correct: false, at: 1 }, m1: { correct: true, at: 3 } }
  const progress = recordAttempt(old, 'e1', true, 5)
  assert.deepEqual(progress.e1, { correct: true, at: 5, history: [{ correct: false, at: 1 }, { correct: true, at: 5 }] })
  assert.deepEqual(timeline(progress), [{ id: 'e1', correct: false, at: 1 }, { id: 'm1', correct: true, at: 3 }, { id: 'e1', correct: true, at: 5 }])
  assert.deepEqual(summarize(progress, list), { total: 5, done: 2, correct: 2 })
  assert.equal(currentLevel(old, list), 'easy')
})

test('the real scenarios cover every difficulty and both answers', () => {
  for (const difficulty of ['easy', 'medium', 'hard']) assert.ok(scenarios.some((scenario) => scenario.difficulty === difficulty), difficulty)
  assert.ok(scenarios.filter((scenario) => scenario.correctAction === 'safe').length >= 2)
  assert.equal(recommend({})?.difficulty, 'easy')
})

test('progress falls back to memory when localStorage is unavailable', () => {
  assert.deepEqual(loadProgress('nobody'), {})
  saveProgress('uid-1', { x: { correct: true, at: 1 } })
  assert.deepEqual(loadProgress('uid-1'), { x: { correct: true, at: 1 } })
  assert.deepEqual(loadProgress('uid-2'), {})
})

test('siteOf shows the domain a look-alike link really belongs to', () => {
  assert.equal(siteOf('https://canadapost.ca-redelivery.info/update'), 'ca-redelivery.info')
  assert.equal(siteOf('not a url'), 'not a url')
})
