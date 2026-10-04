import assert from 'node:assert/strict'
import test from 'node:test'
import { categoryLabel, scamProfileView } from '../src/features/insights/scamProfile.ts'

const insights = (overrides = {}) => ({
  strongestAreas: ['Delivery scams', 'Urgency pressure'], weakAreas: ['Account security scams'],
  behavioralPattern: 'You consistently see through delivery scams, but you struggle when authority and urgency are combined.',
  recommendation: 'Your next training should focus on account security scams.',
  nextTrainingFocus: ['account_security', 'workplace'], source: 'fallback', generatedAt: '2026-10-04T00:00:00Z', basedOn: { attempts: 6 }, ...overrides,
})

test('the profile card shows plain labels and an honest source line', () => {
  const view = scamProfileView(insights())
  assert.deepEqual(view, {
    empty: false, strongest: 'Delivery scams', weakest: 'Account security scams', insight: insights().behavioralPattern,
    recommendation: insights().recommendation, focus: ['Account security', 'Workplace scams'], sourceLine: 'Built-in analysis · based on 6 attempts',
  })
  assert.equal(scamProfileView(insights({ source: 'snowflake', basedOn: { attempts: 1 } })).sourceLine, 'Analysed in Snowflake · based on 1 attempt')
  assert.equal(categoryLabel('some_new_kind'), 'Some new kind')
})

test('an empty history is an empty profile; a malformed response hides the card', () => {
  const empty = scamProfileView(insights({ strongestAreas: [], weakAreas: [], nextTrainingFocus: [], basedOn: { attempts: 0 } }))
  assert.deepEqual([empty.empty, empty.strongest, empty.weakest, empty.focus], [true, undefined, undefined, []])
  for (const bad of [null, {}, insights({ weakAreas: 'x' }), insights({ basedOn: undefined }), insights({ behavioralPattern: 3 })]) assert.equal(scamProfileView(bad), null)
})
