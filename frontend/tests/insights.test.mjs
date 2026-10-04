import assert from 'node:assert/strict'
import test from 'node:test'
import { categoryLabel, instinctsChart, instinctsSource, instinctsView, seconds } from '../src/features/insights/instincts.ts'
import { createTracker, messageOutcome, runEvent } from '../src/features/insights/tracker.ts'
import { scenarios } from '../src/features/training/scenarios.ts'

const email = scenarios.find((scenario) => scenario.id === 'lib-email-b2fc6048da88')

test('run events carry the scenario, attempt and decision time; category only when the scenario has one', () => {
  const run = { attemptId: 'a1', startedAt: 1000 }
  const event = runEvent(email, run, 'scenario_completed', { outcome: 'reported_correct' }, 9400)
  assert.deepEqual({ ...event, at: undefined }, {
    type: 'scenario_completed', channel: 'email', scenarioId: 'lib-email-b2fc6048da88', scenarioTitle: email.title, attemptId: 'a1',
    difficulty: email.difficulty, responseTimeMs: 8400, outcome: 'reported_correct', tactics: email.tactics, scamCategory: email.scamCategory, at: undefined,
  })
  assert.equal('scamCategory' in runEvent({ ...email, scamCategory: undefined }, run, 'scenario_started', {}, 1000), false)
  assert.ok(email.tactics.length > 0)
  assert.equal('tactics' in runEvent(email, run, 'scenario_started', {}, 1000), false, 'tactics ride on the finished attempt only')
  assert.deepEqual(runEvent({ ...email, tactics: undefined }, run, 'scenario_completed', { outcome: 'reported_correct' }, 1000).tactics, [])
  assert.ok(!Number.isNaN(Date.parse(event.at)))
  assert.equal(runEvent({ ...email, scamCategory: 'banking' }, run, 'scenario_started', {}, 1000).scamCategory, 'banking')
  assert.equal(runEvent(email, run, 'scenario_started', {}, 500).responseTimeMs, 0)
})

test('message outcomes say what was chosen and whether it was right', () => {
  assert.equal(messageOutcome('report', 'report'), 'reported_correct')
  assert.equal(messageOutcome('report', 'safe'), 'reported_incorrect')
  assert.equal(messageOutcome('safe', 'safe'), 'safe_correct')
  assert.equal(messageOutcome('safe', 'report'), 'safe_incorrect')
})

test('the tracker batches after a pause, caps batches, flushes on demand and swallows failures', async () => {
  const sent = []
  let fail = false
  const tracker = createTracker(async (events, keepalive) => {
    sent.push({ n: events.length, keepalive })
    if (fail) throw new Error('offline')
  }, { delayMs: 20, max: 3 })
  const e = { type: 'scenario_started' }
  tracker.track(e)
  tracker.track(e)
  assert.equal(sent.length, 0, 'nothing sent before the pause')
  await new Promise((r) => setTimeout(r, 40))
  assert.deepEqual(sent, [{ n: 2, keepalive: false }])

  for (let i = 0; i < 4; i++) tracker.track(e)
  await tracker.flush(true)
  assert.deepEqual(sent.slice(1), [{ n: 3, keepalive: false }, { n: 1, keepalive: true }], 'a full batch goes at once, the rest on flush')

  fail = true
  tracker.track(e)
  await tracker.flush()
  assert.equal(sent.length, 4)
  await tracker.flush()
  assert.equal(sent.length, 4, 'nothing left to send; a failed batch is dropped')
})

const metrics = (overrides = {}) => ({
  attempts: 6, accuracy: 67, reportRate: 75, avgDetectionMs: 11_000, categories: [], timeline: [], mostImproved: null,
  trend: { window: 3, then: { accuracy: 33, avgDetectionMs: 14_200 }, now: { accuracy: 100, avgDetectionMs: 8700 } }, ...overrides,
})

test('the instincts card shows then → now, the most improved category and an honest window note', () => {
  assert.equal(instinctsView(null), null)
  assert.equal(instinctsView(metrics({ attempts: 0 })), null)
  const view = instinctsView(metrics({ mostImproved: { category: 'shipping', then: { accuracy: 0, avgDetectionMs: null }, now: { accuracy: 100, avgDetectionMs: null } } }))
  assert.deepEqual(view.rows, [
    { label: 'Time to decide', then: '14.2s', now: '8.7s', better: true },
    { label: 'Right calls', then: '33%', now: '100%', better: true },
    { label: 'Scams reported', now: '75%' },
  ])
  assert.equal(view.improved, 'delivery scams')
  assert.equal(view.note, 'Your first 3 scenarios against your latest 3.')

  const one = instinctsView(metrics({ attempts: 1, trend: null, reportRate: null, accuracy: 100, avgDetectionMs: 9000 }))
  assert.deepEqual(one.rows, [{ label: 'Time to decide', now: '9.0s' }, { label: 'Right calls', now: '100%' }])
  assert.match(one.note, /one more/)

  const slower = instinctsView(metrics({ trend: { window: 1, then: { accuracy: 100, avgDetectionMs: 5000 }, now: { accuracy: 0, avgDetectionMs: null } } }))
  assert.deepEqual(slower.rows.slice(0, 1), [{ label: 'Right calls', then: '100%', now: '0%', better: false }])
  assert.equal(slower.note, 'Your first scenario against your latest.')
  const fasterButWrong = instinctsView(metrics({ trend: { window: 2, then: { accuracy: 100, avgDetectionMs: 9500 }, now: { accuracy: 0, avgDetectionMs: 500 } } }))
  assert.equal(fasterButWrong.rows[0].better, false, 'falling for it faster is not better')
  assert.equal(seconds(14_249), '14.2s')
  assert.equal(categoryLabel('account_security'), 'account security scams')
})

const metricsWith = (overrides = {}) => ({ attempts: 3, accuracy: 67, reportRate: null, avgDetectionMs: 8000, trend: null, categories: [], mostImproved: null, timeline: [], ...overrides })

test('the mini chart shows recent decisions for a same-day history and right calls per day once there are days', () => {
  const today = [{ day: '2026-10-04', attempts: 3, correct: 2, avgDetectionMs: 8000 }]
  const recent = [{ at: 'a', correct: false, detectionMs: 12000 }, { at: 'b', correct: true, detectionMs: 6000 }, { at: 'c', correct: true, detectionMs: null }]
  assert.deepEqual(instinctsChart(metricsWith({ timeline: today, recent })), {
    title: 'Time to decide, last 3 scenarios', keys: ['right call', 'missed'],
    bars: [
      { height: 1, good: false, label: 'Scenario 1: missed, 12.0s' },
      { height: 0.5, good: true, label: 'Scenario 2: right call, 6.0s' },
      { height: 0, good: true, label: 'Scenario 3: right call' },
    ],
  })
  assert.equal(instinctsChart(metricsWith({ timeline: today, recent: recent.slice(0, 1) })), null, 'one bar is not a chart')
  assert.equal(instinctsChart(metricsWith({ timeline: today })), null, 'an older backend without recent')

  const days = Array.from({ length: 16 }, (_, i) => ({ day: `2026-09-${String(i + 10).padStart(2, '0')}`, attempts: 4, correct: i % 2 ? 4 : 1, avgDetectionMs: null }))
  const daily = instinctsChart(metricsWith({ timeline: days, recent }))
  assert.equal(daily.title, 'Right calls per day, last 14 days')
  assert.equal(daily.bars.length, 14)
  assert.deepEqual(daily.bars[0], { height: 0.25, good: false, label: '2026-09-12: 1 of 4 right' })
  assert.deepEqual(daily.bars[1], { height: 1, good: true, label: '2026-09-13: 4 of 4 right' })
})

test('the instincts card names TigerData only when the events are in a hypertable', () => {
  assert.equal(instinctsSource('timescale'), 'Every tap and decision is timed and stored in TigerData.')
  for (const storage of ['postgres', undefined]) assert.doesNotMatch(instinctsSource(storage), /TigerData/)
})
