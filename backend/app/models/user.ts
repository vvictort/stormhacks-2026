import {
  COMPROMISING_SIGNALS,
  type CallRecord,
  type TextThread,
  type Signal,
  type Outcome,
  type Tactic,
} from '../../comms/src/types.ts';

export type DifficultyLevel = 'beginner' | 'intermediate' | 'advanced';

export type ScamCategory =
  | 'banking'
  | 'shipping'
  | 'account_security'
  | 'workplace'
  | 'promotional';

export interface UserStats {
  totalDrillsCompleted: number;  // Across all channels (emails, calls, texts)
  correctIdentifications: number; // Correctly guessed scam or resisted
  timesCompromised: number;       // Fell for a scam (e.g. clicked link or disclosed code/card)
  falsePositives: number;         // Flagged a legit email/call as a scam
  overallResilienceScore: number; // 0 to 100 rating
}

export interface CategoryAccuracy {
  attempts: number;
  correct: number;
  accuracy: number; // 0 to 100 percentage
}

export function createInitialCategoryAccuracy(): Record<ScamCategory, CategoryAccuracy> {
  return {
    banking: { attempts: 0, correct: 0, accuracy: 100 },
    shipping: { attempts: 0, correct: 0, accuracy: 100 },
    account_security: { attempts: 0, correct: 0, accuracy: 100 },
    workplace: { attempts: 0, correct: 0, accuracy: 100 },
    promotional: { attempts: 0, correct: 0, accuracy: 100 },
  };
}

export interface EmailVulnerabilityProfile {
  totalEvaluated: number;
  correctIdentifications: number;
  timesCompromised: number;
  falsePositives: number;
  accuracyRate: number; // 0 to 100
  weakCategories: ScamCategory[];
  frequentBlindSpots: string[]; // e.g. "spoofed_domain", "artificial_urgency"
  categoryAccuracy: Record<ScamCategory, CategoryAccuracy>;
}

export interface CallSimulationOutcome {
  callId: string;
  scenarioTitle: string;
  scenarioId?: string;
  outcome: Outcome;
  signals: Signal[];
  durationSecs?: number;
  at: string;
}

export interface CallVulnerabilityProfile {
  totalCalls: number;
  callsResisted: number;
  callsCompromised: number;
  callsReportedOrChallenged: number;
  callsDeclinedOrMissed: number;
  averageDurationSecs: number;
  totalDurationSecs: number;
  // Specific tactics where the user gave in (e.g. 'otp_request', 'authority', 'fear')
  vulnerableTactics: (Tactic | string)[];
  // Breakdown of observed signals (e.g. shared_code: 2, challenged: 1)
  signalsObserved: Partial<Record<Signal, number>>;
  // Specific compromising signals the user triggered (e.g. 'shared_code', 'shared_payment_info')
  compromisingSignalsTriggered: Signal[];
  recentOutcomes: CallSimulationOutcome[];
}

export interface TextVulnerabilityProfile {
  totalThreads: number;
  threadsResisted: number;
  threadsCompromised: number;
  linkClicks: number;
  reported: number;
  vulnerableTactics: (Tactic | string)[];
  signalsObserved: Partial<Record<Signal, number>>;
  compromisingSignalsTriggered: Signal[];
}

export interface UserVulnerabilityProfile {
  weakCategories: ScamCategory[];
  frequentBlindSpots: string[];
  categoryAccuracy: Record<ScamCategory, CategoryAccuracy>;

  emails: EmailVulnerabilityProfile;
  calls: CallVulnerabilityProfile;
  texts: TextVulnerabilityProfile;
}

export function createInitialEmailProfile(): EmailVulnerabilityProfile {
  return {
    totalEvaluated: 0,
    correctIdentifications: 0,
    timesCompromised: 0,
    falsePositives: 0,
    accuracyRate: 100,
    weakCategories: [],
    frequentBlindSpots: [],
    categoryAccuracy: createInitialCategoryAccuracy(),
  };
}

export function createInitialCallProfile(): CallVulnerabilityProfile {
  return {
    totalCalls: 0,
    callsResisted: 0,
    callsCompromised: 0,
    callsReportedOrChallenged: 0,
    callsDeclinedOrMissed: 0,
    averageDurationSecs: 0,
    totalDurationSecs: 0,
    vulnerableTactics: [],
    signalsObserved: {},
    compromisingSignalsTriggered: [],
    recentOutcomes: [],
  };
}

export function createInitialTextProfile(): TextVulnerabilityProfile {
  return {
    totalThreads: 0,
    threadsResisted: 0,
    threadsCompromised: 0,
    linkClicks: 0,
    reported: 0,
    vulnerableTactics: [],
    signalsObserved: {},
    compromisingSignalsTriggered: [],
  };
}

export interface User {
  id: string;
  name: string;
  email: string;
  role?: string;                  // e.g. "Finance Analyst", "Software Engineer", "HR Specialist"
  company?: string;
  currentDifficulty: DifficultyLevel;
  stats: UserStats;
  vulnerabilityProfile: UserVulnerabilityProfile;
  createdAt: string;
  updatedAt: string;
}

// ponytail: in-memory, per-process and lost on restart; persist to Postgres (see app/db) once this is wired into the API.
const usersStore = new Map<string, User>();

export function createUser(params: {
  id?: string;
  name: string;
  email: string;
  role?: string;
  company?: string;
  difficulty?: DifficultyLevel;
}): User {
  const now = new Date().toISOString();
  const user: User = {
    id: params.id || `user_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    name: params.name,
    email: params.email,
    role: params.role || 'Employee',
    company: params.company || 'Organization',
    currentDifficulty: params.difficulty || 'beginner',
    stats: {
      totalDrillsCompleted: 0,
      correctIdentifications: 0,
      timesCompromised: 0,
      falsePositives: 0,
      overallResilienceScore: 100,
    },
    vulnerabilityProfile: {
      weakCategories: [],
      frequentBlindSpots: [],
      categoryAccuracy: createInitialCategoryAccuracy(),
      emails: createInitialEmailProfile(),
      calls: createInitialCallProfile(),
      texts: createInitialTextProfile(),
    },
    createdAt: now,
    updatedAt: now,
  };

  usersStore.set(user.id, user);
  return user;
}

export function getUser(userId: string): User | undefined {
  return usersStore.get(userId);
}

export function saveUser(user: User): User {
  user.updatedAt = new Date().toISOString();
  usersStore.set(user.id, user);
  return user;
}

function recalculateResilienceScore(user: User): number {
  if (user.stats.totalDrillsCompleted === 0) return 100;
  const accuracyRate = user.stats.correctIdentifications / user.stats.totalDrillsCompleted;
  const compromisePenalty = user.stats.timesCompromised * 15;
  const falsePositivePenalty = user.stats.falsePositives * 5;
  const baseScore = Math.round(accuracyRate * 100);
  return Math.max(0, Math.min(100, baseScore - compromisePenalty - falsePositivePenalty));
}

function updateAdaptiveDifficulty(user: User) {
  if (user.stats.totalDrillsCompleted >= 3) {
    const accuracyRate = user.stats.correctIdentifications / user.stats.totalDrillsCompleted;
    if (accuracyRate >= 0.85 && user.stats.timesCompromised === 0) {
      if (user.currentDifficulty === 'beginner') user.currentDifficulty = 'intermediate';
      else if (user.currentDifficulty === 'intermediate') user.currentDifficulty = 'advanced';
    } else if (user.stats.timesCompromised >= 2) {
      if (user.currentDifficulty === 'advanced') user.currentDifficulty = 'intermediate';
      else if (user.currentDifficulty === 'intermediate') user.currentDifficulty = 'beginner';
    }
  }
}

function inferCategoryFromScenario(scenario: { id: string; title: string }): ScamCategory {
  const text = `${scenario.id} ${scenario.title}`.toLowerCase();
  if (text.includes('bank') || text.includes('card') || text.includes('charge') || text.includes('finance')) {
    return 'banking';
  }
  if (text.includes('ship') || text.includes('delivery') || text.includes('parcel') || text.includes('package') || text.includes('customs')) {
    return 'shipping';
  }
  if (text.includes('work') || text.includes('it ') || text.includes('helpdesk') || text.includes('sso') || text.includes('employee') || text.includes('corporate')) {
    return 'workplace';
  }
  if (text.includes('promo') || text.includes('reward') || text.includes('gift') || text.includes('prize') || text.includes('contest')) {
    return 'promotional';
  }
  return 'account_security';
}

export function recordUserDecision(params: {
  userId: string;
  isScam: boolean;
  userGuessedScam: boolean;
  category: ScamCategory;
  redFlags?: string[];
}): { user: User; isCorrect: boolean; feedbackMessage: string } {
  const user = usersStore.get(params.userId);
  if (!user) {
    throw new Error(`User with ID ${params.userId} not found.`);
  }

  const isCorrect = params.isScam === params.userGuessedScam;
  user.stats.totalDrillsCompleted += 1;

  const emailProfile = user.vulnerabilityProfile.emails;
  emailProfile.totalEvaluated += 1;

  if (isCorrect) {
    user.stats.correctIdentifications += 1;
    emailProfile.correctIdentifications += 1;
  } else {
    if (params.isScam && !params.userGuessedScam) {
      user.stats.timesCompromised += 1;
      emailProfile.timesCompromised += 1;
      if (params.redFlags && params.redFlags.length > 0) {
        const flag = params.redFlags[0];
        if (!user.vulnerabilityProfile.frequentBlindSpots.includes(flag)) {
          user.vulnerabilityProfile.frequentBlindSpots.push(flag);
        }
        if (!emailProfile.frequentBlindSpots.includes(flag)) {
          emailProfile.frequentBlindSpots.push(flag);
        }
      }
    } else if (!params.isScam && params.userGuessedScam) {
      user.stats.falsePositives += 1;
      emailProfile.falsePositives += 1;
    }
  }

  emailProfile.accuracyRate = Math.round(
    (emailProfile.correctIdentifications / emailProfile.totalEvaluated) * 100
  );

  const catStats = user.vulnerabilityProfile.categoryAccuracy[params.category];
  catStats.attempts += 1;
  if (isCorrect) catStats.correct += 1;
  catStats.accuracy = Math.round((catStats.correct / catStats.attempts) * 100);
  emailProfile.categoryAccuracy[params.category] = { ...catStats };

  if (catStats.accuracy < 75 && !user.vulnerabilityProfile.weakCategories.includes(params.category)) {
    user.vulnerabilityProfile.weakCategories.push(params.category);
    if (!emailProfile.weakCategories.includes(params.category)) {
      emailProfile.weakCategories.push(params.category);
    }
  } else if (catStats.accuracy >= 80) {
    user.vulnerabilityProfile.weakCategories = user.vulnerabilityProfile.weakCategories.filter(
      (c) => c !== params.category
    );
    emailProfile.weakCategories = emailProfile.weakCategories.filter((c) => c !== params.category);
  }

  user.stats.overallResilienceScore = recalculateResilienceScore(user);
  updateAdaptiveDifficulty(user);

  saveUser(user);

  const feedbackMessage = isCorrect
    ? `Correct! You accurately identified this as ${params.isScam ? 'a SCAM' : 'LEGITIMATE'}.`
    : params.isScam
    ? `Incorrect! You fell for this scam. It was a phishing attempt in ${params.category}.`
    : `Incorrect! This was a legitimate email from an authentic sender.`;

  return { user, isCorrect, feedbackMessage };
}

export type CommsReportInput =
  | CallRecord
  | TextThread
  | { call: CallRecord }
  | { thread: TextThread };

export interface CommsReportResult {
  user: User;
  channel: 'call' | 'text';
  simulationId: string;
  outcome: Outcome;
  isCompromised: boolean;
  signals: Signal[];
  vulnerableTacticsAdded: (Tactic | string)[];
  resilienceScore: number;
  feedbackMessage: string;
}

function addUnique<T>(list: T[], item: T): boolean {
  if (list.includes(item)) return false;
  list.push(item);
  return true;
}

export function updateUserFromCommsReport(report: CommsReportInput): CommsReportResult {
  const call = 'call' in report ? report.call
    : 'thread' in report ? undefined
    : 'callerLabel' in report.scenario || 'transcript' in report ? (report as CallRecord) : undefined;
  const sim: CallRecord | TextThread = call ?? ('thread' in report ? report.thread : (report as TextThread));
  const channel = call ? 'call' : 'text';

  const user = usersStore.get(sim.userId);
  if (!user) {
    throw new Error(`Cannot update comms report: User with ID "${sim.userId}" not found.`);
  }

  const { calls, texts } = user.vulnerabilityProfile;
  const profile = call ? calls : texts;
  const scenario = sim.scenario;
  const signals = sim.signals || [];
  const compromising = signals.filter((s) => COMPROMISING_SIGNALS.includes(s));
  const isCompromised = sim.outcome === 'compromised' || compromising.length > 0;
  const outcome: Outcome = isCompromised ? 'compromised' : sim.outcome || 'resisted';
  const newlyAddedTactics: (Tactic | string)[] = [];

  if (call) calls.totalCalls += 1;
  else texts.totalThreads += 1;
  for (const sig of signals) profile.signalsObserved[sig] = (profile.signalsObserved[sig] || 0) + 1;
  user.stats.totalDrillsCompleted += 1;

  if (isCompromised) {
    user.stats.timesCompromised += 1;
    for (const tactic of scenario.tactics) {
      if (addUnique(profile.vulnerableTactics, tactic)) newlyAddedTactics.push(tactic);
      addUnique(user.vulnerabilityProfile.frequentBlindSpots, tactic);
    }
  }

  if (call) {
    if (isCompromised) {
      calls.callsCompromised += 1;
      for (const sig of compromising) addUnique(calls.compromisingSignalsTriggered, sig);
    } else if (outcome === 'resisted') {
      calls.callsResisted += 1;
      user.stats.correctIdentifications += 1;
    } else if (outcome === 'reported' || signals.includes('challenged') || signals.includes('asked_to_verify')) {
      calls.callsReportedOrChallenged += 1;
      user.stats.correctIdentifications += 1;
    } else if (outcome === 'declined' || outcome === 'missed' || outcome === 'ignored') {
      calls.callsDeclinedOrMissed += 1;
    }

    if (call.durationSecs !== undefined && call.durationSecs > 0) {
      calls.totalDurationSecs += call.durationSecs;
      calls.averageDurationSecs = Math.round(calls.totalDurationSecs / calls.totalCalls);
    }

    calls.recentOutcomes.unshift({
      callId: call.id,
      scenarioTitle: scenario.title,
      scenarioId: scenario.id,
      outcome,
      signals,
      durationSecs: call.durationSecs,
      at: call.completedAt || call.endedAt || new Date().toISOString(),
    });
    if (calls.recentOutcomes.length > 20) calls.recentOutcomes.pop();
  } else if (isCompromised) {
    texts.threadsCompromised += 1;
    if (signals.includes('clicked_link')) texts.linkClicks += 1;
  } else {
    if (outcome === 'reported') texts.reported += 1;
    else texts.threadsResisted += 1;
    user.stats.correctIdentifications += 1;
  }

  const inferredCat = inferCategoryFromScenario(scenario);
  const cat = user.vulnerabilityProfile.categoryAccuracy[inferredCat];
  cat.attempts += 1;
  if (!isCompromised) cat.correct += 1;
  cat.accuracy = Math.round((cat.correct / cat.attempts) * 100);

  if (cat.accuracy < 75 && !user.vulnerabilityProfile.weakCategories.includes(inferredCat)) {
    user.vulnerabilityProfile.weakCategories.push(inferredCat);
  } else if (cat.accuracy >= 80) {
    user.vulnerabilityProfile.weakCategories = user.vulnerabilityProfile.weakCategories.filter(
      (c) => c !== inferredCat
    );
  }

  user.stats.overallResilienceScore = recalculateResilienceScore(user);
  updateAdaptiveDifficulty(user);

  saveUser(user);

  let feedbackMessage: string;
  if (channel === 'call') {
    if (isCompromised) {
      const compromisingActions = signals.filter((s) => COMPROMISING_SIGNALS.includes(s));
      feedbackMessage = `⚠️ Compromised in phone call simulation "${scenario.title}". Actions taken: ${
        compromisingActions.length > 0 ? compromisingActions.join(', ') : 'complied with caller requests'
      }. Caller tactics exploited: ${scenario.tactics.join(', ')}.`;
    } else if (outcome === 'resisted') {
      feedbackMessage = `🛡️ Excellent defense! You resisted the scam call "${scenario.title}" without disclosing credentials or codes.`;
    } else if (outcome === 'reported' || signals.includes('challenged')) {
      feedbackMessage = `🎯 Outstanding response! You actively challenged the caller and reported the simulation.`;
    } else {
      feedbackMessage = `📞 Call simulation ended with status: ${outcome}.`;
    }
  } else {
    feedbackMessage = isCompromised
      ? `⚠️ Compromised in text simulation "${scenario.title}". Tactics: ${scenario.tactics.join(', ')}.`
      : `🛡️ Successfully identified and resisted text scam "${scenario.title}".`;
  }

  return {
    user,
    channel,
    simulationId: sim.id,
    outcome,
    isCompromised,
    signals,
    vulnerableTacticsAdded: newlyAddedTactics,
    resilienceScore: user.stats.overallResilienceScore,
    feedbackMessage,
  };
}
