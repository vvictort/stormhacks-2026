import type { GeneratedInfo } from './scenarios.ts'

// Sponsor credit lines, kept honest: each names a sponsor only when that sponsor really did the work for this run.

/** A generated scenario's source line: Gemini only when it wrote it, grounding only when it drew on library examples. */
export function generatedCredit(generated: GeneratedInfo | undefined): string | null {
  if (generated?.source !== 'gemini') return null
  return (generated.grounding?.exampleCount ?? 0) > 0 ? 'Written by Gemini · Grounded in real-world scam patterns' : 'Written by Gemini'
}

/** ElevenLabs voiced the call only when it was answered live: declined, missed and caption-only calls never reach it. */
export const voiceCredit = ({ practice, answered }: { practice: boolean; answered: boolean }) =>
  !practice && answered ? 'Interactive voice simulation powered by ElevenLabs' : null
