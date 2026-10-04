import { Router } from "express";
import { AppError } from "../http/errors.ts";
import type { Repositories } from "../repositories.ts";
import { HISTORY_LIMIT, summarizeAttempts } from "../training/progress.ts";
import type { JsonModel } from "./gemini.ts";
import type { ScamLibrary } from "./library.ts";
import { generateSmsScenario } from "./sms-generator.ts";

/**
 * POST /api/training/sms-scenarios → 201 { scenario }: a scam SMS written for
 * this user from their saved profile, history and current training focus.
 * GET /:id → the scenario, owner only.
 */
export function smsScenariosRouter(
  { users, attempts, scenarios, insights }: Repositories,
  options: { model?: JsonModel; library?: ScamLibrary },
) {
  const router = Router();
  router.post("/", async (req, res) => {
    const uid = req.user!.uid;
    // Shares the per-user generation budget with call and email scenarios.
    if (!(await scenarios.claimGeneration(uid, 6, 40))) {
      throw new AppError(
        429,
        "RATE_LIMITED",
        "You’ve generated a lot of scenarios. Please wait a moment and try again.",
      );
    }

    const [profile, history, focus] = await Promise.all([
      users.ensureUser(req.user!),
      attempts.list(uid, HISTORY_LIMIT),
      insights.latestFocus(uid),
    ]);
    const { vulnerability, difficulty } = summarizeAttempts(history);
    const { scenario, source } = await generateSmsScenario({
      model: options.model,
      library: options.library,
      difficulty,
      focus,
      profession: profile.profession,
      interests: profile.interests,
      weakCategories: vulnerability.weakCategories,
      vulnerableTactics: vulnerability.vulnerableTactics,
    });
    await scenarios.saveMessage(uid, scenario, source);
    res.status(201).json({ scenario });
  });

  router.get("/:id", async (req, res) => {
    const scenario = /^gen-sms-[0-9a-f-]{36}$/.test(req.params.id)
      ? await scenarios.getMessage(req.user!.uid, req.params.id)
      : null;
    if (!scenario) throw new AppError(404, "NOT_FOUND", "Scenario not found.");
    res.json(scenario);
  });

  return router;
}
