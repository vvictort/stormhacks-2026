import {
  fellForScam,
  type Difficulty,
  type ScamCategory,
} from "../shared/vocabulary.ts";

export type { ScamCategory };

export interface ScoredAttempt {
  scenarioId: string;
  scenarioTitle: string;
  /**
   * Stored with the attempt when known; otherwise inferred from the id and
   * title.
   */
  scamCategory?: ScamCategory | null;
  tactics: string[];
  success: boolean | null;
  outcome: string;
  completedAt: string;
  confidence?: string | null;
}

export type TacticMasteryState = "untouched" | "shaky" | "solid";

export interface TacticMastery {
  tactic: string;
  attempts: number;
  correct: number;
  accuracy: number; // 0 to 100
  confidentlyWrong: number;
  state: TacticMasteryState;
}

export const CORE_TACTICS = ["authority", "urgency", "fear", "reward"] as const;

export interface CategoryAccuracy {
  attempts: number;
  correct: number;
  accuracy: number; // 0 to 100
}

// Ordered: the first match wins, so specific pretexts come before broad ones.
const categoryRules: [ScamCategory, RegExp][] = [
  ["government", /\bcra\b|\birs\b|\btax|arrears|government/],
  ["shipping", /ship|deliver|parcel|package|customs|courier/],
  ["banking", /bank|\bcard|charge|financ/],
  ["account_security", /tech.?support|remote/],
  [
    "workplace",
    /\bexec|vendor|\bwork|helpdesk|\bit (support|department)|\bsso\b|employee|corporate|payroll/,
  ],
  ["promotional", /promo|reward|gift|prize|contest/],
];

export function inferCategory(scenario: {
  id: string;
  title: string;
}): ScamCategory {
  const text = `${scenario.id} ${scenario.title}`.toLowerCase();
  return (
    categoryRules.find(([, pattern]) => pattern.test(text))?.[0] ??
    "account_security"
  );
}

// ponytail: stats are recomputed from the newest 1000 attempts per request; aggregate in SQL if users ever exceed that.
export const HISTORY_LIMIT = 1000;

const levels: Difficulty[] = ["easy", "medium", "hard"];

/**
 * Up, down or stay after the attempt at `index`. Steps follow the last 5
 * results, so two old misses don't pin someone at easy forever.
 */
function difficultyStep(scored: ScoredAttempt[], index: number) {
  if (index < 2) return 0;

  const recent = scored.slice(Math.max(0, index - 4), index + 1);
  const recentRight = recent.filter((a) => a.success).length;
  const recentFell = recent.filter((a) => fellForScam(a.outcome)).length;
  if (recentRight / recent.length >= 0.85 && recentFell === 0) return 1;
  return recentFell >= 2 ? -1 : 0;
}

function masteryState(
  attempts: number,
  confidentlyWrong: number,
  accuracy: number,
): TacticMasteryState {
  if (attempts === 0) return "untouched";
  return confidentlyWrong > 0 || accuracy < 75 ? "shaky" : "solid";
}

/** Per tactic: every core tactic, plus any other the attempts used. */
function tacticMasteryOf(scored: ScoredAttempt[]) {
  const tacticStats = new Map<
    string,
    { attempts: number; correct: number; confidentlyWrong: number }
  >();
  for (const t of CORE_TACTICS) {
    tacticStats.set(t, { attempts: 0, correct: 0, confidentlyWrong: 0 });
  }

  for (const attempt of scored) {
    const isCertainWrong =
      attempt.success === false && attempt.confidence === "certain";
    for (const tactic of attempt.tactics) {
      const current = tacticStats.get(tactic) ?? {
        attempts: 0,
        correct: 0,
        confidentlyWrong: 0,
      };
      current.attempts++;
      if (attempt.success) current.correct++;
      if (isCertainWrong) current.confidentlyWrong++;
      tacticStats.set(tactic, current);
    }
  }

  const tacticMastery: Record<string, TacticMastery> = {};
  for (const [tactic, st] of tacticStats.entries()) {
    const accuracy =
      st.attempts > 0 ? Math.round((st.correct / st.attempts) * 100) : 0;
    tacticMastery[tactic] = {
      tactic,
      attempts: st.attempts,
      correct: st.correct,
      accuracy,
      confidentlyWrong: st.confidentlyWrong,
      state: masteryState(st.attempts, st.confidentlyWrong, accuracy),
    };
  }
  return tacticMastery;
}

/**
 * Stats, category accuracy, vulnerability and adaptive difficulty from a user's
 * attempts (any order).
 */
export function summarizeAttempts(attempts: ScoredAttempt[]) {
  // Unscored (error) attempts are listed elsewhere but never count for or
  // against the user.
  const scored = attempts
    .filter((a) => a.success !== null)
    .sort((a, b) => a.completedAt.localeCompare(b.completedAt));
  const categoryAccuracy: Partial<Record<ScamCategory, CategoryAccuracy>> = {};
  const weak = new Set<ScamCategory>();
  const tacticMisses = new Map<string, number>();
  let successes = 0;
  let compromised = 0;
  let difficulty: Difficulty = "easy";

  // Replayed in order so the weak-category hysteresis and difficulty steps
  // match a live update per attempt.
  for (const [index, attempt] of scored.entries()) {
    if (attempt.success) successes++;
    if (fellForScam(attempt.outcome)) {
      compromised++;
      for (const tactic of attempt.tactics) {
        tacticMisses.set(tactic, (tacticMisses.get(tactic) ?? 0) + 1);
      }
    }

    const category =
      attempt.scamCategory ??
      inferCategory({ id: attempt.scenarioId, title: attempt.scenarioTitle });
    const cat = (categoryAccuracy[category] ??= {
      attempts: 0,
      correct: 0,
      accuracy: 0,
    });
    cat.attempts++;
    if (attempt.success) cat.correct++;
    cat.accuracy = Math.round((cat.correct / cat.attempts) * 100);
    if (cat.accuracy < 75) weak.add(category);
    else if (cat.accuracy >= 80) weak.delete(category);

    const step = difficultyStep(scored, index);
    difficulty =
      levels[Math.min(2, Math.max(0, levels.indexOf(difficulty) + step))];
  }

  return {
    stats: { total: scored.length, successes, compromised },
    vulnerability: {
      weakCategories: [...weak],
      vulnerableTactics: [...tacticMisses]
        .sort((a, b) => b[1] - a[1])
        .map(([tactic]) => tactic),
      categoryAccuracy,
    },
    tacticMastery: tacticMasteryOf(scored),
    difficulty,
  };
}
