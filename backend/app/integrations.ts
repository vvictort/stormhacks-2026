import type { Config } from "./config.ts";
import type { Storage } from "./behavior/behavior.repository.ts";

const SNOWFLAKE_REQUIRED = [
  "SNOWFLAKE_ACCOUNT",
  "SNOWFLAKE_PAT",
  "SNOWFLAKE_WAREHOUSE",
  "SNOWFLAKE_DATABASE",
  "SNOWFLAKE_ID_SALT",
] as const;

function elevenLabsStatus(config: Config) {
  if (config.ELEVENLABS_API_KEY && config.ELEVENLABS_AGENT_ID) {
    return "configured";
  }
  if (config.ELEVENLABS_API_KEY) {
    return "unavailable (set ELEVENLABS_AGENT_ID: npm run setup:agent; caption-only practice)";
  }
  return "unavailable (caption-only practice)";
}

function snowflakeStatus(config: Config) {
  const set = SNOWFLAKE_REQUIRED.filter((key) => config[key]);
  if (set.length === SNOWFLAKE_REQUIRED.length) {
    return `configured (Cortex ${config.SNOWFLAKE_CORTEX_MODEL ? "on" : "off"})`;
  }
  // Partly configured: say what is missing rather than fall back silently.
  if (set.length || config.SNOWFLAKE_ROLE || config.SNOWFLAKE_CORTEX_MODEL) {
    return `built-in analysis (Snowflake needs all of ${SNOWFLAKE_REQUIRED.join(", ")})`;
  }
  return "built-in analysis";
}

/**
 * One startup line per sponsor integration: what is on and what the app falls
 * back to. Names only, never values.
 */
export function integrationLines(config: Config): string[] {
  const gemini = config.GEMINI_API_KEY
    ? "configured"
    : "not configured (fallback templates)";
  return [
    `Gemini: ${gemini}`,
    `ElevenLabs: ${elevenLabsStatus(config)}`,
    `Snowflake: ${snowflakeStatus(config)}`,
  ];
}

const STORAGE_STATUS: Record<Storage, string> = {
  timescale: "timescaledb hypertable",
  postgres: "plain Postgres (no timescaledb hypertable)",
};

export const storageLine = (storage: Storage | null) =>
  `TigerData: ${storage ? STORAGE_STATUS[storage] : "unknown (database unreachable)"}`;
