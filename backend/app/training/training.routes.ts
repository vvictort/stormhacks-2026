import { Router } from "express";
import { AppError } from "../http/errors.ts";
import type { Repositories } from "../repositories.ts";
import { HISTORY_LIMIT, summarizeAttempts } from "./progress.ts";

const LIST_LIMIT = 50;

export function trainingRouter({
  attempts,
  insights,
}: Pick<Repositories, "attempts" | "insights">) {
  const router = Router();
  router.get("/progress", async (req, res) => {
    const [history, focus] = await Promise.all([
      attempts.list(req.user!.uid, HISTORY_LIMIT),
      insights.latestFocus(req.user!.uid),
    ]);
    const { stats, vulnerability, difficulty } = summarizeAttempts(history);
    // `difficulty` and `focus` are exactly what the next generated email or call will use.
    res.json({
      attempts: history
        .slice(0, LIST_LIMIT)
        .map(({ tactics: _, ...attempt }) => attempt),
      stats,
      vulnerability,
      difficulty,
      focus,
    });
  });
  router.get("/attempts/:id", async (req, res) => {
    const attempt = await attempts.get(req.user!.uid, req.params.id);
    if (!attempt) throw new AppError(404, "NOT_FOUND", "Attempt not found.");
    res.json(attempt);
  });
  return router;
}
