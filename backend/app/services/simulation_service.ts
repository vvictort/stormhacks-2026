import { randomInt } from 'node:crypto';
import type { Repositories } from '../db/repositories.js';
import type { PersonalizationService } from './personalization_service.js';
import type { User } from '../schemas/user.js';

export const arrivalDelayMs = () => randomInt(15,46)*1000;

export class SimulationService {
  constructor(private readonly repo: Repositories,private readonly personalization: PersonalizationService) {}
  async next(user: User,sessionId: string,randomSeed=randomInt(2147483648),now=new Date()) {
    const session=await this.repo.currentSession(user.id);
    if (!session || session.id!==sessionId || session.status!=='active' || session.activeAttemptId || !session.nextArrivalAt || new Date(session.nextArrivalAt)>now) return null;
    const [history,patterns,recentPatternIds]=await Promise.all([this.repo.history(user.id),this.repo.patterns(),this.repo.recentPatterns(user.id)]);
    const profile=await this.personalization.profile(history);
    const candidatePatterns=patterns.filter((p) => user.enabledChannels.includes(p.channel));
    const recommendation=await this.personalization.recommend({history,profile,enabledChannels:user.enabledChannels,profession:user.profession,interests:user.interests,candidatePatterns,recentPatternIds,randomSeed});
    const attempt=await this.repo.reserveAttempt(user.id,sessionId,recommendation,now);
    if (!attempt) return null;
    return {attempt,pattern:patterns.find((p) => p.id===recommendation.patternId)!,recommendation};
  }
  start(userId:string) { return this.repo.startSession(userId,arrivalDelayMs()); }
  pause(userId:string,sessionId:string) { return this.repo.setSessionStatus(userId,sessionId,'paused',arrivalDelayMs()); }
  resume(userId:string,sessionId:string) { return this.repo.setSessionStatus(userId,sessionId,'active',arrivalDelayMs()); }
  end(userId:string,sessionId:string) { return this.repo.endSession(userId,sessionId); }
  acknowledge(userId:string,attemptId:string) { return this.repo.acknowledgeFeedback(userId,attemptId,arrivalDelayMs()); }
}
