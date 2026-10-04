import type { Signal, TextMessage, TextScenario } from "../shared/types.ts";

export interface TextTurnInput {
  scenario: TextScenario;
  /** Full thread so far; user messages are already redacted. */
  messages: TextMessage[];
  /** Rule-based hints from the user's latest message(s). */
  preSignals: Signal[];
}

export interface TextTurnResult {
  /** Next scammer text, or null to send nothing. May contain `{{link}}`. */
  reply: string | null;
  /** Authoritative signals for the user's latest message(s). */
  signals: Signal[];
  /** True when the scam conversation should end. */
  done: boolean;
}

/** Generates the scammer's side of a text conversation. */
export interface ScenarioProvider {
  nextTextTurn(input: TextTurnInput): Promise<TextTurnResult>;
  /** Unprompted nudge after the user goes quiet, or null for none. */
  followUp(input: Omit<TextTurnInput, "preSignals">): Promise<string | null>;
}

const ESCALATION = [
  "This is time-sensitive. Please confirm the 6-digit verification code we just sent you so we can keep your account active.",
  "We still have not received your code. Your account will be locked within 30 minutes if this is not resolved.",
  "Final notice: reply with the code now to avoid suspension.",
];

/**
 * Canned, escalating replies so the flow runs end-to-end before the Gemini
 * provider exists.
 */
export class StubProvider implements ScenarioProvider {
  async nextTextTurn({
    scenario,
    messages,
    preSignals,
  }: TextTurnInput): Promise<TextTurnResult> {
    const signals: Signal[] = [...new Set<Signal>([...preSignals, "engaged"])];

    if (preSignals.includes("stop")) {
      return { reply: null, signals, done: true };
    }
    if (
      preSignals.includes("shared_code") ||
      preSignals.includes("shared_payment_info")
    ) {
      return {
        reply: "Thank you, verifying now. Please keep your phone nearby.",
        signals,
        done: true,
      };
    }
    if (preSignals.includes("challenged")) {
      return {
        reply:
          "I understand your concern, but this is an official notice. Ignoring it will result in your account being suspended.",
        signals,
        done: false,
      };
    }

    const turn =
      messages.filter((m) => m.from === "scammer" && !m.followUp).length - 1;
    let reply = ESCALATION[Math.min(turn, ESCALATION.length - 1)]!;
    if (scenario.linkDisplayUrl && turn === ESCALATION.length - 1) {
      reply += " Or resolve it here: {{link}}";
    }
    return { reply, signals, done: false };
  }

  async followUp() {
    return "Hello? Are you there? This is urgent.";
  }
}
