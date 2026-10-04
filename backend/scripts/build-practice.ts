// Rebuilds the practice path from the scam library: frontend/src/features/training/practice.json and the comms
// fixtures in backend/fixtures/scenarios/. Emails and calls are rebuilt every run; the Gemini-written texts are kept,
// --texts writes the missing ones and --texts=all rewrites every one (both need GEMINI_API_KEY).
//   npm run build:practice
//   npm run build:practice -- --texts
//   npm run build:practice -- --texts=all
import {
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../app/config.ts";
import { geminiJson } from "../app/scenarios/gemini.ts";
import { ScamLibrary } from "../app/scenarios/library.ts";
import {
  buildPractice,
  FIXTURE_DIR,
  generatePracticeText,
  PRACTICE_FILE,
  PracticeText,
  TEXTS,
} from "../app/scenarios/practice.ts";

const library = ScamLibrary.load();
if (!library.found) {
  throw new Error(
    "backend/fixtures/scam-library.json is missing: build it with data-pipeline first",
  );
}
const committed: PracticeText[] = existsSync(PRACTICE_FILE)
  ? (JSON.parse(readFileSync(PRACTICE_FILE, "utf8")).texts ?? []).map(
      (t: unknown) => PracticeText.parse(t),
    )
  : [];

let texts = committed;
const flag = process.argv.find((arg) => arg.startsWith("--texts"));
if (flag) {
  const key = loadConfig().GEMINI_API_KEY;
  if (!key) throw new Error("--texts needs GEMINI_API_KEY in backend/.env");
  const model = geminiJson(key);
  texts = [];
  for (const [category, difficulty] of TEXTS) {
    const kept = committed.find((t) => t.scamCategory === category);
    if (kept && flag !== "--texts=all") {
      texts.push(kept);
      continue;
    }
    const written = await generatePracticeText(
      model,
      library,
      category,
      difficulty,
    );
    if (written) texts.push(written);
    else if (kept) {
      console.warn(
        `${category} text: Gemini failed twice; keeping the committed one`,
      );
      texts.push(kept);
    } else {
      console.warn(
        `${category} text: Gemini failed twice and nothing is committed; skipped`,
      );
    }
  }
}

const { practice, fixtures } = buildPractice(library, texts);
writeFileSync(PRACTICE_FILE, `${JSON.stringify(practice, null, 2)}\n`);
for (const file of readdirSync(FIXTURE_DIR).filter(
  (f) => f.endsWith(".json") && !(f in fixtures),
)) {
  rmSync(join(FIXTURE_DIR, file));
}
for (const [file, doc] of Object.entries(fixtures)) {
  writeFileSync(join(FIXTURE_DIR, file), `${JSON.stringify(doc, null, 2)}\n`);
}
console.log(
  `practice: ${practice.emails.length} emails, ${practice.texts.length} texts, ${practice.calls.length} calls; ${Object.keys(fixtures).length} comms fixtures`,
);
