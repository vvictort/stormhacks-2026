import assert from 'node:assert/strict'
import test from 'node:test'
import {
  generatedCredit,
  voiceCredit,
} from '../src/features/training/attribution.ts'

test('Gemini is credited only when it wrote the scenario; grounding only with library examples', () => {
  const generated = (overrides = {}) => ({
    source: 'gemini',
    reason: 'Matched to your work',
    ...overrides,
  })

  assert.equal(generatedCredit(undefined), null, 'built-in scenarios')
  assert.equal(
    generatedCredit(
      generated({
        source: 'fallback',
        grounding: { exampleCount: 3, source: 'scam-library' },
      }),
    ),
    null,
    'a template is never Gemini',
  )
  assert.equal(generatedCredit(generated()), 'Written by Gemini')
  assert.equal(
    generatedCredit(
      generated({ grounding: { exampleCount: 0, source: 'scam-library' } }),
    ),
    'Written by Gemini',
  )
  assert.equal(
    generatedCredit(
      generated({ grounding: { exampleCount: 2, source: 'scam-library' } }),
    ),
    'Written by Gemini · Grounded in real-world scam patterns',
  )
  assert.equal(
    generatedCredit(
      generated({ grounding: { exampleCount: 3, source: 'scam-library' } }),
      true,
    ),
    'Written by Gemini · Grounded in real-world genuine emails',
    'a genuine email never claims scam patterns',
  )
})

test('ElevenLabs is credited only for a call answered with live voice', () => {
  assert.equal(
    voiceCredit({ practice: false, answered: true }),
    'Interactive voice simulation powered by ElevenLabs',
  )
  assert.equal(
    voiceCredit({ practice: true, answered: true }),
    null,
    'caption-only practice',
  )
  assert.equal(
    voiceCredit({ practice: false, answered: false }),
    null,
    'declined or missed: the voice never connected',
  )
})
