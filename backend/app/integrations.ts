import type { Config } from "./config.ts";
import type { Storage } from "./behavior/behavior.repository.ts";

const SNOWFLAKE_REQUIRED = [
  "SNOWFLAKE_ACCOUNT",
  "SNOWFLAKE_PAT",
  "SNOWFLAKE_WAREHOUSE",
  "SNOWFLAKE_DATABASE",
  "SNOWFLAKE_ID_SALT",
] as const;

/** One startup line per sponsor integration: what is on and what the app falls back to. Names only, never values. */
export function integrationLines(config: Config): string[] {
  const snowflakeSet = SNOWFLAKE_REQUIRED.filter((key) => config[key]);
  return [
    `Gemini: ${config.GEMINI_API_KEY ? "configured" : "not configured (fallback templates)"}`,
    `ElevenLabs: ${
      config.ELEVENLABS_API_KEY && config.ELEVENLABS_AGENT_ID
        ? "configured"
        : config.ELEVENLABS_API_KEY
          ? "unavailable (set ELEVENLABS_AGENT_ID: npm run setup:agent; caption-only practice)"
          : "unavailable (caption-only practice)"
    }`,
    `Snowflake: ${
      snowflakeSet.length === SNOWFLAKE_REQUIRED.length
        ? `configured (Cortex ${config.SNOWFLAKE_CORTEX_MODEL ? "on" : "off"})`
        : snowflakeSet.length ||
            config.SNOWFLAKE_ROLE ||
            config.SNOWFLAKE_CORTEX_MODEL
          ? `built-in analysis (Snowflake needs all of ${SNOWFLAKE_REQUIRED.join(", ")})`
          : "built-in analysis"
    }`,
  ];
}

export const storageLine = (storage: Storage | null) =>
  `TigerData: ${storage === "timescale" ? "timescaledb hypertable" : storage === "postgres" ? "plain Postgres (no timescaledb hypertable)" : "unknown (database unreachable)"}`;
