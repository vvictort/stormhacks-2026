import type { TextLink, TextThread } from "../shared/types.ts";

export const LINK_PLACEHOLDER = "{{link}}";

// Relative: the app and the API share one origin (the Vite proxy in dev).
export const trackedHref = (token: string) => `/api/comms/l/${token}`;

/** Frontend "this was a simulation" page the tracked link redirects to. */
export function caughtUrl(appOrigin: string, threadId: string) {
  const url = new URL("/caught", appOrigin);
  url.searchParams.set("sim", threadId);
  return url.toString();
}

/**
 * Replaces `{{link}}` in a scammer text with the fake display URL and returns the tappable mapping.
 * The display text is what the user sees; the href is our tracked redirect.
 */
export function renderScammerText(
  raw: string,
  thread: Pick<TextThread, "scenario" | "linkToken">,
): { body: string; links?: TextLink[] } {
  if (!raw.includes(LINK_PLACEHOLDER)) return { body: raw };
  const display = thread.scenario.linkDisplayUrl;
  if (!display || !thread.linkToken) {
    return {
      body: raw
        .replaceAll(LINK_PLACEHOLDER, "")
        .replace(/\s{2,}/g, " ")
        .trim(),
    };
  }
  return {
    body: raw.replaceAll(LINK_PLACEHOLDER, display),
    links: [{ text: display, href: trackedHref(thread.linkToken) }],
  };
}
