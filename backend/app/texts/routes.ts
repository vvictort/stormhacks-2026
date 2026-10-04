import { Router, type Request, type RequestHandler } from "express";
import { z } from "zod";
import { AppError } from "../http/errors.ts";
import { StartSimulation, type ScenarioCatalog } from "../scenarios/catalog.ts";
import type { TextService } from "./service.ts";
import * as sse from "./sse.ts";

const Reply = z.object({ body: z.string().trim().min(1).max(1000) });

const notFound = () => new AppError(404, "not_found", "Thread not found.");
const threadEnded = () =>
  new AppError(409, "thread_ended", "This conversation has ended.");

// Another user's thread is a 404, so ids can't be probed.
async function ownThread(texts: TextService, req: Request<{ id: string }>) {
  const thread = await texts.get(req.params.id);
  if (!thread || thread.userId !== req.user!.uid) throw notFound();
  return thread;
}

/** /api/comms/texts (behind requireAuth): simulated scam text threads. */
export function textsRouter({
  texts,
  catalog,
}: {
  texts: TextService;
  catalog: ScenarioCatalog;
}) {
  const router = Router();

  router.post("/", async (req, res) => {
    const { scenarioId } = StartSimulation.parse(req.body ?? {});
    const scenario = catalog.pickText(scenarioId);
    if (!scenario) {
      throw new AppError(404, "scenario_not_found", "Scenario not found.");
    }
    const started = await texts.start(req.user!.uid, scenario);
    if ("conflict" in started) {
      throw new AppError(
        409,
        "active_thread_exists",
        "You already have a conversation in progress.",
        { threadId: started.conflict.id },
      );
    }
    const { thread } = started;
    res.status(201).json({
      threadId: thread.id,
      streamUrl: `/api/comms/texts/${thread.id}/stream`,
      thread,
    });
  });

  router.get("/:id", async (req, res) => {
    res.json(await ownThread(texts, req));
  });

  router.post("/:id/replies", async (req, res) => {
    await ownThread(texts, req);
    const { body } = Reply.parse(req.body);
    const result = await texts.reply(req.params.id, body);
    if (result === "not_found") throw notFound();
    if (result === "ended") throw threadEnded();
    res.status(202).json({ message: result });
  });

  router.post("/:id/report", async (req, res) => {
    await ownThread(texts, req);
    const result = await texts.report(req.params.id);
    if (result === "not_found") throw notFound();
    if (result === "ended") throw threadEnded();
    res.json(result);
  });

  return router;
}

/**
 * GET /api/comms/texts/:id/stream: the thread's SSE stream. Mounted behind
 * requireAuth with the query token allowed.
 */
export const textStream =
  (texts: TextService): RequestHandler<{ id: string }> =>
  async (req, res) => {
    sse.subscribe(await ownThread(texts, req), req, res);
  };

/**
 * /api/comms/l/:token: tracked scam link inside a simulated text. No auth; it's
 * a plain browser navigation.
 */
export function linkRouter(texts: TextService) {
  const router = Router();

  router.get("/:token", async (req, res) => {
    const redirectTo = await texts.handleLinkClick(req.params.token);
    if (!redirectTo) {
      res.status(404).type("text/plain").send("This link has expired.");
      return;
    }
    res.redirect(302, redirectTo);
  });

  return router;
}
