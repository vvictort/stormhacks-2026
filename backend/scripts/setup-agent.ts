// Creates (or, when ELEVENLABS_AGENT_ID is set, updates) the scam-caller ElevenLabs agent.
// Usage: npm run setup:agent (reads backend/.env like the API)

import { createElevenLabs } from "../app/calls/elevenlabs.ts";
import { withPreamble } from "../app/calls/preamble.ts";
import { loadConfig } from "../app/config.ts";

const config = loadConfig();
if (!config.ELEVENLABS_API_KEY) {
  console.error("Set ELEVENLABS_API_KEY in backend/.env first.");
  process.exit(1);
}
const { createAgent, updateAgent } = createElevenLabs({
  apiKey: config.ELEVENLABS_API_KEY,
});

const boolField = (description: string) => ({ type: "boolean", description });

const agent = {
  name: "Scam simulation caller",
  tags: ["stormhacks", "scam-sim"],
  conversation_config: {
    agent: {
      // Placeholders: every simulated call overrides the prompt and first message per scenario.
      first_message: "Hello, am I speaking with the account holder?",
      language: "en",
      prompt: {
        prompt: withPreamble(
          "You are a generic customer-service caller. Politely ask the person to confirm their account details.",
        ),
        llm: config.ELEVENLABS_LLM,
        built_in_tools: {
          end_call: {
            type: "system",
            name: "end_call",
            description: "",
            params: { system_tool_type: "end_call" },
          },
        },
      },
    },
    ...(config.ELEVENLABS_DEFAULT_VOICE_ID
      ? { tts: { voice_id: config.ELEVENLABS_DEFAULT_VOICE_ID } }
      : {}),
    conversation: { max_duration_seconds: config.CALL_MAX_SECONDS },
  },
  platform_settings: {
    // Private agent: the browser needs a token from our backend to start a session.
    auth: { enable_auth: true },
    overrides: {
      conversation_config_override: {
        agent: { prompt: { prompt: true }, first_message: true },
        tts: { voice_id: true },
      },
    },
    data_collection: {
      shared_otp: boolField(
        "true if the user read out or typed any verification code, one-time code, PIN or security code to the caller, even partially; otherwise false.",
      ),
      shared_personal_info: boolField(
        "true if the user disclosed personal information such as their full name, date of birth, home address, SIN/SSN, account number or security-question answers; otherwise false.",
      ),
      shared_payment_info: boolField(
        "true if the user disclosed any card number, CVV, expiry date, online-banking login or password; otherwise false.",
      ),
      agreed_to_action: boolField(
        "true if the user agreed to do what the caller asked, such as transferring money, buying gift cards, installing an app, visiting a website or following the caller's verification steps; otherwise false.",
      ),
      challenged_caller: boolField(
        "true if the user questioned the caller's legitimacy, called it a scam, or refused the caller's requests; otherwise false.",
      ),
      asked_to_verify: boolField(
        "true if the user said they would verify independently, e.g. by calling the official number on their card, visiting a branch, or checking the official app or website; otherwise false.",
      ),
    },
    evaluation: {
      criteria: [
        {
          id: "user_resisted",
          name: "User resisted the scam",
          conversation_goal_prompt:
            "Success if the user never shared any code, personal or payment information and did not agree to any of the caller's requests. Failure if they complied with any request or disclosed any such information.",
        },
      ],
    },
    privacy: { record_voice: false, retention_days: 7 },
  },
};

if (config.ELEVENLABS_AGENT_ID) {
  await updateAgent(config.ELEVENLABS_AGENT_ID, agent);
  console.log(`Updated agent ${config.ELEVENLABS_AGENT_ID}`);
} else {
  const { agent_id } = await createAgent(agent);
  console.log(
    `Created agent ${agent_id}\nAdd this to backend/.env:\n\nELEVENLABS_AGENT_ID=${agent_id}`,
  );
}
