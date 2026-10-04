import {
  generateCallScenario,
  startCommsCallSimulation,
  type GenerateCallScenarioOptions,
} from '../integrations/gemini.ts';
import type { CallScenario } from '../../comms/src/types.ts';

export class VoiceSimulationService {
  private commsBaseUrl: string;

  constructor(commsBaseUrl = process.env.COMMS_BASE_URL || 'http://localhost:3001/comms') {
    this.commsBaseUrl = commsBaseUrl;
  }

  /**
   * Use Gemini to generate a personalized call scam scenario tailored to the trainee.
   */
  async createScenario(options?: GenerateCallScenarioOptions): Promise<CallScenario> {
    return generateCallScenario(options);
  }

  /**
   * Generate a scenario with Gemini and immediately start the call on the comms server.
   */
  async startSimulation(userId: string, options?: GenerateCallScenarioOptions) {
    const scenario = await this.createScenario(options);
    const result = await startCommsCallSimulation(this.commsBaseUrl, userId, scenario);
    return {
      scenario,
      ...result,
    };
  }
}

export const voiceSimulationService = new VoiceSimulationService();
