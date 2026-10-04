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
