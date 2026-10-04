import type { Repositories } from '../db/repositories.js';
import type { PersonalizationService } from './personalization_service.js';

export class AnalyticsService {
  constructor(private readonly repo: Repositories,private readonly personalization: PersonalizationService) {}
  async forUser(userId: string) {
    const history=await this.repo.history(userId);
    const profile=await this.personalization.profile(history);
    return {
      ...profile,
      finalizedCount:history.length,
      scoreHistory:history.filter((h) => h.classification!=='unknown' || (h.kind==='scam' && h.findings.some((f) => f.outcome!=='unknown')))
        .map((h) => ({attemptId:h.attemptId,assessedAt:h.assessedAt,score:h.score,channel:h.channel,difficulty:h.difficulty})),
    };
  }
}
