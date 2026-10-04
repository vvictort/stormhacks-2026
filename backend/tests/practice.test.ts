import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { JsonModel } from "../app/scenarios/gemini.ts";
import { ScenarioCatalog } from "../app/scenarios/catalog.ts";
import { ScamLibrary } from "../app/scenarios/library.ts";
import {
  buildPractice,
  checkText,
  FIXTURE_DIR,
  generatePracticeText,
  PRACTICE_FILE,
  PracticeText,
  textThreadScenario,
} from "../app/scenarios/practice.ts";
import { fakeRepos } from "./harness.ts";

const library = ScamLibrary.load();
const committed = JSON.parse(readFileSync(PRACTICE_FILE, "utf8"));
const texts: PracticeText[] = committed.texts.map((t: unknown) =>
  PracticeText.parse(t),
);

const meta = {
  id: "lib-sms-shipping",
  category: "shipping" as const,
  difficulty: "easy" as const,
  exampleCount: 2,
};

const answer = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    title: "Parcel held for a fee",
    summary: "A courier says a parcel is held until you pay.",
    situation: "You ordered something online this week.",
    sender: "+1 (604) 555-0147",
    messages: [
      {
        text: "Swiftline: your parcel is held. Pay the $1.99 fee within 12 hours or it goes back.",
        link: "https://swiftline-parcel-help.com/pay",
      },
    ],
    tactics: ["urgency", "suspicious_link"],
    redFlags: [
      {
        quote: "Pay the $1.99 fee",
        title: "An unexpected fee",
        reason: "The small fee is bait for your card details.",
      },
      {
        quote: "within 12 Hours",
        title: "A deadline to rush you",
        reason: "A countdown stops you checking first.",
      },
      {
        quote: "https://swiftline-parcel-help.com/pay",
        title: "A look-alike link",
        reason: "The site before the first slash is not the courier.",
      },
    ],
    explanation:
      "A delivery-fee scam: a trusted-sounding name, a tiny fee and a deadline.",
    nextTime: "Look up the parcel on the courier site yourself.",
    ...overrides,
  });

test("the committed practice path is exactly what the library builds (rebuild with npm run build:practice)", () => {
  const { practice, fixtures } = buildPractice(library, texts);
  assert.deepEqual(committed, JSON.parse(JSON.stringify(practice)));

  const onDisk = readdirSync(FIXTURE_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort();
  assert.deepEqual(onDisk, Object.keys(fixtures).sort());

  for (const file of onDisk) {
    assert.deepEqual(
      JSON.parse(readFileSync(join(FIXTURE_DIR, file), "utf8")),
      JSON.parse(JSON.stringify(fixtures[file])),
      file,
    );
  }
});

test("the practice path has no hand-written scams: library emails and calls, Gemini texts, every level", () => {
  const { emails, calls } = committed;
  assert.ok(
    emails.length >= 5 &&
      emails.every(
        (e: { id: string; generated: { reason: string } }) =>
          e.id.startsWith("lib-email-") &&
          e.generated.reason.includes("CC BY-SA 4.0"),
      ),
  );
  assert.ok(
    calls.length >= 5 &&
      calls.every(
        (c: { id: string; generated: { reason: string } }) =>
          c.id.startsWith("lib-call-") &&
          c.generated.reason.includes("CC BY-NC-ND 4.0"),
      ),
  );
  assert.ok(
    texts.length >= 5 &&
      texts.every(
        (t) =>
          t.generated.source === "gemini" &&
          t.generated.grounding.exampleCount >= 1,
      ),
  );

  for (const list of [emails, texts, calls]) {
    assert.deepEqual(
      new Set(list.map((s: { difficulty: string }) => s.difficulty)),
      new Set(["easy", "medium", "hard"]),
    );
  }

  assert.ok(
    calls.every((c: { indicators: unknown[] }) => c.indicators.length >= 3),
    "the call debrief needs 3 warning signs",
  );
});

test("the app catalog loads the library-built comms fixtures", () => {
  const catalog = new ScenarioCatalog(fakeRepos().scenarios);
  for (const call of committed.calls) {
    assert.ok(
      catalog.list("call").some((s) => s.id === call.id),
      call.id,
    );
  }

  for (const text of texts) {
    assert.ok(
      catalog.list("text").some((s) => s.id === text.id),
      text.id,
    );
  }
});

test("practice texts: near-miss quotes are repaired, and fake numbers, real brands and hidden flags are refused", () => {
  const ok = checkText(answer(), meta);
  assert.ok("value" in ok);
  assert.equal(
    ok.value.indicators[1].quote,
    "within 12 hours",
    "case repaired to the exact text",
  );
  assert.equal(ok.value.generated.grounding.exampleCount, 2);

  assert.ok(
    "problems" in checkText(answer({ sender: "+1 (604) 382-9911" }), meta),
    "a real-looking number",
  );
  assert.ok(
    "problems" in
      checkText(
        answer({
          messages: [
            {
              text: "Canada Post: your parcel is held. Pay the $1.99 fee within 12 hours.",
              link: "https://swiftline-parcel-help.com/pay",
            },
          ],
        }),
        meta,
      ),
  );
  assert.ok(
    "problems" in
      checkText(
        answer({
          redFlags: [
            {
              quote: "nowhere in the text",
              title: "Missing",
              reason: "This quote is not in the message.",
            },
          ],
        }),
        meta,
      ),
  );
  assert.ok("problems" in checkText("not json", meta));
});

test("practice texts are grounded or not written at all", async () => {
  let prompt = "";
  const model: JsonModel = async (p) => {
    prompt = p;
    return answer();
  };

  const text = await generatePracticeText(model, library, "shipping", "easy");
  assert.ok(text && prompt.includes("REAL-WORLD GROUNDING EXAMPLES"));
  assert.equal(
    await generatePracticeText(model, new ScamLibrary([]), "shipping", "easy"),
    null,
  );
});

test("a practice text becomes a live-thread scenario with a tracked link", () => {
  const thread = textThreadScenario(
    texts.find((t) => t.messages.some((m) => m.link))!,
  );
  assert.match(thread.openingMessage, /\{\{link\}\}$/);
  assert.ok(
    thread.linkDisplayUrl && !thread.linkDisplayUrl.startsWith("https://"),
  );
});
