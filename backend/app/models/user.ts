export type DifficultyLevel = 'beginner' | 'intermediate' | 'advanced';

export type ScamCategory =
  | 'banking'
  | 'shipping'
  | 'account_security'
  | 'workplace'
  | 'promotional';

export interface UserStats {
  totalDrillsCompleted: number;  // Total emails evaluated
  correctIdentifications: number; // Correctly guessed scam or legit
  timesCompromised: number;       // Fell for a scam (guessed legit when it was scam)
  falsePositives: number;         // Flagged a legit email as a scam
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

export interface UserVulnerabilityProfile {
  // Categories where the user made mistakes (e.g. fell for banking or shipping scams)
  weakCategories: ScamCategory[];
  // Common tactics they fell for (e.g. 'urgency', 'authority', 'spoofed_domain')
  frequentBlindSpots: string[];
  // Mapping of each scam category to their specific accuracy and drill counts
  categoryAccuracy: Record<ScamCategory, CategoryAccuracy>;
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
 * Create a new user profile with default baseline stats
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
 * Record an email evaluation result and dynamically update the user's score and adaptive difficulty
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

  // 1. Update overall counts
  if (isCorrect) {
    user.stats.correctIdentifications += 1;
  } else {
    if (params.isScam && !params.userGuessedScam) {
      // User fell for a scam
      user.stats.timesCompromised += 1;
      if (params.redFlags && params.redFlags.length > 0) {
        user.vulnerabilityProfile.frequentBlindSpots.push(params.redFlags[0]);
      }
    } else if (!params.isScam && params.userGuessedScam) {
      // User falsely flagged a legitimate email
      user.stats.falsePositives += 1;
    }
  }

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
  if (isCorrect) {
    catStats.correct += 1;
  }
  catStats.accuracy = Math.round((catStats.correct / catStats.attempts) * 100);
  user.vulnerabilityProfile.categoryAccuracy[params.category] = catStats;

  // 3. Update weakCategories list dynamically based on category accuracy
  if (catStats.accuracy < 75 && !user.vulnerabilityProfile.weakCategories.includes(params.category)) {
    user.vulnerabilityProfile.weakCategories.push(params.category);
  } else if (catStats.accuracy >= 80) {
    user.vulnerabilityProfile.weakCategories = user.vulnerabilityProfile.weakCategories.filter(
      (c) => c !== params.category
    );
  }

  // Calculate new Resilience Score (0 - 100)
  // Heavily penalizes getting compromised (-15 pts), slight penalty for false alarms (-5 pts)
  const accuracyRate = user.stats.correctIdentifications / user.stats.totalDrillsCompleted;
  const compromisePenalty = user.stats.timesCompromised * 15;
  const falsePositivePenalty = user.stats.falsePositives * 5;
  const baseScore = Math.round(accuracyRate * 100);
  user.stats.overallResilienceScore = Math.max(0, Math.min(100, baseScore - compromisePenalty - falsePositivePenalty));

  // Adaptive difficulty adjustment:
  // If user has high accuracy (>85%) over at least 3 drills, level up
  if (user.stats.totalDrillsCompleted >= 3 && accuracyRate >= 0.85) {
    if (user.currentDifficulty === 'beginner') {
      user.currentDifficulty = 'intermediate';
    } else if (user.currentDifficulty === 'intermediate') {
      user.currentDifficulty = 'advanced';
    }
  } else if (user.stats.timesCompromised >= 2) {
    // If compromised multiple times, drop down to reinforce fundamentals
    if (user.currentDifficulty === 'advanced') {
      user.currentDifficulty = 'intermediate';
    } else if (user.currentDifficulty === 'intermediate') {
      user.currentDifficulty = 'beginner';
    }
  }

  user.updatedAt = new Date().toISOString();
  usersStore.set(user.id, user);

  const feedbackMessage = isCorrect
    ? `Correct! You accurately identified this as ${params.isScam ? 'a SCAM' : 'LEGITIMATE'}.`
    : params.isScam
    ? `Incorrect! You fell for this scam. It was a phishing attempt in ${params.category}.`
    : `Incorrect! This was a legitimate email from an authentic sender.`;

  return { user, isCorrect, feedbackMessage };
}
