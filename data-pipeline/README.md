# data-pipeline

Offline Python pipeline that turns three Kaggle scam datasets into `backend/fixtures/scam-library.json`,
the curated example library the backend reads (Gemini grounding, and later scenarios built from real rows).
Nothing at Tellio runtime calls Python or Kaggle; this runs on a laptop and the JSON is committed.

```
data-pipeline/
  requirements.txt        pandas + kagglehub, pinned
  tellio_data/
    __main__.py           CLI: python -m tellio_data {download,build,stats} [--channel email|sms|call]
    sources.py            dataset registry: Kaggle handle, URL, licence, redistribution mode
    vocabulary.py         Channel/Tactic/ScamCategory/Difficulty parsed from backend/app/shared/vocabulary.ts
    download.py           kagglehub into raw/ (gitignored)
    normalize/            per-dataset readers -> raw records (email.py, sms.py, calls.py)
    scrub.py              HTML/header junk, PII, URLs, brand names, off-topic spam
    tagging.py            deterministic tactics, signals, cues, category, difficulty; pattern summaries
    curate.py             dedupe (exact + near-duplicate) and seeded diversity sampling
    validate.py           schema check of the output contract
    build.py              writes backend/fixtures/scam-library.json
  tests/                  stdlib unittest; tests/fixtures/ are SYNTHETIC, hand-written rows
  raw/                    downloads (gitignored)
```

## Commands (from `data-pipeline/`)

```bash
/usr/bin/python3.12 -m venv .venv && .venv/bin/pip install -r requirements.txt   # setup
.venv/bin/python -m tellio_data download            # all sources (email + call work anonymously)
.venv/bin/python -m tellio_data build               # ~2 min; writes and validates the JSON, prints coverage
.venv/bin/python -m tellio_data stats               # coverage tables + validation of the committed JSON
.venv/bin/python -m unittest                        # tests (synthetic fixtures + the committed JSON)
```

All three sources download anonymously. The preferred SMS source, the `spam-detection-challenge` Kaggle competition,
needs a login and accepted rules, so the public UCI SMS Spam Collection is used instead (`sources.py`); the SMS reader
finds columns by name, so another labelled SMS CSV can replace it.

A build skips any channel whose raw data is missing and says so; the rest of the library is still written.
Files dropped by hand into `raw/<slug>/` are picked up too.

The app's practice path is built from this library by `backend/scripts/build-practice.ts` (`npm run build:practice` in
`backend/`); run it after rebuilding the library.

## Licences and what is committed

| Channel | Dataset | Licence | Committed |
|---|---|---|---|
| email | `naserabdullahalam/phishing-email-dataset` | CC BY-SA 4.0 | scrubbed excerpts (`textKind: excerpt`); these excerpts remain CC BY-SA 4.0 with attribution |
| call | `teeconnie/scam-and-non-scam-call-conversation-dataset` | CC BY-NC-ND 4.0 | **derived-only**: no transcript text, not even edited; `text` is a pattern summary this code writes from tags |
| sms | `uciml/sms-spam-collection-dataset` (UCI SMS Spam Collection) | CC BY 4.0 (at its origin, the UCI ML Repository; Kaggle lists "Unknown") | scrubbed excerpts with attribution |

Raw downloads never leave `raw/`. Details, dataset inspection notes and coverage: `docs/dataset.md`.

## Output contract

`backend/fixtures/scam-library.json`, deterministic (fixed seed, no timestamps):

```
{ "version": 1,
  "sources":  [{ channel, dataset, url, license, redistribution: "excerpts" | "derived-only" }],
  "examples": [{ id: "<channel>-<sha1(dataset + ':' + row)[:12]>", channel, kind: "scam" | "legitimate",
                 category: ScamCategory | null, tactics: Tactic[] (<=4, [] if legitimate), signals: string[],
                 cues: [{ tag, quote }] (<=6, exact case-sensitive substrings of text, in order, non-overlapping),
                 difficulty, text (<=1200), textKind: "excerpt" | "pattern", subject? (email, <=200),
                 source: { dataset, license, row, label } }] }
```

`source.label` is the dataset's own label (`1`/`0` for email, `scam`/`non-scam` for calls); `tactics`, `signals`,
`cues`, `category` and `difficulty` are Tellio's heuristics (`tagging.py`) and nothing else. `validate.py` enforces
all of this on every build.
