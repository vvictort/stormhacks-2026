import assert from 'node:assert/strict'
import test from 'node:test'
import {
  debriefActions,
  learned,
  nextForYou,
  readAdaptive,
} from '../src/features/training/adaptive.ts'

const progress = (overrides = {}) => ({
  attempts: [],
  stats: { total: 0, successes: 0, compromised: 0 },
  vulnerability: {
    weakCategories: [],
    vulnerableTactics: [],
    categoryAccuracy: {},
  },
  difficulty: 'easy',
  focus: [],
  ...overrides,
})
const metrics = (overrides = {}) => ({
  attempts: 3,
  accuracy: 100,
  reportRate: 100,
  avgDetectionMs: 8000,
  trend: null,
  categories: [],
  mostImproved: null,
  timeline: [],
  ...overrides,
})

test('readAdaptive accepts the progress response and rejects older or broken shapes', () => {
  assert.deepEqual(readAdaptive(progress({ focus: ['banking'] })), {
    difficulty: 'easy',
    focus: ['banking'],
    categoryAccuracy: {},
    vulnerableTactics: [],
    attempts: [],
  })
  assert.equal(
    readAdaptive({ attempts: [], stats: {} }),
    null,
    'a backend without difficulty/focus',
  )
  assert.equal(readAdaptive(progress({ difficulty: 'expert' })), null)
  assert.equal(readAdaptive(null), null)
})

test('nextForYou explains the focus from real numbers, and stays plain without the API', () => {
  const weak = readAdaptive(
    progress({
      difficulty: 'medium',
      focus: ['account_security'],
      vulnerability: {
        vulnerableTactics: ['urgency'],
        categoryAccuracy: {
          account_security: { attempts: 3, correct: 1, accuracy: 33 },
        },
      },
    }),
  )
  assert.deepEqual(nextForYou(weak, 'easy'), {
    title: 'An account-security email, made for you',
    reason:
      "Tellio noticed account-security scams catch you out: you've made the right call on 1 of 3. You also tend to go along with urgency.",
    difficulty: 'medium',
  })
  assert.equal(
    nextForYou(readAdaptive(progress({ focus: ['government'] })), 'easy')
      .reason,
    "You haven't practised tax and government scams yet, so that's next.",
  )
  assert.deepEqual(nextForYou(null, 'hard'), {
    title: 'An email made for you',
    reason: "Tellio writes it around your profile and how you've done so far.",
    difficulty: 'hard',
  })
})

test('learned reports only real before/after changes', () => {
  const before = {
    adaptive: readAdaptive(
      progress({
        difficulty: 'easy',
        focus: ['government'],
        vulnerability: {
          categoryAccuracy: {
            banking: { attempts: 1, correct: 1, accuracy: 100 },
          },
        },
      }),
    ),
    metrics: metrics({ avgDetectionMs: 10000, accuracy: 100 }),
    insight: { pattern: 'Your results are mixed so far.', source: 'fallback' },
  }
  const after = {
    adaptive: readAdaptive(
      progress({
        difficulty: 'medium',
        focus: ['banking'],
        attempts: [{ id: 'run-1', scamCategory: 'banking' }],
        vulnerability: {
          categoryAccuracy: {
            banking: { attempts: 2, correct: 1, accuracy: 50 },
          },
        },
      }),
    ),
    metrics: metrics({ avgDetectionMs: 7900, accuracy: 75 }),
    insight: { pattern: 'You struggle with bank scams.', source: 'snowflake' },
  }
  const view = learned(before, after, 'run-1')
  assert.deepEqual(view.lines, [
    'Difficulty increased to Medium.',
    'Your focus moved to bank scams.',
    'Bank scams: right calls 100% → 50%.',
    'Right calls overall: 100% → 75%.',
  ])
  // Faster with accuracy held (or up) is an improvement; faster while falling for it isn't.
  assert.ok(
    learned(
      { ...before, metrics: metrics({ avgDetectionMs: 10000, accuracy: 75 }) },
      after,
      'run-1',
    ).lines.includes(
      'Your average time to decide improved by 21% (10.0s → 7.9s).',
    ),
  )
  assert.deepEqual(view.insight, after.insight)
  assert.equal(view.next.title, 'A bank email, made for you')

  // Nothing changed: say what Tellio keeps practising, never invent a change.
  const same = learned(after, after, 'run-1')
  assert.deepEqual(same.lines, [
    'Nothing to adjust yet. Tellio will keep practising bank scams with you.',
  ])
  assert.equal(same.insight, null)
  assert.equal(learned(before, { ...after, adaptive: null }, 'run-1'), null)
  // A slower decision isn't reported as an improvement.
  assert.ok(
    !learned(
      { ...after, metrics: metrics({ avgDetectionMs: 5000, accuracy: 75 }) },
      after,
      'run-1',
    ).lines.some((line) => line.includes('time to decide')),
  )
})

test('a debrief offers one next step: the adaptive one when its panel shows, the path otherwise', () => {
  assert.deepEqual(debriefActions({ hasNext: true, adaptive: true }), {
    pathNext: false,
    homePrimary: false,
  })
  assert.deepEqual(debriefActions({ hasNext: true, adaptive: false }), {
    pathNext: true,
    homePrimary: false,
  })
  assert.deepEqual(debriefActions({ hasNext: false, adaptive: false }), {
    pathNext: false,
    homePrimary: true,
  })
  assert.deepEqual(debriefActions({ hasNext: false, adaptive: true }), {
    pathNext: false,
    homePrimary: false,
  })
})
