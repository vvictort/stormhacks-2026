import type { Repositories } from '../repositories.ts';
import { buildInsights, emptyInsights, rankLocally, summarize, type Insights, type TrainingSummary } from './analysis.ts';
import type { Snowflake } from './snowflake.ts';

const HOUR = 3_600_000;
/** Snowflake results (and the fallback when Snowflake isn't set up) are reused for hours; a fallback after a failure, briefly. */
const MAX_AGE = { settled: 6 * HOUR, retry: 60_000 };

export class InsightsService {
  private readonly inFlight = new Map<string, Promise<Insights>>();
  private readonly repo: Repositories['insights'];
  private readonly snowflake: Snowflake | null;
  constructor(repo: Repositories['insights'], snowflake: Snowflake | null) {
    this.repo = repo;
    this.snowflake = snowflake;
  }

  /** The user's vulnerability analysis: cached until they finish another attempt (or it ages out). */
  async get(uid: string): Promise<Insights> {
    const { cached, lastAttemptAt } = await this.repo.state(uid);
    if (cached && cached.lastAttemptAt === lastAttemptAt) {
      const maxAge = cached.source === 'fallback' && this.snowflake ? MAX_AGE.retry : MAX_AGE.settled;
      if (Date.now() - Date.parse(cached.computedAt) < maxAge) {
        const { lastAttemptAt: _, computedAt: __, ...insights } = cached;
        return insights;
      }
    }
    // One computation per user at a time (Home can mount twice).
    let pending = this.inFlight.get(uid);
    if (!pending) {
      pending = this.compute(uid, lastAttemptAt).finally(() => this.inFlight.delete(uid));
      this.inFlight.set(uid, pending);
    }
    return pending;
  }

  private async compute(uid: string, lastAttemptAt: string | null) {
    const summary = summarize(await this.repo.attemptRows(uid));
    if (!summary.overall.attempts) return emptyInsights();
    const insights = await this.viaSnowflake(uid, summary) ?? buildInsights(summary, rankLocally(summary), 'fallback');
    await this.repo.save(uid, insights, lastAttemptAt);
    return insights;
  }

  private async viaSnowflake(uid: string, summary: TrainingSummary) {
    if (!this.snowflake) return null;
    try {
      const { ranked, interp } = await this.snowflake.analyse(uid, summary, AbortSignal.timeout(this.snowflake.timeoutMs));
      // The focus is the same deterministic pick as the built-in analysis; Snowflake and Cortex only interpret around it.
      const insights = buildInsights(summary, ranked, 'snowflake', new Date(), interp);
      const text = await this.snowflake.cortexText(summary, ranked, interp, insights, AbortSignal.timeout(this.snowflake.cortexTimeoutMs));
      return text ? { ...insights, ...text, source: 'cortex' as const } : insights;
    } catch (error) {
      // Status codes and parse errors only: nothing here carries the token.
      console.warn('[insights] Snowflake analysis failed; using the built-in analysis:', error instanceof Error ? `${error.name}: ${error.message.slice(0, 160)}` : 'unknown');
      return null;
    }
  }
}
