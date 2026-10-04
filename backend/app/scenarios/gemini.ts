import { GoogleGenAI } from '@google/genai';

/** One structured-output model call: a prompt and a JSON schema in, the raw JSON text out. Injected in tests. */
export type JsonModel = (prompt: string, schema: object, timeoutMs: number) => Promise<string>;

/** Gemini with a response schema, the same call pattern as the call generator. */
export function geminiJson(apiKey: string): JsonModel {
  const client = new GoogleGenAI({ apiKey });
  return async (prompt, schema, timeoutMs) => {
    let timer: NodeJS.Timeout | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Gemini timed out')), timeoutMs); });
      const interaction = await Promise.race([
        client.interactions.create({ model: 'gemini-3.8-flash', input: prompt, response_format: { type: 'text', mime_type: 'application/json', schema } }),
        timeout,
      ]);
      return interaction.output_text?.trim() ?? '';
    } finally {
      clearTimeout(timer);
    }
  };
}
