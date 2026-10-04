import assert from "node:assert/strict";
import { test } from "node:test";
import type { Config } from "../app/config.ts";
import { integrationLines, storageLine } from "../app/integrations.ts";

const secrets = {
  GEMINI_API_KEY: "gem-secret",
  ELEVENLABS_API_KEY: "xi-secret",
  ELEVENLABS_AGENT_ID: "agent_123",
  SNOWFLAKE_ACCOUNT: "acct-secret",
  SNOWFLAKE_PAT: "pat-secret",
  SNOWFLAKE_WAREHOUSE: "WH",
  SNOWFLAKE_DATABASE: "DB",
  SNOWFLAKE_ID_SALT: "salt-secret-value-16",
};

test("startup lines say what each integration is doing, without any value", () => {
  const all = integrationLines({
    ...secrets,
    SNOWFLAKE_CORTEX_MODEL: "mistral-large2",
  } as unknown as Config);
  assert.deepEqual(all, [
    "Gemini: configured",
    "ElevenLabs: configured",
    "Snowflake: configured (Cortex on)",
  ]);
  for (const value of Object.values(secrets))
    assert.equal(all.join("\n").includes(value), false, value);

  assert.deepEqual(integrationLines({ SNOWFLAKE_SCHEMA: "PUBLIC" } as Config), [
    "Gemini: not configured (fallback templates)",
    "ElevenLabs: unavailable (caption-only practice)",
    "Snowflake: built-in analysis",
  ]);
  const partial = integrationLines({
    ...secrets,
    SNOWFLAKE_ID_SALT: undefined,
    ELEVENLABS_AGENT_ID: undefined,
  } as unknown as Config);
  assert.match(
    partial[1],
    /^ElevenLabs: unavailable \(set ELEVENLABS_AGENT_ID/,
  );
  assert.match(
    partial[2],
    /^Snowflake: built-in analysis \(Snowflake needs all of .*SNOWFLAKE_ID_SALT\)$/,
  );
  assert.equal(
    integrationLines({ ...secrets } as unknown as Config)[2],
    "Snowflake: configured (Cortex off)",
  );
  assert.equal(partial.join("\n").includes("pat-secret"), false);

  assert.equal(storageLine("timescale"), "TigerData: timescaledb hypertable");
  assert.equal(
    storageLine("postgres"),
    "TigerData: plain Postgres (no timescaledb hypertable)",
  );
  assert.equal(storageLine(null), "TigerData: unknown (database unreachable)");
});
