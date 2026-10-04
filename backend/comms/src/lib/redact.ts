// Users may type or say real codes / card numbers if they fall for a simulation,
// so user-provided text is masked before it is stored, emitted, or sent to an LLM.

/** 4+ digits, optionally separated by single spaces or dashes ("123 456", "4111-1111-..."). */
export const DIGIT_RUN = /\d(?:[ -]?\d){3,}/g;

const NUMBER_WORD = '(?:zero|oh|one|two|three|four|five|six|seven|eight|nine)';
/** 4+ spoken digits as transcribed by speech recognition ("four one one one"). */
const NUMBER_WORD_RUN = new RegExp(`\\b${NUMBER_WORD}(?:[\\s,-]+${NUMBER_WORD}){3,}\\b`, 'gi');

const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/g;

export const countDigits = (s: string) => s.replace(/\D/g, '').length;

export function redact(text: string): string {
  return text
    .replace(EMAIL, '[EMAIL]')
    .replace(DIGIT_RUN, (m) => `[NUMBER:${countDigits(m)} digits]`)
    .replace(NUMBER_WORD_RUN, (m) => `[NUMBER:${m.trim().split(/[\s,-]+/).length} digits]`);
}
