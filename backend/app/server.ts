import express from "express";
import helmet from "helmet";
import { behaviorRouter } from "./behavior/behavior.routes.ts";
import { callsRouter } from "./calls/routes.ts";
import type { CallService } from "./calls/service.ts";
import { requireAppRequest } from "./http/app-origin.ts";
import { requireAuth, type VerifyToken } from "./http/auth.ts";
import { InsightsService } from "./insights/service.ts";
import type { Snowflake } from "./insights/snowflake.ts";
import { AppError, errorHandler } from "./http/errors.ts";
import type { Repositories } from "./repositories.ts";
import type { ScenarioCatalog } from "./scenarios/catalog.ts";
import { emailScenariosRouter } from "./scenarios/email.routes.ts";
import { smsScenariosRouter } from "./scenarios/sms.routes.ts";
import { geminiJson, type JsonModel } from "./scenarios/gemini.ts";
import { defaultLibrary, type ScamLibrary } from "./scenarios/library.ts";
import {
  scenarioListRouter,
  scenariosRouter,
} from "./scenarios/scenarios.routes.ts";
import { linkRouter, textStream, textsRouter } from "./texts/routes.ts";
import type { TextService } from "./texts/service.ts";
import { trainingRouter } from "./training/training.routes.ts";
import { usersRouter } from "./users/users.routes.ts";

export interface Services {
  catalog: ScenarioCatalog;
  texts: TextService;
  calls: CallService;
}

export interface AppOptions {
  repos: Repositories;
  services: Services;
  origin: string;
  verifyToken?: VerifyToken;
  geminiApiKey?: string;
  /** Tests inject a fake structured-output model; otherwise Gemini when a key is set. */
  jsonModel?: JsonModel;
  /** Grounding examples for generated emails and calls; unset loads backend/fixtures/scam-library.json (missing: none). */
  library?: ScamLibrary;
  /** Unset: the vulnerability analysis is computed in the backend. */
  snowflake?: Snowflake | null;
}

const notFound = () => {
  throw new AppError(404, "NOT_FOUND", "Route not found.");
};

/** HTTP assembly only: shared middleware, then each feature's router. */
export function createApp({
  repos,
  services,
  origin,
  verifyToken,
  geminiApiKey,
  jsonModel = geminiApiKey ? geminiJson(geminiApiKey) : undefined,
  library = defaultLibrary(),
  snowflake = null,
}: AppOptions) {
  const { catalog, texts, calls } = services;
  const app = express();
  app.disable("x-powered-by");
  app.use(helmet());
  app.use("/api", (_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  app.use("/api", requireAppRequest(origin));
  app.use(express.json({ limit: "16kb" }));
  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });
  const auth = requireAuth(verifyToken);
  app.use("/api/users", auth, usersRouter(repos.users));
  app.use(
    "/api/training/call-scenarios",
    auth,
    scenariosRouter(repos, { model: jsonModel, library }),
  );
  app.use(
    "/api/training/email-scenarios",
    auth,
    emailScenariosRouter(repos, { model: jsonModel, library }),
  );
  app.use(
    "/api/training/sms-scenarios",
    auth,
    smsScenariosRouter(repos, { model: jsonModel, library }),
  );
  const insights = new InsightsService(repos.insights, snowflake);
  app.get("/api/training/insights", auth, async (req, res) => {
    res.json(await insights.get(req.user!.uid));
  });
  app.use("/api/training", auth, trainingRouter(repos));
  app.use("/api/training", auth, behaviorRouter(repos));

  // Simulated texts and calls. The scenario list and tracked links are public; the SSE stream alone takes ?access_token=.
  app.use("/api/comms/scenarios", scenarioListRouter(catalog));
  app.use("/api/comms/l", linkRouter(texts));
  app.get(
    "/api/comms/texts/:id/stream",
    requireAuth(verifyToken, { queryToken: true }),
    textStream(texts),
  );
  app.use("/api/comms/texts", auth, textsRouter({ texts, catalog }));
  app.use("/api/comms/calls", auth, callsRouter({ calls, catalog }));

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
