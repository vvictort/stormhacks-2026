import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { CallScenario } from '../app/scenarios/call-scenario.ts';
import { Tactic } from '../app/shared/vocabulary.ts';

// The API keeps its own copy of comms' scenario contract; this fails if the two drift apart.
const fixtures = new URL('../comms/fixtures/scenarios/', import.meta.url);

test('every comms call fixture parses with the API call-scenario schema', () => {
  const files = readdirSync(fixtures).filter((name) => name.startsWith('call-') && name.endsWith('.json'));
  assert.ok(files.length >= 5, 'expected the five contract call scenarios');
  for (const file of files) {
    const { scenario } = JSON.parse(readFileSync(new URL(file, fixtures), 'utf8'));
    assert.doesNotThrow(() => CallScenario.parse(scenario), file);
  }
});

test('the API tactic vocabulary matches comms', async () => {
  const comms = await import('../comms/src/types.ts');
  assert.deepEqual([...Tactic.options].sort(), [...comms.Tactic.options].sort());
});

test("comms' training-attempt payload passes the API schema, even for an oversize call", async () => {
  const { trainingAttempt } = await import('../comms/src/backend.ts');
  const { attemptSchema } = await import('../app/training/attempts.schema.ts');
  const long = 'x'.repeat(10_000);
  const call = {
    id: 'call_long', userId: 'uid-1', status: 'completed', signals: ['engaged'],
    createdAt: '2026-10-03T10:00:00.000Z', completedAt: '2026-10-03T10:02:00.000Z', durationSecs: 120,
    scenario: { id: 'gen-1', title: 't'.repeat(500), tactics: ['urgency'], difficulty: 3, callerLabel: 'x', systemPrompt: 'x', firstMessage: 'x' },
    summary: long,
    transcript: Array.from({ length: 250 }, (_, i) => ({ role: i % 2 ? 'user' : 'agent', message: long, timeInCallSecs: i })),
    training: { outcome: 'resisted', success: true, difficulty: 'hard' },
  };
  const parsed = attemptSchema.safeParse(trainingAttempt(call as never));
  assert.ok(parsed.success, JSON.stringify(parsed.error?.issues.slice(0, 3)));
  assert.equal(parsed.data.transcript.length, 200);
});
