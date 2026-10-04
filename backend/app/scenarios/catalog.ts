import { randomInt } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  CallScenario,
  TextScenario,
  type SimChannel,
} from "../shared/types.ts";
import type { Tactic } from "../shared/vocabulary.ts";
import type { ScenariosRepository } from "./scenarios.repository.ts";

/**
 * Public view of a sample scenario. Never includes prompts, personas or message
 * content.
 */
export interface ScenarioSummary {
  id: string;
  channel: SimChannel;
  title: string;
  tactics: Tactic[];
  difficulty: 1 | 2 | 3;
  /** `senderLabel` for texts, `callerLabel` for calls. */
  label: string;
}

const pickRandom = <T>(list: T[]): T | null =>
  list.length ? list[randomInt(list.length)]! : null;

/** Prefix of generated (Gemini) call scenarios, stored per user in Postgres. */
const GENERATED_PREFIX = "gen-";

/**
 * Every scenario a simulation can start from: the fixtures, loaded once at
 * startup from `text-*.json` / `call-*.json` files shaped
 * `{ userId, scenario }` (an invalid file throws so the server fails fast),
 * plus each user's own generated call scenarios.
 */
export class ScenarioCatalog {
  private readonly texts: TextScenario[] = [];
  private readonly calls: CallScenario[] = [];
  private readonly generated: Pick<ScenariosRepository, "get">;

  constructor(
    generated: Pick<ScenariosRepository, "get">,
    dir = fileURLToPath(new URL("../../fixtures/scenarios/", import.meta.url)),
  ) {
    this.generated = generated;

    const ids = new Set<string>();
    for (const file of readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .sort()) {
      try {
        const raw = (
          JSON.parse(readFileSync(join(dir, file), "utf8")) as {
            scenario?: unknown;
          } | null
        )?.scenario;
        let id: string;
        if (file.startsWith("text-")) {
          const scenario = TextScenario.parse(raw);
          this.texts.push(scenario);
          id = scenario.id;
        } else if (file.startsWith("call-")) {
          const scenario = CallScenario.parse(raw);
          this.calls.push(scenario);
          id = scenario.id;
        } else {
          throw new Error('file name must start with "text-" or "call-"');
        }

        if (ids.has(id)) throw new Error(`duplicate scenario id "${id}"`);
        ids.add(id);
      } catch (err) {
        const message =
          err instanceof z.ZodError
            ? z.prettifyError(err)
            : err instanceof Error
              ? err.message
              : String(err);
        throw new Error(`[scenarios] ${file}: ${message}`, { cause: err });
      }
    }
  }

  list(channel?: SimChannel): ScenarioSummary[] {
    const texts = this.texts.map((s) => summary(s, "text", s.senderLabel));
    const calls = this.calls.map((s) => summary(s, "call", s.callerLabel));
    if (channel === "text") return texts;
    if (channel === "call") return calls;
    return [...texts, ...calls];
  }

  /**
   * The sample with this id, or a random one when no id is given. Null for an
   * unknown id.
   */
  pickText(id?: string): TextScenario | null {
    return id === undefined
      ? pickRandom(this.texts)
      : (this.texts.find((s) => s.id === id) ?? null);
  }

  /**
   * A fixture by id (or a random one when no id is given), or the user's own
   * generated scenario. Null when unknown.
   */
  async pickCall(
    id: string | undefined,
    uid: string,
  ): Promise<CallScenario | null> {
    if (id?.startsWith(GENERATED_PREFIX)) return this.generated.get(uid, id);
    return id === undefined
      ? pickRandom(this.calls)
      : (this.calls.find((s) => s.id === id) ?? null);
  }
}

function summary(
  { id, title, tactics, difficulty }: TextScenario | CallScenario,
  channel: SimChannel,
  label: string,
): ScenarioSummary {
  return { id, channel, title, tactics: [...tactics], difficulty, label };
}

// Scenarios are server-owned: start one by id, or `{}` for a random sample.
// Strict, so a client-supplied `scenario` (or any other key) is a 400 instead
// of being silently ignored.
export const StartSimulation = z.strictObject({
  scenarioId: z.string().min(1).max(200).optional(),
});
