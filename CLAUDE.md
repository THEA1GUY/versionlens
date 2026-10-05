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

- Engine, API and web workspace are complete and wired together.
- 91 tests pass (`python -m pytest tests -q`).
- Evaluation on the demo pair: 100% recall / 100% precision-vs-labels / 100% citation
  accuracy across 17 labelled changes. **This is a controlled pair.** It proves the
  pipeline, not the product. Real labelled pairs under `eval/dataset/` are the next thing
  that would actually move the quality numbers.
- Semantic layer is implemented but unexercised against a live model — no API key was
  configured during the build. The deterministic path is what has been verified.

## Before changing the engine

Run both, not just the tests:

```bash
python -m pytest tests -q
python -m eval.run_eval
```

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
