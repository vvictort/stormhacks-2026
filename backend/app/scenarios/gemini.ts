import { GoogleGenAI, ThinkingLevel } from "@google/genai";

/** One structured-output model call: a prompt and a JSON schema in, the raw JSON text out. Injected in tests. */
export type JsonModel = (
  prompt: string,
  schema: object,
  timeoutMs: number,
) => Promise<string>;

// Tried in order: a model that is overloaded (503/429) or unavailable to this key (404) falls through to the next.
// Flash-lite answers a full scenario in ~2s; the bigger flash models took 11-15s with low thinking and often return 503.
const MODELS = [
  { model: "gemini-3.5-flash-lite" },
  { model: "gemini-3.1-flash-lite" },
  {
    model: "gemini-3.8-flash",
    thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
  },
];
const retryable = (error: unknown) =>
  [404, 429, 500, 503].includes((error as { status?: number }).status ?? 0);

/** Gemini `generateContent` with a JSON response schema, all models sharing one time budget. */
export function geminiJson(apiKey: string, models = MODELS): JsonModel {
  const client = new GoogleGenAI({ apiKey });
  return async (prompt, schema, timeoutMs) => {
    const abortSignal = AbortSignal.timeout(timeoutMs);
    let last: unknown;
    for (const { model, thinkingConfig } of models) {
      try {
        const response = await client.models.generateContent({
          model,
          contents: prompt,
          config: {
            responseMimeType: "application/json",
            responseJsonSchema: schema,
            thinkingConfig,
            abortSignal,
          },
        });
        return response.text?.trim() ?? "";
      } catch (error) {
        last = error;
        if (abortSignal.aborted || !retryable(error)) break;
      }
    }
    throw abortSignal.aborted ? new Error("Gemini timed out") : last;
  };
}

/** Below this much budget left, a retry would only time out. */
const RETRY_MIN_MS = 6000;

/**
 * Up to two model calls sharing one time budget; the second is told what was wrong with the first. Null when neither
 * answer passes `check` (or the model is unavailable), so the caller can use its built-in scenario.
 */
export async function generateChecked<T>(
  model: JsonModel,
  prompt: string,
  schema: object,
  budgetMs: number,
  check: (raw: string) => { value: T } | { problems: string[] },
  label: string,
): Promise<T | null> {
  const deadline = Date.now() + budgetMs;
  let feedback = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const remaining = deadline - Date.now();
    if (attempt && remaining < RETRY_MIN_MS) break;
    try {
      const result = check(await model(prompt + feedback, schema, remaining));
      if ("value" in result) return result.value;
      console.warn(
        `[Gemini] ${label} rejected:`,
        result.problems.length,
        "problem(s)",
      );
      feedback = `\n\nYOUR PREVIOUS ANSWER WAS REJECTED. Fix these and answer again:\n- ${result.problems.join("\n- ")}`;
    } catch (error) {
      console.warn(
        `[Gemini] ${label} generation failed:`,
        (error as Error).name,
      );
    }
  }
  return null;
}

/** Model JSON text, with any markdown code fence removed, parsed; undefined when it isn't JSON. */
export function parseModelJson(raw: string): unknown {
  try {
    return JSON.parse(
      raw
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/, ""),
    );
  } catch {
    return undefined;
  }
}
