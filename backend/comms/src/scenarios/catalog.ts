import { randomInt } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { Backend } from '../backend.ts';
import { ROOT_DIR } from '../config.ts';
import { CallScenario, TextScenario, type Tactic } from '../types.ts';

export type Channel = 'text' | 'call';

/** Public view of a sample scenario. Never includes prompts, personas or message content. */
export interface ScenarioSummary {
  id: string;
  channel: Channel;
  title: string;
  tactics: Tactic[];
  difficulty: 1 | 2 | 3;
  /** `senderLabel` for texts, `callerLabel` for calls. */
  label: string;
}

const pickRandom = <T>(list: T[]): T | null => (list.length ? list[randomInt(list.length)]! : null);

/**
 * Sample scenarios loaded once at startup from `text-*.json` / `call-*.json` files shaped `{ userId, scenario }`.
 * An invalid file throws so the server fails fast.
 */
export class SampleCatalog {
  private readonly texts: TextScenario[] = [];
  private readonly calls: CallScenario[] = [];

  constructor(dir = join(ROOT_DIR, 'fixtures/scenarios')) {
    const ids = new Set<string>();
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
      try {
        const raw = (JSON.parse(readFileSync(join(dir, file), 'utf8')) as { scenario?: unknown } | null)?.scenario;
        let id: string;
        if (file.startsWith('text-')) {
          const scenario = TextScenario.parse(raw);
          this.texts.push(scenario);
          id = scenario.id;
        } else if (file.startsWith('call-')) {
          const scenario = CallScenario.parse(raw);
          this.calls.push(scenario);
          id = scenario.id;
        } else {
          throw new Error('file name must start with "text-" or "call-"');
        }
        if (ids.has(id)) throw new Error(`duplicate scenario id "${id}"`);
        ids.add(id);
      } catch (err) {
        const message = err instanceof z.ZodError ? z.prettifyError(err) : err instanceof Error ? err.message : String(err);
        throw new Error(`[samples] ${file}: ${message}`, { cause: err });
      }
    }
  }

  list(channel?: Channel): ScenarioSummary[] {
    const texts = this.texts.map((s) => summary(s, 'text', s.senderLabel));
    const calls = this.calls.map((s) => summary(s, 'call', s.callerLabel));
    if (channel === 'text') return texts;
    if (channel === 'call') return calls;
    return [...texts, ...calls];
  }

  /** The sample with this id, or a random one when no id is given. Null for an unknown id. */
  pickText(id?: string): TextScenario | null {
    return id === undefined ? pickRandom(this.texts) : (this.texts.find((s) => s.id === id) ?? null);
  }

  /** The sample with this id, or a random one when no id is given. Null for an unknown id. */
  pickCall(id?: string): CallScenario | null {
    return id === undefined ? pickRandom(this.calls) : (this.calls.find((s) => s.id === id) ?? null);
  }
}

function summary({ id, title, tactics, difficulty }: TextScenario | CallScenario, channel: Channel, label: string): ScenarioSummary {
  return { id, channel, title, tactics: [...tactics], difficulty, label };
}

// Scenarios are server-owned: start one by id, or `{}` for a random sample. Strict, so a client-supplied
// `scenario` (or any other key) is a 400 instead of being silently ignored.
export const StartSimulation = z.strictObject({ scenarioId: z.string().min(1).max(200).optional() });

/** Prefix of backend-generated (Gemini) call scenarios, resolved through the backend per user. */
const GENERATED_PREFIX = 'gen-';

/** A fixture by id (or a random one), or the caller's own generated scenario; null when unknown. */
export const resolveCallScenario = async (samples: SampleCatalog, backend: Pick<Backend, 'callScenario'>, id: string | undefined, userId: string) =>
  id?.startsWith(GENERATED_PREFIX) ? backend.callScenario(id, userId) : samples.pickCall(id);
