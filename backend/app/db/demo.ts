import { randomUUID } from 'node:crypto';
import { loadConfig } from '../core/config.js';
import { createDatabase } from './database.js';
import { migrate } from './migrate.js';
import { seedPatterns } from './seed.js';
import { Repositories } from './repositories.js';
import { PersonalizationService } from '../services/personalization_service.js';
import { AnalyticsService } from '../services/analytics_service.js';
import { preferencesSchema } from '../schemas/user.js';
import type { Tactic } from '../schemas/domain.js';

// Fixture-only demonstration. This is not mounted as an authenticated web route.
const config = loadConfig();
const db = createDatabase(config.DATABASE_URL);
const repo = new Repositories(db);
const personalization = new PersonalizationService(config.PERSONALIZATION_URL, config.PERSONALIZATION_SERVICE_KEY);
try {
  await migrate(db);
  await seedPatterns(db);
  const patterns = await repo.patterns();
  const players = [];
  for (const tactic of ['urgency', 'authority'] as Tactic[]) {
    const identity = `fixture:${tactic}:${randomUUID()}`;
    const user = await repo.saveUser(identity, preferencesSchema.parse({ name: `Demo ${tactic}`, profession: 'student', interests: ['shopping'], enabledChannels: ['text', 'email', 'call'] }));
    const pattern = patterns.find((p) => p.kind === 'scam' && p.channel === 'text' && p.tactics.includes(tactic))!;
    const session = await repo.startSession(user.id, 0);
    for (let n = 0; n < 3; n++) {
      const attempt = await repo.reserveAttempt(user.id, session.id, {
        patternId: pattern.id, channel: pattern.channel, difficulty: 'beginner', targetedTactics: [tactic],
        explanation: 'Fixture training history', engineVersion: 'rules-v1', randomSeed: n,
      });
      if (!attempt) throw new Error('Fixture reservation failed');
      await repo.publishAttempt(user.id, attempt.id, { title: 'Fixture challenge', sender: 'Demo sender', openingText: pattern.example });
      await repo.appendEvent(user.id, attempt.id, { eventId: randomUUID(), action: 'accepted', occurredAt: new Date().toISOString(), metadata: {} });
      await repo.finalizeAssessment(user.id, { attemptId: attempt.id, rubricVersion: 'fixture-v1', score: 20, classification: 'incorrect', findings: [{ tactic, outcome: 'missed', evidence: 'Fixture: accepted without verification' }], feedback: 'Verify the sender independently.' });
      await repo.acknowledgeFeedback(user.id, attempt.id, 0);
    }
    const recovered = await repo.requireUser(identity);
    const history = await repo.history(recovered.id);
    const profile = await personalization.profile(history);
    players.push({ user: recovered, history, profile });
  }
  let recommendations;
  for (let seed = 0; seed < 100; seed++) {
    recommendations = await Promise.all(players.map(({ user, history, profile }) => personalization.recommend({ history, profile, enabledChannels: user.enabledChannels, profession: user.profession, interests: user.interests, candidatePatterns: patterns, recentPatternIds: [], randomSeed: seed })));
    if (recommendations[0]!.targetedTactics.includes('urgency') && recommendations[1]!.targetedTactics.includes('authority')) break;
  }
  const analytics = new AnalyticsService(repo, personalization);
  for (const [index, player] of players.entries()) {
    console.info(JSON.stringify({ userId: player.user.id, name: player.user.name, recommendation: recommendations![index], analytics: await analytics.forUser(player.user.id) }, null, 2));
  }
} finally {
  await db.end();
}
