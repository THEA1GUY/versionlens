# VersionLens — working notes

Document version comparison with source-backed citations. Read `README.md` first for what
it is and how to run it; this file is about working on it.

## The one rule

**Citations come from the document model, never from a model.** The semantic layer
receives block IDs and must echo them back; anything referencing an ID it was not given is
discarded in `engine/semantic.py:_parse_finding`. If a change cannot point at a real block
in a stored document, it is a bug, not a low-confidence result.

Everything else follows from this ordering:

```
Deterministic where possible. AI where useful. Source-backed everywhere.
Human-reviewed for final judgment.
```

## Current state

**The product is the TypeScript engine in `web/`, running in the browser.** The Python
`engine/` and `api/` are the original implementation, kept as a cross-check and as the
self-hosted path for work the browser cannot do (OCR, LibreOffice conversion). They are
not what ships, so do not fix a bug there and assume users got it.

- `web/` — 94 tests (`cd web && npm test`), typecheck, and a static build.
- Evaluation runs against the shipped engine: `cd web && npx vitest run lib/eval`.
- 91 Python tests still pass (`python -m pytest tests -q`) for the reference engine.
- Evaluation on the demo pair: 100% recall / 100% precision-vs-labels / 100% citation
  accuracy across 17 labelled changes. **This is a controlled pair.** It proves the
  pipeline, not the product. Real labelled pairs under `eval/dataset/` are the next thing
  that would actually move the quality numbers.
- Semantic layer is live and verified against DeepSeek (`deepseek-chat`). On the demo
  pair it corroborates existing findings and lifts category accuracy 94.1% -> 100%.
  Credentials live in a gitignored `.env`; `.env.example` documents the shape.
- The deterministic path still stands alone: every test runs with `use_semantic=False`,
  so the suite never needs network or credits.

## Before changing the engine

Run both, not just the tests:

```bash
cd web && npm test          # unit tests + the evaluation gate
```

The evaluation gate enforces the spec targets (95% recall, 90% precision, 98% citation
accuracy, 95% severity-weighted recall, and exact reproduction of every stated numeric
expectation). It prints a per-category table so a regression shows what moved.

A change that keeps tests green but drops recall is a regression. The eval harness reports
per-category breakdowns for exactly this reason.

## Tuning knobs, and what they cost

| Where | Knob | Effect |
|---|---|---|
| `align.py` | `SECTION_MATCH_THRESHOLD` | Lower = more sections pair; too low pairs unrelated sections |
| `align.py` | `BLOCK_MATCH_THRESHOLD` | Lower = fewer add/remove pairs, more bogus "wording changed" |
| `align.py` | `W_LEXICAL` / `W_CONTENT_IDF` | The rewrite-vs-boilerplate discrimination. See README |
| `align.py` | `HEADING_FAMILIES` | Covers contract renames. Add families, don't special-case |
| `changes.py` | `CATEGORY_KEYWORDS` | Order matters — first match becomes the primary category |
| `score.py` | `W_*` | Confidence weights; semantic is one of four signals, never the whole score |
| `reconcile.py` | `_FALLBACK_TYPES` | Only exact values belong here. Obligations need real clause alignment |

When you tune a threshold, measure it. The probes that set the current values compared
true pairs against false pairs on actual clause text — guessing a number here is how the
training/analytics false pairing got shipped the first time.

## Traps already hit

- **Bare `N` before digits.** The naira shorthand `N3,500,000` made "withi**n 45** days"
  into a currency amount. The money regex now requires an uppercase `N` starting a word and
  running straight into digits. Tests in `test_bare_number_is_not_money`.
- **Block IDs are side-neutral** (`p1-b26`, not `A-p1-b26`). A block ID identifies a
  position inside one document; which document is carried separately. This is what lets a
  stored extraction and a citation produced during a comparison agree. It also means
  `p2-b5` exists in *both* documents — never mix IDs from the two sides in one set.
- **Equal values can still be a change.** Two obligations with the same modality can differ
  in frequency or negation. The early-return in `structured.py:_compare_pair` must let
  obligations fall through, or they lose their citations.
- **One change, one alert.** Blocks inside a wholly added/removed section are suppressed —
  the section change carries them. Three alerts for one removed clause is the failure mode.
  The semantic layer breaks this the same way: when it flags a meaning change on a passage
  structured extraction already explained, it must record itself on that change (detector +
  note) rather than append a second one. Turning the LLM on raised the demo from 24 to 25
  changes until this was fixed.
- **Config is read per-instance, not at import.** `SemanticAnalyzer` reads env in
  `__init__`; module-level constants were evaluated before `.env` loaded, so the key was
  invisible no matter what the file said.
- **Tailwind v4 pins must match exactly.** `tailwindcss`, `@tailwindcss/postcss` and the
  native `@tailwindcss/oxide` resolving to different versions fails with
  `Missing field 'negated' on ScannerOptions.sources`.

## Conventions

- Python: type hints everywhere, pydantic for API schemas, stdlib over dependencies.
  No ORM — hand-written SQL against sqlite3.
- TypeScript: strict, `noUncheckedIndexedAccess` on, no `any`.
- UI: light and editorial — paper surfaces, hairline rules, one ink accent. Attention
  levels carry a word and a mark, not colour alone. No gradients, no glow, no emoji.
- Say "review priority", never "legal risk". Never assert a clause is illegal,
  unenforceable or risky. There is a test asserting the absence of those words.
- Never claim documents are identical unless `_deterministically_identical` says so.

## Things deliberately not built

Listed so they are not mistaken for oversights: OCR, embeddings for section alignment, a
real job queue, authentication, multi-version (3+) comparison, PDF coordinate overlay
rendering in the browser (bboxes are captured and stored, just not drawn).
