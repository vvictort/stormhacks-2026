# Scam example library (`backend/fixtures/scam-library.json`)

Built offline by `data-pipeline/` (commands in `data-pipeline/README.md`). 496 examples, ~560 KB, rebuilt
byte-for-byte identically from the same raw data. Inspected 2026-10-04.

## Sources

### Email: `naserabdullahalam/phishing-email-dataset` (CC BY-SA 4.0)
Resolved from the input list of the notebook `zafko8/phishing-email-and-spam-sms-ai-detection-tool`
(its other inputs are SMS datasets and a small `ashfakyeafi/spam-email-classification` file of SMS-like text).
Public; downloads anonymously.

| File | Rows | Columns | Labels (1 = phishing/spam) | Used |
|---|---|---|---|---|
| Nazario.csv | 1,565 | sender, receiver, date, subject, body, urls, label | 1: all | yes (real phishing; best source) |
| CEAS_08.csv | 39,154 | same | 1: 21,842 / 0: 17,312 | yes (mostly pharma spam + mailing lists) |
| SpamAssasin.csv | 5,809 | same | 1: 1,718 / 0: 4,091 | yes |
| Nigerian_Fraud.csv | 3,332 | same | 1: all | yes (advance-fee; category stays null) |
| Enron.csv, Ling.csv | 29,767 / 2,859 | subject, body, label | mixed | no: real personal/academic mail |
| phishing_email.csv | 82,486 | text_combined, label | mixed | no: merge of the others (408 duplicate texts) |

Quality: no duplicate bodies within files; a few null subjects/receivers; 5 rows with empty body or bad label
(dropped). Bodies are flattened HTML with layout gaps, embedded raw headers (`Return-Path:`), quoted-printable
residue, MIME-encoded subjects, HTML+text parts repeated, non-English spam, and real recipient addresses
(the Nazario honeypot mailbox). 49,855 readable rows -> 18,326 after scrubbing/junk filtering -> **325 kept**
(250 scam: Nazario 184, Nigerian 32, SpamAssassin 23, CEAS 11; 75 legitimate: CEAS 61, SpamAssassin 14).

Redistribution: ShareAlike allows committing transformed excerpts with attribution; the excerpts in the JSON stay
under CC BY-SA 4.0 (attribution is in `sources[]` and every `source`). The compiled set aggregates older public
corpora (Nazario, CEAS 2008, SpamAssassin); we rely on the compiler's CC BY-SA grant.

### Call: `teeconnie/scam-and-non-scam-call-conversation-dataset` (CC BY-NC-ND 4.0)
`https://www.kaggle.com/dsv/11606256` is DOI 10.34740/kaggle/dsv/11606256 -> version 1 of this dataset
(Brendan Hong, Tee Connie; IEEE Access paper on scam-call classification). Public; downloads anonymously.
Two UTF-8 CRLF text files: `English_Scam.txt` (400 numbered single-turn caller monologues) and
`English_NonScam.txt` (400 paragraphs). Already de-identified with `[Name]`/`[Company]`/`[Number]` placeholders;
partly ChatGPT-augmented per the authors. No speaker turns, so "caller turns" = the whole monologue.

Redistribution: **NoDerivatives** -> `derived-only`. No transcript text is committed, not even edited. Each
example's `text` is a `pattern` summary composed by `tagging.pattern()` from fixed phrases chosen by keyword hits
("Caller claims to be from your bank -> says your account shows suspicious activity -> asks for the one-time code
-> pushes for action right away."). Checked on all 800 rows: no pattern shares a 5-word run with its source. 800 rows -> 171 unique
patterns kept (148 scam, 23 legitimate); the rest were exact duplicates of another pattern. (NonCommercial also
applies to the derived tags; fine for a hackathon/education demo, revisit before any commercial use.)

### SMS: competition `spam-detection-challenge` (NOT INCLUDED)
Kaggle competition data: the API returns 401 without credentials and rules must be accepted, so files, columns
and licence could not be inspected. The reader (`normalize/sms.py`) finds the text/label columns by common names
and skips unlabeled splits. Until the rules are confirmed to allow redistribution it is `derived-only` (patterns,
like calls). To add it: accept the rules on kaggle.com, set `KAGGLE_USERNAME`/`KAGGLE_KEY`, then
`python -m tellio_data download --channel sms && python -m tellio_data build` from `data-pipeline/`.

## What is in each example

- `kind`: from the dataset label (email 1 -> scam, 0 -> legitimate; call files). `source.label` keeps the raw label.
- `tactics`/`signals`/`cues`: regex rules in `tagging.py`, run on the **scrubbed** text, so every cue is an exact
  substring of the committed `text`. `verification_code` implies tactic `otp_request`; `credential_request` implies
  `info_request`. Legitimate examples carry no tactics, signals or cues.
- `category`: keyword scoring over subject + text; must win clearly, otherwise `null`. Advance-fee, inheritance,
  investment, tech-support, charity and "relative in trouble" scams are deliberately `null` (no Tellio category).
  Legitimate rows get a category only when their topic clearly matches (safe counter-examples).
- `difficulty`: scam = number of distinct tells (>=5 easy, 3-4 medium, else hard); legitimate = hard when it is on
  a scam-prone topic (has a category), else easy.

## Scrubbing (excerpts)
HTML/markup, raw headers and encoded junk removed; repeated HTML+text copies cut; URLs -> invented hosts under the
reserved `.example` TLD (suspicious-looking originals in scams -> `secure-account-verify.example` etc., so
`suspicious_domain` survives; anything else -> `links.example`), query strings dropped; emails -> `user@mail.example`
(generic local parts like `support@` kept); phones -> `555-0100`; long numbers -> `[number]`; street addresses ->
`[street address]`; greeting/sign-off/self-introduction names -> `Customer` / `[Name]`; real brands -> bracketed
roles (`[Bank]`, `[Payment Service]`, `[Card Network]`, `[Online Store]`, `[Tech Company]`, `[Email Provider]`,
`[Tax Agency]`, `[Government Agency]`, `[Courier]`, `[News Site]`). Rows dropped: too short, word salad,
non-English, pharma/adult/replica spam, and (legitimate only) mailing-list replies. Name detection is heuristic:
names in free text that match none of these shapes can remain.

## Coverage (scam examples; brackets = demo-ready: readable and >= 2 cues)

| category | call (pattern) | email (excerpt) |
|---|---|---|
| banking | 45 [45] | 70 [38] |
| government | 37 [35] | 16 [2] |
| shipping | 16 [16] | 23 [4] |
| account_security | 10 [10] | 70 [70] |
| workplace | 0 | 15 [10] |
| promotional | 10 [10] | 16 [6] |
| null | 30 [30] | 40 [40] |

Legitimate: email 75 (banking 3, government 5, shipping 4, account_security 2, workplace 7, promotional 9, null 45),
call 23 (shipping 3, null 20). SMS: none until credentials exist.

Tactics: info_request 190, suspicious_link 151, urgency 99, authority 88, fear 85, reward 82, otp_request 19.
Cues per scam example: 1: 38, 2: 164, 3: 106, 4: 60, 5: 26, 6: 4.

## Notes for consumers
- `textKind: pattern` rows are summaries, not messages: show them as "what the scammer does", or turn them into a
  script, but never present them as a quoted real message. Their cues quote the summary's own phrases.
- Bracketed placeholders (`[Bank]`, `[Name]`, `[number]`) appear in excerpts; substitute Tellio's fictional brands.
- `category: null` rows are real scams outside Tellio's six categories; exclude them from category retrieval.
- Email excerpts are real phishing: some are messy (all-caps, broken spacing). Prefer `cues.length >= 2`.
