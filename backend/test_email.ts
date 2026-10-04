import { generateEmail } from './app/integrations/gemini.js';
import { createUser, recordUserDecision } from './app/models/user.js';

async function main() {
  console.log('====================================================');
  console.log('📧 Testing Gemini Email Generation & User Tracking');
  console.log('====================================================\n');

  // 1. Create a simulated user profile
  console.log('👤 Creating User Profile...');
  const user = createUser({
    name: 'Alex Rivera',
    email: 'alex.rivera@acmecorp.com',
    role: 'Financial Analyst',
    company: 'Acme Corp',
    difficulty: 'intermediate',
  });
  console.log(`   Created User: ${user.name} (${user.role} at ${user.company})`);
  console.log(`   Initial Skill Level: ${user.currentDifficulty}`);
  console.log(`   Starting Resilience Score: ${user.stats.overallResilienceScore}/100\n`);

  // 2. Generate a Personalized Scam Email targeted at this user
  console.log('🚨 Generating Personalized SCAM Email for User...');
  const scamEmail = await generateEmail({
    isScam: true,
    user,
    category: 'banking',
  });
  console.log('----------------------------------------------------');
  console.log(`[ID]:          ${scamEmail.id}`);
  console.log(`[SENDER]:      ${scamEmail.senderName} <${scamEmail.senderEmail}>`);
  console.log(`[SUBJECT]:     ${scamEmail.subject}`);
  console.log(`[CATEGORY]:    ${scamEmail.category} | Difficulty: ${scamEmail.difficulty}`);
  console.log(`[IS SCAM?]:    🚨 ${scamEmail.isScam}`);
  console.log(`[RED FLAGS]:   ${scamEmail.redFlags.length} flags:`);
  scamEmail.redFlags.forEach((flag, idx) => console.log(`   ${idx + 1}. ${flag}`));
  console.log(`[BODY]:\n${scamEmail.body}`);
  console.log(`[EXPLANATION]: ${scamEmail.explanation}`);
  console.log('----------------------------------------------------\n');

  // 3. Simulate User Decision: User spots the scam correctly!
  console.log('🎯 User evaluates Email #1: Guesses "SCAM"...');
  const decision1 = recordUserDecision({
    userId: user.id,
    isScam: scamEmail.isScam,
    userGuessedScam: true, // Correct!
    category: scamEmail.category,
    redFlags: scamEmail.redFlags,
  });
  console.log(`   Result: ${decision1.feedbackMessage}`);
  console.log(`   Updated Resilience Score: ${decision1.user.stats.overallResilienceScore}/100`);
  console.log(`   Total Drills: ${decision1.user.stats.totalDrillsCompleted}, Correct: ${decision1.user.stats.correctIdentifications}\n`);

  // 4. Generate a Legitimate Email
  console.log('✅ Generating LEGITIMATE Email...');
  const legitEmail = await generateEmail({
    isScam: false,
    user,
    category: 'workplace',
  });
  console.log('----------------------------------------------------');
  console.log(`[ID]:          ${legitEmail.id}`);
  console.log(`[SENDER]:      ${legitEmail.senderName} <${legitEmail.senderEmail}>`);
  console.log(`[SUBJECT]:     ${legitEmail.subject}`);
  console.log(`[CATEGORY]:    ${legitEmail.category} | Difficulty: ${legitEmail.difficulty}`);
  console.log(`[IS SCAM?]:    ✅ ${legitEmail.isScam}`);
  console.log(`[RED FLAGS]:   ${legitEmail.redFlags.length} flags (should be 0)`);
  console.log(`[BODY]:\n${legitEmail.body}`);
  console.log(`[EXPLANATION]: ${legitEmail.explanation}`);
  console.log('----------------------------------------------------\n');

  // 5. Simulate User Decision: User mistakenly marks legit email as a scam (false alarm)
  console.log('🎯 User evaluates Email #2: Mistakenly flags as "SCAM"...');
  const decision2 = recordUserDecision({
    userId: user.id,
    isScam: legitEmail.isScam,
    userGuessedScam: true, // Mistake (False Positive)
    category: legitEmail.category,
  });
  console.log(`   Result: ${decision2.feedbackMessage}`);
  console.log(`   Updated Resilience Score: ${decision2.user.stats.overallResilienceScore}/100`);
  console.log(`   False Positives: ${decision2.user.stats.falsePositives}\n`);

  console.log('====================================================');
  console.log('📊 Final User Profile State:');
  console.log(JSON.stringify(decision2.user, null, 2));
  console.log('====================================================\n');
  console.log('🎉 Email generation & user scoring test complete!');
  process.exit(0);
}

main().catch((err) => {
  console.error('Error running test:', err);
  process.exit(1);
});
