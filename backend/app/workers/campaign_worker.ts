import type { Repositories } from '../db/repositories.js';
import type { SimulationService } from '../services/simulation_service.js';
import type { ScenarioGenerator } from '../services/ai_service.js';
import type { User } from '../schemas/user.js';

// Gameplay coordinator invokes tick for active, due sessions. No real-phone delivery.
// Reservation happens before generation; concurrent ticks cannot generate two attempts.
export class CampaignWorker {
  constructor(private readonly repo:Repositories,private readonly simulation:SimulationService,private readonly generator:ScenarioGenerator) {}
  async tick(user:User,sessionId:string,now=new Date()) {
    const next=await this.simulation.next(user,sessionId,undefined,now);
    if (!next) return null;
    try {
      const scenario=await this.generator.generate({attemptId:next.attempt.id,user,pattern:next.pattern,recommendation:next.recommendation});
      await this.repo.publishAttempt(user.id,next.attempt.id,scenario);
    } catch (error) {
      await this.repo.abandonAttempt(user.id,next.attempt.id,true);
      throw error;
    }
    const session=await this.repo.currentSession(user.id);
    return session?.status==='active' ? this.repo.publicAttempt(user.id,next.attempt.id) : null;
  }
}
