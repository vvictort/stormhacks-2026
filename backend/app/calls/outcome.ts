import {
  difficultyName,
  type CallScenario,
  type CallTraining,
  type SimOutcome,
} from "../shared/types.ts";

// The contract table in docs/call-integration.md. Every call scenario is a scam, so anything short of
// compromised (declining, missing, hanging up) counts as a success.
const CANONICAL: Record<
  SimOutcome,
  Pick<CallTraining, "outcome" | "success">
> = {
  compromised: { outcome: "compromised", success: false },
  resisted: { outcome: "resisted", success: true },
  reported: { outcome: "resisted", success: true },
  declined: { outcome: "declined", success: true },
  ignored: { outcome: "missed", success: true },
  missed: { outcome: "missed", success: true },
  error: { outcome: "error", success: null },
};

export const toTraining = (
  outcome: SimOutcome,
  difficulty: CallScenario["difficulty"],
): CallTraining => ({
  ...CANONICAL[outcome],
  difficulty: difficultyName[difficulty],
});
