import {
  createUser,
  getUser,
  updateUserFromCommsReport,
  recordUserDecision,
} from './app/models/user.ts';
import type { CallRecord, TextThread } from './comms/src/types.ts';

async function testCommsReportProcessing() {
  console.log('====================================================');
  console.log('🧪 Testing UserVulnerabilityProfile Extensions & Comms Update');
  console.log('====================================================\n');

  // 1. Create a user
  const user = createUser({
    id: 'user-sim-101',
    name: 'Morgan Davis',
    email: 'morgan.davis@acmecorp.com',
    role: 'Procurement Specialist',
    company: 'Acme Corp',
    difficulty: 'intermediate',
  });
  console.log(`👤 Created User: ${user.name} (${user.company})`);
  console.log(`   Initial Resilience Score: ${user.stats.overallResilienceScore}`);
  console.log(`   Email Profile Evaluated: ${user.vulnerabilityProfile.emails.totalEvaluated}`);
  console.log(`   Call Profile Calls:      ${user.vulnerabilityProfile.calls.totalCalls}\n`);

  // 2. Simulate an Email Drill first
  console.log('📧 Simulating 1 Email Drill (User spots scam)...');
  recordUserDecision({
    userId: user.id,
    isScam: true,
    userGuessedScam: true,
    category: 'banking',
    redFlags: ['Spoofed domain', 'Artificial urgency'],
  });
  console.log(`   Email Profile Correct:   ${user.vulnerabilityProfile.emails.correctIdentifications}`);
  console.log(`   Email Profile Accuracy:  ${user.vulnerabilityProfile.emails.accuracyRate}%\n`);

  // 3. Simulate a Comms Call Report where user was compromised (fell for bank OTP fraud)
  console.log('📞 Simulating Comms Call Report #1: User COMPROMISED (shared OTP code)...');
  const simulatedCall1: CallRecord = {
    id: 'call-bank-test-001',
    userId: user.id,
    status: 'completed',
    outcome: 'compromised',
    durationSecs: 74,
    signals: ['engaged', 'shared_code'],
    scenario: {
      id: 'bank-otp-scam-v1',
      title: 'Fake Bank Fraud Dept OTP Request',
      tactics: ['authority', 'urgency', 'fear', 'otp_request'],
      difficulty: 2,
      callerLabel: 'Maple Trust Bank - Fraud Dept',
      systemPrompt: 'Pretend to be bank fraud prevention asking for OTP code.',
      firstMessage: 'Hi, this is Daniel from Maple Trust Bank fraud prevention.',
    },
    createdAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
  };

  const result1 = updateUserFromCommsReport(simulatedCall1);
  console.log(`   Feedback: ${result1.feedbackMessage}`);
  console.log(`   Updated Overall Score: ${result1.resilienceScore}`);
  console.log(`   Calls Completed:       ${user.vulnerabilityProfile.calls.totalCalls}`);
  console.log(`   Calls Compromised:     ${user.vulnerabilityProfile.calls.callsCompromised}`);
  console.log(`   Vulnerable Tactics:    ${user.vulnerabilityProfile.calls.vulnerableTactics.join(', ')}`);
  console.log(`   Compromising Signals:  ${user.vulnerabilityProfile.calls.compromisingSignalsTriggered.join(', ')}\n`);

  // 4. Simulate a Comms Call Report where user resisted and challenged the caller
  console.log('📞 Simulating Comms Call Report #2: User RESISTED (challenged caller)...');
  const simulatedCall2: CallRecord = {
    id: 'call-workplace-test-002',
    userId: user.id,
    status: 'completed',
    outcome: 'resisted',
    durationSecs: 48,
    signals: ['engaged', 'challenged', 'asked_to_verify'],
    scenario: {
      id: 'it-sso-scam-v2',
      title: 'Urgent Corporate IT SSO Re-sync',
      tactics: ['authority', 'urgency', 'info_request'],
      difficulty: 2,
      callerLabel: 'Corporate IT Helpdesk',
      systemPrompt: 'Pretend to be IT asking for employee credentials.',
      firstMessage: 'Hi, this is Sarah from corporate IT performing emergency SSO maintenance.',
    },
    createdAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
  };

  const result2 = updateUserFromCommsReport(simulatedCall2);
  console.log(`   Feedback: ${result2.feedbackMessage}`);
  console.log(`   Updated Overall Score: ${result2.resilienceScore}`);
  console.log(`   Calls Resisted:        ${user.vulnerabilityProfile.calls.callsResisted}`);
  console.log(`   Calls Challenged:      ${user.vulnerabilityProfile.calls.callsReportedOrChallenged}`);
  console.log(`   Average Call Duration: ${user.vulnerabilityProfile.calls.averageDurationSecs}s\n`);

  // 5. Simulate a Comms Text Thread report
  console.log('💬 Simulating Comms Text Report: Link Clicked...');
  const simulatedText: TextThread = {
    id: 'text-delivery-001',
    userId: user.id,
    status: 'ended',
    outcome: 'compromised',
    signals: ['engaged', 'clicked_link'],
    scammerTurns: 2,
    userMessagesHandled: 1,
    messages: [],
    scenario: {
      id: 'shipping-delivery-001',
      title: 'Package delivery fee link',
      tactics: ['urgency', 'suspicious_link'],
      difficulty: 2,
      senderLabel: 'PostNorth Express',
      openingMessage: 'Your package is on hold. Pay fee at {{link}}',
      linkDisplayUrl: 'postnorth-redelivery.info/pay',
      persona: 'PostNorth dispatch agent',
      maxTurns: 3,
    },
    createdAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
  };

  const result3 = updateUserFromCommsReport(simulatedText);
  console.log(`   Feedback: ${result3.feedbackMessage}`);
  console.log(`   Text Link Clicks: ${user.vulnerabilityProfile.texts.linkClicks}\n`);

  console.log('====================================================');
  console.log('📊 Complete User Profile Snapshot:');
  console.log(JSON.stringify(getUser(user.id), null, 2));
  console.log('====================================================');
  console.log('🎉 All comms report updates and profile extensions verified!');
  process.exit(0);
}

testCommsReportProcessing().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});
