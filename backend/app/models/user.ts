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

export const ALL_SCAM_CATEGORIES: ScamCategory[] = [
  'banking',
  'shipping',
  'account_security',
  'workplace',
  'promotional',
];

export function createInitialCategoryAccuracy(): Record<ScamCategory, CategoryAccuracy> {
  return {
    banking: { attempts: 0, correct: 0, accuracy: 100 },
    shipping: { attempts: 0, correct: 0, accuracy: 100 },
    account_security: { attempts: 0, correct: 0, accuracy: 100 },
    workplace: { attempts: 0, correct: 0, accuracy: 100 },
    promotional: { attempts: 0, correct: 0, accuracy: 100 },
  };
}

// ============================================================================
// Channel-Specific Extensions of UserVulnerabilityProfile
// ============================================================================

/**
 * Vulnerability metrics specific to email phishing drills
 */
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

/**
 * Recorded outcome item for individual call simulations
 */
export interface CallSimulationOutcome {
  callId: string;
  scenarioTitle: string;
  scenarioId?: string;
  outcome: Outcome;
  signals: Signal[];
  durationSecs?: number;
  at: string;
}

/**
 * Vulnerability metrics specific to voice call (vishing) simulations from comms / ElevenLabs
 */
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
  // Log of recent call simulation results
  recentOutcomes: CallSimulationOutcome[];
}

/**
 * Vulnerability metrics specific to SMS / text simulations
 */
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

/**
 * Unified user vulnerability profile combining cross-channel and channel-specific extensions
 */
export interface UserVulnerabilityProfile {
  // Global aggregate metrics
  weakCategories: ScamCategory[];
  frequentBlindSpots: string[];
  categoryAccuracy: Record<ScamCategory, CategoryAccuracy>;

  // Channel-specific extensions
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
  company?: string;               // e.g. "Acme Corp"
  currentDifficulty: DifficultyLevel;
  stats: UserStats;
  vulnerabilityProfile: UserVulnerabilityProfile;
  createdAt: string;
  updatedAt: string;
}

// In-memory store for user state
const usersStore = new Map<string, User>();

/**
 * Create a new user profile with default baseline stats and channel profiles
 */
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
      overallResilienceScore: 100, // Starts at baseline 100
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

/**
 * Retrieve a user by ID
 */
export function getUser(userId: string): User | undefined {
  return usersStore.get(userId);
}

/**
 * Save or update a user profile in store
 */
export function saveUser(user: User): User {
  user.updatedAt = new Date().toISOString();
  usersStore.set(user.id, user);
  return user;
}

/**
 * Helper to recalculate overall resilience score across all completed drills
 */
function recalculateResilienceScore(user: User): number {
  if (user.stats.totalDrillsCompleted === 0) return 100;
  const accuracyRate = user.stats.correctIdentifications / user.stats.totalDrillsCompleted;
  const compromisePenalty = user.stats.timesCompromised * 15;
  const falsePositivePenalty = user.stats.falsePositives * 5;
  const baseScore = Math.round(accuracyRate * 100);
  return Math.max(0, Math.min(100, baseScore - compromisePenalty - falsePositivePenalty));
}

/**
 * Helper to adaptively tune user difficulty based on performance trends
 */
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

/**
 * Infer category from a scenario id/title if not explicitly provided
 */
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

/**
 * Record an email evaluation result and dynamically update the user's score and email profile
 */
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

  // Ensure email profile exists
  if (!user.vulnerabilityProfile.emails) {
    user.vulnerabilityProfile.emails = createInitialEmailProfile();
  }
  const emailProfile = user.vulnerabilityProfile.emails;
  emailProfile.totalEvaluated += 1;

  // 1. Update overall and email counts
  if (isCorrect) {
    user.stats.correctIdentifications += 1;
    emailProfile.correctIdentifications += 1;
  } else {
    if (params.isScam && !params.userGuessedScam) {
      // User fell for a scam
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
      // User falsely flagged a legitimate email
      user.stats.falsePositives += 1;
      emailProfile.falsePositives += 1;
    }
  }

  emailProfile.accuracyRate = Math.round(
    (emailProfile.correctIdentifications / emailProfile.totalEvaluated) * 100
  );

  // 2. Update category-specific accuracy mapping
  if (!user.vulnerabilityProfile.categoryAccuracy) {
    user.vulnerabilityProfile.categoryAccuracy = createInitialCategoryAccuracy();
  }
  const catStats = user.vulnerabilityProfile.categoryAccuracy[params.category] || {
    attempts: 0,
    correct: 0,
    accuracy: 100,
  };
  catStats.attempts += 1;
  if (isCorrect) catStats.correct += 1;
  catStats.accuracy = Math.round((catStats.correct / catStats.attempts) * 100);
  user.vulnerabilityProfile.categoryAccuracy[params.category] = catStats;
  emailProfile.categoryAccuracy[params.category] = { ...catStats };

  // 3. Update weakCategories list dynamically
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

  // Calculate new Resilience Score & adaptive difficulty
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

// ============================================================================
// Updating User Profile with Reports from Comms
// ============================================================================

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

/**
 * Updates user profile, vulnerability metrics, and resilience scores
 * using the finalized simulation report from the comms service.
 */
export function updateUserFromCommsReport(report: CommsReportInput): CommsReportResult {
  // Normalize input: extract CallRecord or TextThread
  let call: CallRecord | undefined;
  let thread: TextThread | undefined;

  if ('call' in report) {
    call = report.call;
  } else if ('thread' in report) {
    thread = report.thread;
  } else if ('callerLabel' in report.scenario || 'transcript' in report) {
    call = report as CallRecord;
  } else {
    thread = report as TextThread;
  }

  const userId = call ? call.userId : thread!.userId;
  const user = usersStore.get(userId);
  if (!user) {
    throw new Error(`Cannot update comms report: User with ID "${userId}" not found.`);
  }

  // Ensure profiles exist
  if (!user.vulnerabilityProfile.calls) {
    user.vulnerabilityProfile.calls = createInitialCallProfile();
  }
  if (!user.vulnerabilityProfile.texts) {
    user.vulnerabilityProfile.texts = createInitialTextProfile();
  }

  let channel: 'call' | 'text';
  let outcome: Outcome;
  let signals: Signal[];
  let scenario: { id: string; title: string; tactics: Tactic[] };
  let simulationId: string;
  const newlyAddedTactics: (Tactic | string)[] = [];

  if (call) {
    channel = 'call';
    simulationId = call.id;
    outcome = call.outcome || 'resisted';
    signals = call.signals || [];
    scenario = call.scenario;

    const callProfile = user.vulnerabilityProfile.calls;
    callProfile.totalCalls += 1;

    // Track signals observed
    signals.forEach((sig) => {
      callProfile.signalsObserved[sig] = (callProfile.signalsObserved[sig] || 0) + 1;
    });

    // Check if user was compromised
    const compromising = signals.filter((s) => COMPROMISING_SIGNALS.includes(s));
    const isCompromised = outcome === 'compromised' || compromising.length > 0;

    user.stats.totalDrillsCompleted += 1;

    if (isCompromised) {
      outcome = 'compromised';
      user.stats.timesCompromised += 1;
      callProfile.callsCompromised += 1;

      // Add compromising signals
      compromising.forEach((sig) => {
        if (!callProfile.compromisingSignalsTriggered.includes(sig)) {
          callProfile.compromisingSignalsTriggered.push(sig);
        }
      });

      // Add exploited tactics to vulnerable lists
      scenario.tactics.forEach((tactic) => {
        if (!callProfile.vulnerableTactics.includes(tactic)) {
          callProfile.vulnerableTactics.push(tactic);
          newlyAddedTactics.push(tactic);
        }
        if (!user.vulnerabilityProfile.frequentBlindSpots.includes(tactic)) {
          user.vulnerabilityProfile.frequentBlindSpots.push(tactic);
        }
      });
    } else {
      if (outcome === 'resisted') {
        callProfile.callsResisted += 1;
        user.stats.correctIdentifications += 1;
      } else if (outcome === 'reported' || signals.includes('challenged') || signals.includes('asked_to_verify')) {
        callProfile.callsReportedOrChallenged += 1;
        user.stats.correctIdentifications += 1;
      } else if (outcome === 'declined' || outcome === 'missed' || outcome === 'ignored') {
        callProfile.callsDeclinedOrMissed += 1;
      }
    }

    // Call duration tracking
    if (call.durationSecs !== undefined && call.durationSecs > 0) {
      callProfile.totalDurationSecs += call.durationSecs;
      callProfile.averageDurationSecs = Math.round(
        callProfile.totalDurationSecs / callProfile.totalCalls
      );
    }

    // Append to outcome history
    callProfile.recentOutcomes.unshift({
      callId: call.id,
      scenarioTitle: scenario.title,
      scenarioId: scenario.id,
      outcome,
      signals,
      durationSecs: call.durationSecs,
      at: call.completedAt || call.endedAt || new Date().toISOString(),
    });
    if (callProfile.recentOutcomes.length > 20) callProfile.recentOutcomes.pop();

  } else {
    // Text simulation thread
    channel = 'text';
    simulationId = thread!.id;
    outcome = thread!.outcome || 'resisted';
    signals = thread!.signals || [];
    scenario = thread!.scenario;

    const textProfile = user.vulnerabilityProfile.texts;
    textProfile.totalThreads += 1;

    signals.forEach((sig) => {
      textProfile.signalsObserved[sig] = (textProfile.signalsObserved[sig] || 0) + 1;
    });

    const isLinkOrCodeCompromise =
      signals.includes('clicked_link') ||
      signals.includes('shared_code') ||
      signals.some((s) => COMPROMISING_SIGNALS.includes(s));
    const isCompromised = outcome === 'compromised' || isLinkOrCodeCompromise;

    user.stats.totalDrillsCompleted += 1;

    if (isCompromised) {
      outcome = 'compromised';
      user.stats.timesCompromised += 1;
      textProfile.threadsCompromised += 1;

      if (signals.includes('clicked_link')) textProfile.linkClicks += 1;

      scenario.tactics.forEach((tactic) => {
        if (!textProfile.vulnerableTactics.includes(tactic)) {
          textProfile.vulnerableTactics.push(tactic);
          newlyAddedTactics.push(tactic);
        }
        if (!user.vulnerabilityProfile.frequentBlindSpots.includes(tactic)) {
          user.vulnerabilityProfile.frequentBlindSpots.push(tactic);
        }
      });
    } else {
      if (outcome === 'reported') {
        textProfile.reported += 1;
        user.stats.correctIdentifications += 1;
      } else {
        textProfile.threadsResisted += 1;
        user.stats.correctIdentifications += 1;
      }
    }
  }

  // Update Category Accuracy from scenario context
  const inferredCat = inferCategoryFromScenario(scenario);
  if (!user.vulnerabilityProfile.categoryAccuracy[inferredCat]) {
    user.vulnerabilityProfile.categoryAccuracy[inferredCat] = { attempts: 0, correct: 0, accuracy: 100 };
  }
  const cat = user.vulnerabilityProfile.categoryAccuracy[inferredCat];
  cat.attempts += 1;
  const isCompromised = outcome === 'compromised';
  if (!isCompromised) cat.correct += 1;
  cat.accuracy = Math.round((cat.correct / cat.attempts) * 100);

  if (cat.accuracy < 75 && !user.vulnerabilityProfile.weakCategories.includes(inferredCat)) {
    user.vulnerabilityProfile.weakCategories.push(inferredCat);
  } else if (cat.accuracy >= 80) {
    user.vulnerabilityProfile.weakCategories = user.vulnerabilityProfile.weakCategories.filter(
      (c) => c !== inferredCat
    );
  }

  // Recalculate Resilience Score and adaptive difficulty
  user.stats.overallResilienceScore = recalculateResilienceScore(user);
  updateAdaptiveDifficulty(user);

  saveUser(user);

  // Generate actionable educational feedback message
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
    simulationId,
    outcome,
    isCompromised,
    signals,
    vulnerableTacticsAdded: newlyAddedTactics,
    resilienceScore: user.stats.overallResilienceScore,
    feedbackMessage,
  };
}
