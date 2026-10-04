import assert from 'node:assert/strict'
import test from 'node:test'
import { hasLink, markFor, markText, scenarios, siteOf } from '../src/features/training/scenarios.ts'
import { loadProgress, recommend, recordAttempt, saveProgress, summarize } from '../src/features/training/progress.ts'

test('every quoted indicator appears in its scenario text and ids are unique', () => {
  for (const scenario of scenarios) {
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

test('recommend prefers untried scenarios after the current one, then missed ones, then nothing', () => {
  const list = scenarios.slice(0, 3)
  const [a, b, c] = list
  assert.equal(recommend({})?.id, a.id)
  assert.equal(recommend({}, a.id)?.id, b.id)
  let progress = recordAttempt({}, b.id, true)
  assert.equal(recommend(progress, a.id, list)?.id, c.id)
  progress = recordAttempt(recordAttempt(progress, a.id, false), c.id, true)
  assert.equal(recommend(progress, c.id, list)?.id, a.id)
  assert.equal(recommend(progress, a.id, list), undefined)
  assert.equal(recommend(recordAttempt(progress, a.id, true), undefined, list), undefined)
  assert.deepEqual(summarize(progress), { total: scenarios.length, done: 3, correct: 2 })
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
