import assert from 'node:assert/strict'
import test from 'node:test'
import { generateScenario } from '../src/features/training/generate.ts'

test('generateScenario posts an empty body and returns the generated email', async () => {
  const scenario = { id: 'gen-email-1', type: 'email' }
  const calls = []
  const api = async (path, init) => { calls.push([path, init]); return { scenario } }
  assert.equal(await generateScenario(api), scenario)
  assert.deepEqual(calls, [['/training/email-scenarios', { method: 'POST', body: '{}' }]])
})

test('generateScenario turns failures into calm messages', async () => {
  const failing = (message) => async () => { throw new Error(message) }
  await assert.rejects(generateScenario(failing('POST /api/training/email-scenarios failed with 429')), /a lot of practice emails/)
  await assert.rejects(generateScenario(failing('POST /api/training/email-scenarios failed with 503')), /couldn't write a new email/)
  await assert.rejects(generateScenario(async () => ({ scenario: { id: 'bank-sign-in' } })), /couldn't write a new email/)
  await assert.rejects(generateScenario(async () => ({})), /couldn't write a new email/)
})
