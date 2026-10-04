import assert from 'node:assert/strict'
import test from 'node:test'
import { markFor, markText, scenarios } from '../src/features/training/scenarios.ts'
import { loadProgress, recommend, recordAttempt, saveProgress, summarize } from '../src/features/training/progress.ts'

test('every quoted indicator appears in its scenario text and ids are unique', () => {
  for (const scenario of scenarios) {
    const text = scenario.messages.map((message) => `${message.text} ${message.link ?? ''}`).join(' ')
    for (const indicator of scenario.indicators) {
      if (indicator.quote) assert.ok(text.includes(indicator.quote), `${scenario.id}: "${indicator.quote}"`)
    }
    assert.ok(['report', 'safe'].includes(scenario.correctAction))
  }
  assert.equal(new Set(scenarios.map((scenario) => scenario.id)).size, scenarios.length)
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

test('recommend prefers untried scenarios after the current one, then missed ones, then nothing', () => {
  const [a, b, c] = scenarios
  assert.equal(recommend({})?.id, a.id)
  assert.equal(recommend({}, a.id)?.id, b.id)
  let progress = recordAttempt({}, b.id, true)
  assert.equal(recommend(progress, a.id)?.id, c.id)
  progress = recordAttempt(recordAttempt(progress, a.id, false), c.id, true)
  assert.equal(recommend(progress, c.id)?.id, a.id)
  assert.equal(recommend(progress, a.id), undefined)
  assert.equal(recommend(recordAttempt(progress, a.id, true)), undefined)
  assert.deepEqual(summarize(progress), { total: scenarios.length, done: 3, correct: 2 })
})

test('progress falls back to memory when localStorage is unavailable', () => {
  assert.deepEqual(loadProgress('nobody'), {})
  saveProgress('uid-1', { x: { correct: true, at: 1 } })
  assert.deepEqual(loadProgress('uid-1'), { x: { correct: true, at: 1 } })
  assert.deepEqual(loadProgress('uid-2'), {})
})
