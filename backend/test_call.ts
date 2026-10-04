import { generateCallScenario } from './app/integrations/gemini.ts';
import { createUser } from './app/models/user.ts';
import { CallScenario } from './comms/src/types.ts';

async function main() {
  console.log('====================================================');
  console.log('📞 Testing Gemini Phone Call Scenario Generation');
  console.log('====================================================\n');

  console.log('👤 Creating User Profile...');
  const user = createUser({
    name: 'Jordan Lee',
    email: 'jordan.lee@acmecorp.com',
    role: 'Senior Accountant',
    company: 'Acme Corp',
    difficulty: 'intermediate',
  });
  console.log(`   User: ${user.name} (${user.role} at ${user.company})`);
  console.log(`   Target Difficulty: ${user.currentDifficulty}\n`);

  console.log('🚨 Generating Call Scenario (Banking / OTP Intercept)...');
  const scenario = await generateCallScenario({
    user,
    category: 'banking',
    difficulty: 2,
    targetObjective: 'otp',
  });

  console.log('----------------------------------------------------');
  console.log(`[ID]:           ${scenario.id}`);
  console.log(`[TITLE]:        ${scenario.title}`);
  console.log(`[CALLER LABEL]: ${scenario.callerLabel}`);
  console.log(`[DIFFICULTY]:   ${scenario.difficulty}`);
  console.log(`[TACTICS]:      ${scenario.tactics.join(', ')}`);
  console.log(`[FIRST MESSAGE]:\n"${scenario.firstMessage}"`);
  console.log(`[SYSTEM PROMPT]:\n${scenario.systemPrompt}`);
  console.log('----------------------------------------------------\n');

  console.log('🔍 Validating Scenario with CallScenario.parse()...');
  CallScenario.parse(scenario);
  console.log('✅ Scenario is 100% Zod-validated and matches comms contract!\n');

  console.log('🚨 Generating Workplace IT Scenario...');
  const itScenario = await generateCallScenario({
    user,
    category: 'workplace',
    difficulty: 'intermediate',
    targetObjective: 'remote_access',
  });
  console.log(`[TITLE]:        ${itScenario.title}`);
  console.log(`[CALLER LABEL]: ${itScenario.callerLabel}`);
  console.log(`[FIRST MESSAGE]:\n"${itScenario.firstMessage}"`);
  CallScenario.parse(itScenario);
  console.log('✅ Workplace scenario is 100% Zod-validated!\n');

  console.log('====================================================');
  console.log('🎉 Phone call scenario test completed successfully!');
  console.log('====================================================');
  process.exit(0);
}

main().catch((err) => {
  console.error('Error running test:', err);
  process.exit(1);
});
