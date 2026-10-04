import { inferCategory } from "../training/progress.ts";
import {
  fellForScam,
  ScamCategory,
  Tactic,
  type Channel,
  type Difficulty,
} from "../shared/vocabulary.ts";

/**
 * One scored attempt with what TigerData's behaviour events add to it. No
 * message text, no transcript.
 */
export interface AttemptRow {
  channel: Channel;
  scenarioId: string;
  scenarioTitle: string;
  scamCategory: ScamCategory | null;
  difficulty: Difficulty;
  outcome: string;
  success: boolean;
  tactics: string[];
  completedAt: string;
  linkClicked: boolean;
  senderInspected: boolean;
  responseMs: number | null;
}

export interface Stats {
  attempts: number;
  correct: number;
  fellFor: number;
  /** Texts and emails only: reports and link clicks don't apply to calls. */
  messageAttempts: number;
  reported: number;
  linkClicks: number;
  senderChecks: number;
  avgResponseMs: number | null;
  /**
   * Accuracy of the older and newer half of the attempts (0 to 1), once there
   * are 4 or more.
   */
  earlierAccuracy: number | null;
  recentAccuracy: number | null;
}

export type Dimension = "category" | "tactic";
export interface AreaStats extends Stats {
  dimension: Dimension;
  area: string;
}

/**
 * Two tactics used together (`authority+urgency`, sorted) or a channel: only
 * Snowflake interprets these.
 */
export interface PatternStats extends Stats {
  dimension: "pair" | "channel";
  area: string;
}

/**
 * The pseudonymous aggregate summary of a user's training: the only thing
 * analysed (and sent to Snowflake).
 */
export interface TrainingSummary {
  overall: Stats;
  areas: AreaStats[];
  patterns: PatternStats[];
  byDifficulty: Record<Difficulty, { attempts: number; correct: number }>;
  /**
   * Average decision time on the attempts the user got right and on the ones
   * that fooled them.
   */
  responseMs: { correct: number | null; fellFor: number | null };
  /** The two tactics that most often appear together in missed attempts. */
  missedPair: [string, string] | null;
  /** Areas where the user fell for a scam twice or more. */
  repeatedMistakes: string[];
}

/**
 * One analysed area: Snowflake's result row, or the same numbers computed here.
 */
export interface RankedArea {
  dimension: Dimension;
  area: string;
  attempts: number;
  accuracy: number;
  weakness: number;
  trend: number | null;
  cohortSize?: number;
  /**
   * Share of other trainees less weak in this area (PERCENT_RANK over the
   * cohort).
   */
  cohortPercentile?: number;
}

/**
 * What Snowflake reads into the behaviour beyond the ranking (snowflake.ts
 * INTERPRET); the built-in analysis has none.
 */
export interface Interpretation {
  /**
   * The tactic pair missed most often (2+ attempts), with other trainees' miss
   * rate on it (a cohort of COHORT_MIN+ only).
   */
  weakPair: {
    tactics: [Tactic, Tactic];
    attempts: number;
    missed: number;
    cohortMissRate: number | null;
  } | null;
  /**
   * A tactic or channel always caught, and decided faster than the user's own
   * average.
   */
  quickCatch: { dimension: "tactic" | "channel"; area: string } | null;
}

export interface Insights {
  strongestAreas: string[];
  weakAreas: string[];
  behavioralPattern: string;
  recommendation: string;
  nextTrainingFocus: ScamCategory[];
  /**
   * Who wrote this: Cortex (text over Snowflake's results), Snowflake (computed
   * there, text from here) or built in.
   */
  source: "cortex" | "snowflake" | "fallback";
  generatedAt: string;
  basedOn: { attempts: number };
}

const count = <T>(list: T[], test: (item: T) => boolean) =>
  list.filter(test).length;
const average = (values: number[]) =>
  values.length
    ? Math.round(values.reduce((a, b) => a + b, 0) / values.length)
    : null;
const accuracyOf = (list: AttemptRow[]) =>
  count(list, (r) => r.success) / list.length;

function stats(list: AttemptRow[]): Stats {
  const messages = list.filter((r) => r.channel !== "call");
  const half = Math.floor(list.length / 2);
  return {
    attempts: list.length,
    correct: count(list, (r) => r.success),
    fellFor: count(list, (r) => fellForScam(r.outcome)),
    messageAttempts: messages.length,
    reported: count(messages, (r) => r.outcome.startsWith("reported_")),
    linkClicks: count(messages, (r) => r.linkClicked),
    senderChecks: count(messages, (r) => r.senderInspected),
    avgResponseMs: average(list.flatMap((r) => r.responseMs ?? [])),
    earlierAccuracy: list.length >= 4 ? accuracyOf(list.slice(0, half)) : null,
    recentAccuracy: list.length >= 4 ? accuracyOf(list.slice(half)) : null,
  };
}

/** Aggregates scored attempts (any order) per scam category and per tactic. */
export function summarize(rows: AttemptRow[]): TrainingSummary {
  const ordered = [...rows].sort((a, b) =>
    a.completedAt.localeCompare(b.completedAt),
  );
  const groups = new Map<string, AttemptRow[]>();
  const add = (key: string, row: AttemptRow) => {
    groups.set(key, [...(groups.get(key) ?? []), row]);
  };
  const patterns = new Map<string, AttemptRow[]>();
  const addPattern = (key: string, row: AttemptRow) => {
    patterns.set(key, [...(patterns.get(key) ?? []), row]);
  };
  const pairs = new Map<string, number>();

  for (const row of ordered) {
    add(
      `category:${row.scamCategory ?? inferCategory({ id: row.scenarioId, title: row.scenarioTitle })}`,
      row,
    );
    addPattern(`channel:${row.channel}`, row);
    const tactics = [...new Set(row.tactics)]
      .filter((t) => Tactic.safeParse(t).success)
      .sort();
    for (const tactic of tactics) add(`tactic:${tactic}`, row);
    for (const [i, a] of tactics.entries()) {
      for (const b of tactics.slice(i + 1)) {
        addPattern(`pair:${a}+${b}`, row);
        if (!row.success) {
          pairs.set(`${a}+${b}`, (pairs.get(`${a}+${b}`) ?? 0) + 1);
        }
      }
    }
  }

  const areas = [...groups].map(([key, list]) => {
    const [dimension, area] = key.split(":") as [Dimension, string];
    return { dimension, area, ...stats(list) };
  });
  const level = (difficulty: Difficulty) => {
    const list = ordered.filter((r) => r.difficulty === difficulty);
    return { attempts: list.length, correct: count(list, (r) => r.success) };
  };
  const [topPair] = [...pairs].sort((a, b) => b[1] - a[1]);

  return {
    overall: stats(ordered),
    areas,
    patterns: [...patterns].map(([key, list]) => {
      const [dimension, area] = key.split(":") as [
        PatternStats["dimension"],
        string,
      ];
      return { dimension, area, ...stats(list) };
    }),
    byDifficulty: {
      easy: level("easy"),
      medium: level("medium"),
      hard: level("hard"),
    },
    responseMs: {
      correct: average(
        ordered.filter((r) => r.success).flatMap((r) => r.responseMs ?? []),
      ),
      fellFor: average(
        ordered
          .filter((r) => fellForScam(r.outcome))
          .flatMap((r) => r.responseMs ?? []),
      ),
    },
    missedPair: topPair ? (topPair[0].split("+") as [string, string]) : null,
    repeatedMistakes: areas.filter((a) => a.fellFor >= 2).map((a) => a.area),
  };
}

/**
 * 0 (solid) to 1 (weak): the smoothed miss rate, plus falling for it, plus
 * clicking links in messages. Snowflake computes the same formula in SQL
 * (snowflake.ts), so both sources rank areas alike.
 */
export const weakness = (s: Stats) =>
  0.6 * (1 - (s.correct + 1) / (s.attempts + 2)) +
  0.3 * (s.fellFor / s.attempts) +
  0.1 * (s.messageAttempts ? s.linkClicks / s.messageAttempts : 0);

export const rankLocally = (summary: TrainingSummary): RankedArea[] =>
  summary.areas.map((a) => ({
    dimension: a.dimension,
    area: a.area,
    attempts: a.attempts,
    accuracy: a.correct / a.attempts,
    weakness: weakness(a),
    trend:
      a.recentAccuracy !== null && a.earlierAccuracy !== null
        ? a.recentAccuracy - a.earlierAccuracy
        : null,
  }));

const categoryLabels: Record<ScamCategory, string> = {
  banking: "bank scams",
  government: "government impersonation",
  shipping: "delivery scams",
  account_security: "account security scams",
  workplace: "workplace scams",
  promotional: "prize and promo scams",
};

const tacticLabels: Record<Tactic, string> = {
  urgency: "urgency pressure",
  authority: "authority pressure",
  suspicious_link: "suspicious links",
  otp_request: "requests for a code",
  info_request: "requests for personal details",
  reward: "promised rewards",
  fear: "threats",
};

const tacticWords: Record<Tactic, string> = {
  urgency: "urgency",
  authority: "authority",
  suspicious_link: "a link",
  otp_request: "a code request",
  info_request: "a request for details",
  reward: "a reward",
  fear: "a threat",
};

const tips: Record<Tactic, string> = {
  urgency:
    "When a message says you must act now, pause and check through a number or app you already trust.",
  authority:
    'A big title is not proof: confirm "the bank", "the CRA" or "your CEO" through a contact you look up yourself.',
  suspicious_link:
    "Read where a link really goes before you tap, and reach your accounts by typing the address yourself.",
  otp_request:
    "No real bank or service will ever ask you to read back a one-time code.",
  info_request:
    "Treat any unexpected request for personal details as a red flag, however friendly it sounds.",
  reward:
    "If you didn't enter, you didn't win: a prize that costs a fee is a scam.",
  fear: "Threats of arrest or fines are pressure, not process. Hang up and check independently.",
};

const channelLabels: Record<Channel, string> = {
  sms: "scam texts",
  email: "scam emails",
  call: "scam calls",
};

export const areaLabel = (a: {
  dimension: Dimension | "channel";
  area: string;
}) =>
  a.dimension === "category"
    ? categoryLabels[a.area as ScamCategory]
    : a.dimension === "channel"
      ? channelLabels[a.area as Channel]
      : tacticLabels[a.area as Tactic];

/** "authority combined with urgency" */
export const pairLabel = ([a, b]: [Tactic, Tactic]) =>
  `${tacticWords[a]} combined with ${tacticWords[b]}`;

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const list = (items: string[]) =>
  items.length < 2
    ? items.join("")
    : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
const pct = (n: number, d: number) => (d ? n / d : 0);

const WEAK = 0.4;
const STRONG = 0.25;
export const COHORT_MIN = 5;

/**
 * The contract's analysis from ranked areas (Snowflake's or local), with
 * backend-written text.
 */
export function buildInsights(
  summary: TrainingSummary,
  ranked: RankedArea[],
  source: Insights["source"],
  now = new Date(),
  interp: Interpretation | null = null,
): Insights {
  const weak = ranked
    .filter((r) => r.weakness >= WEAK)
    .sort((a, b) => b.weakness - a.weakness);
  const strong = ranked
    .filter((r) => r.weakness <= STRONG && r.accuracy >= 0.75)
    .sort((a, b) => a.weakness - b.weakness || b.attempts - a.attempts);
  const { overall } = summary;
  const checksSender =
    overall.messageAttempts >= 2 &&
    pct(overall.senderChecks, overall.messageAttempts) >= 0.5;

  const categories = ranked.filter((r) => r.dimension === "category");
  const weakCategories = weak
    .filter((r) => r.dimension === "category")
    .map((r) => r.area as ScamCategory);
  const untried = ScamCategory.options.filter(
    (c) => !categories.some((r) => r.area === c),
  );
  const weakest = [...categories].sort((a, b) => b.weakness - a.weakness)[0]
    ?.area as ScamCategory | undefined;
  const focus = [...weakCategories, ...untried].slice(0, 3);
  const nextTrainingFocus = focus.length ? focus : weakest ? [weakest] : [];

  const pair = summary.missedPair;
  const weakPair = interp?.weakPair;
  const struggle = weakPair
    ? `${pairLabel(weakPair.tactics)} still causes mistakes: ${weakPair.missed} of ${weakPair.attempts} times${weakPair.cohortMissRate === null ? "" : `, against ${Math.round(weakPair.cohortMissRate * 100)}% for other trainees`}`
    : pair
      ? `you struggle when ${tacticWords[pair[0] as Tactic]} and ${tacticWords[pair[1] as Tactic]} are combined`
      : weak[0]
        ? `you struggle with ${areaLabel(weak[0])}`
        : null;
  const opening = interp?.quickCatch
    ? `You catch ${areaLabel(interp.quickCatch)} quickly`
    : strong[0]
      ? `You consistently see through ${struggle ? areaLabel(strong[0]) : list(strong.slice(0, 2).map(areaLabel))}`
      : null;

  const sentences = [
    opening && struggle
      ? `${opening}, but ${struggle}.`
      : opening
        ? `${opening}.`
        : struggle
          ? `${capital(struggle)}.`
          : "Your results are mixed so far, with no clear weak spot yet.",
  ];

  const behind = weak.find(
    (r) =>
      (r.cohortSize ?? 0) >= COHORT_MIN && (r.cohortPercentile ?? 0) >= 0.6,
  );
  const ahead = strong.find(
    (r) =>
      (r.cohortSize ?? 0) >= COHORT_MIN && (r.cohortPercentile ?? 1) <= 0.3,
  );
  if (behind) {
    sentences.push(
      `Compared with other trainees, you're weaker than most on ${areaLabel(behind)}.`,
    );
  } else if (ahead) {
    sentences.push(
      `Compared with other trainees, you're ahead of most on ${areaLabel(ahead)}.`,
    );
  }

  const { correct: rightMs, fellFor: fooledMs } = summary.responseMs;
  const { easy, hard } = summary.byDifficulty;
  const trend =
    overall.recentAccuracy !== null && overall.earlierAccuracy !== null
      ? overall.recentAccuracy - overall.earlierAccuracy
      : 0;
  if (rightMs && fooledMs && fooledMs < 0.7 * rightMs) {
    sentences.push(
      "You decide faster on the ones that fool you, so slowing down is your best defence.",
    );
  } else if (
    hard.attempts >= 2 &&
    pct(hard.correct, hard.attempts) < 0.5 &&
    easy.attempts &&
    pct(easy.correct, easy.attempts) >= 0.75
  ) {
    sentences.push(
      "You handle the obvious ones well, but the more convincing scams still get through.",
    );
  } else if (trend >= 0.15) {
    sentences.push(
      "Your recent attempts are more accurate than your early ones.",
    );
  } else if (trend <= -0.15) {
    sentences.push(
      "Your recent attempts have slipped a little, so take the next few slowly.",
    );
  }

  const tip = (weak.find((r) => r.dimension === "tactic")?.area ??
    pair?.[0]) as Tactic | undefined;
  const plan = weakCategories.length
    ? `Your next training should focus on ${list(weakCategories.slice(0, 2).map((c) => categoryLabels[c]))}.`
    : untried.length
      ? `Next, try ${list(untried.slice(0, 2).map((c) => categoryLabels[c]))}: chatisthisreal hasn't seen you handle those yet.`
      : weakest
        ? `Keep practising ${categoryLabels[weakest]} at a harder level.`
        : "";

  return {
    strongestAreas: [
      ...strong.map(areaLabel),
      ...(checksSender ? ["checking who a message is really from"] : []),
    ]
      .slice(0, 3)
      .map(capital),
    weakAreas: weak.slice(0, 3).map(areaLabel).map(capital),
    behavioralPattern: sentences.slice(0, 3).join(" "),
    recommendation: [plan, tip && tips[tip]].filter(Boolean).join(" "),
    nextTrainingFocus,
    source,
    generatedAt: now.toISOString(),
    basedOn: { attempts: overall.attempts },
  };
}

export const emptyInsights = (now = new Date()): Insights => ({
  strongestAreas: [],
  weakAreas: [],
  behavioralPattern: "chatisthisreal hasn't seen you handle a scam yet.",
  recommendation:
    "Try a few scenarios and you'll see what you catch, and what catches you.",
  nextTrainingFocus: [],
  source: "fallback",
  generatedAt: now.toISOString(),
  basedOn: { attempts: 0 },
});
