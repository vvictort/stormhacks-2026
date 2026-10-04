import { z } from 'zod';
import { AppError } from '../core/errors.js';
import { profileRequestSchema,profileSchema,recommendRequestSchema,recommendationSchema,type RecommendRequest } from '../schemas/personalization.js';
import type { HistoryEntry } from '../schemas/attempt.js';

export class PersonalizationService {
  constructor(private readonly url: string, private readonly key: string, private readonly fetcher: typeof fetch=fetch, private readonly timeoutMs=5000) {}

  private async call<T>(path: string,input: unknown,schema: z.ZodType<T>): Promise<T> {
    try {
      const response=await this.fetcher(`${this.url.replace(/\/$/,'')}${path}`,{
        method:'POST',headers:{'Content-Type':'application/json','X-Service-Key':this.key},
        body:JSON.stringify(input),signal:AbortSignal.timeout(this.timeoutMs),
      });
      if (!response.ok) throw new Error('Personalization rejected request');
      return schema.parse(await response.json());
    } catch {
      throw new AppError(503,'PERSONALIZATION_UNAVAILABLE','Personalization is temporarily unavailable; retry later.');
    }
  }
  profile(history: HistoryEntry[]) {
    return this.call('/v1/profile',profileRequestSchema.parse({history}),profileSchema);
  }
  async recommend(input: RecommendRequest) {
    const request=recommendRequestSchema.parse(input);
    const result=await this.call('/v1/recommend',request,recommendationSchema);
    const pattern=request.candidatePatterns.find((p) => p.id===result.patternId);
    if (!pattern || pattern.channel!==result.channel || !request.enabledChannels.includes(result.channel)
      || result.randomSeed!==request.randomSeed || result.difficulty!==request.profile.currentDifficulty
      || result.targetedTactics.some((t) => !pattern.tactics.includes(t))) {
      throw new AppError(503,'INVALID_RECOMMENDATION','Personalization returned an invalid recommendation.');
    }
    return result;
  }
}
