import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CallRecord, Outcome, Signal, TextThread } from '../comms/src/types.ts';
import { createUser, updateUserFromCommsReport } from '../app/models/user.ts';

const callScenario = { id: 'bank-otp', title: 'Bank fraud desk', callerLabel: 'Bank', tactics: ['urgency', 'otp_request'] } as CallRecord['scenario'];
const textScenario = { id: 'parcel', title: 'Parcel fee', tactics: ['urgency'] } as TextThread['scenario'];
const call = (userId: string, outcome: Outcome, signals: Signal[], durationSecs?: number) =>
  ({ id: `c-${outcome}`, userId, scenario: callScenario, status: 'completed', outcome, signals, durationSecs, createdAt: '' }) as CallRecord;
const thread = (userId: string, outcome: Outcome, signals: Signal[]) =>
  ({ id: `t-${outcome}`, userId, scenario: textScenario, status: 'ended', outcome, signals, messages: [], scammerTurns: 0, userMessagesHandled: 0 }) as unknown as TextThread;

test('call reports update the call profile for every outcome', () => {
  const user = createUser({ name: 'A', email: 'a@example.com' });
  const shared = updateUserFromCommsReport(call(user.id, 'resisted', ['shared_code'], 60));
  assert.equal(shared.outcome, 'compromised'); // a compromising signal overrides the reported outcome
  assert.deepEqual(shared.vulnerableTacticsAdded, ['urgency', 'otp_request']);
  updateUserFromCommsReport({ call: call(user.id, 'reported', ['challenged'], 30) });
  updateUserFromCommsReport(call(user.id, 'declined', []));
  const calls = user.vulnerabilityProfile.calls;
  assert.deepEqual([calls.totalCalls, calls.callsCompromised, calls.callsReportedOrChallenged, calls.callsDeclinedOrMissed], [3, 1, 1, 1]);
  assert.deepEqual(calls.compromisingSignalsTriggered, ['shared_code']);
  assert.equal(calls.averageDurationSecs, 45); // only recalculated when a call reports a duration: (60 + 30) / 2
  assert.equal(calls.recentOutcomes[0].outcome, 'declined');
  assert.deepEqual([user.stats.totalDrillsCompleted, user.stats.correctIdentifications, user.stats.timesCompromised], [3, 1, 1]);
});

test('text reports update the text profile and never touch calls', () => {
  const user = createUser({ name: 'B', email: 'b@example.com' });
  updateUserFromCommsReport({ thread: thread(user.id, 'ignored', ['clicked_link']) });
  updateUserFromCommsReport(thread(user.id, 'reported', []));
  updateUserFromCommsReport(thread(user.id, 'resisted', []));
  const texts = user.vulnerabilityProfile.texts;
  assert.deepEqual([texts.totalThreads, texts.threadsCompromised, texts.linkClicks, texts.reported, texts.threadsResisted], [3, 1, 1, 1, 1]);
  assert.deepEqual(texts.vulnerableTactics, ['urgency']);
  assert.equal(user.vulnerabilityProfile.calls.totalCalls, 0);
  assert.deepEqual([user.stats.correctIdentifications, user.stats.timesCompromised], [2, 1]);
});
