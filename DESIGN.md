# DESIGN.md — VersionLens

## Theme

A forensic instrument read in daylight. Cool near-neutrals, one precise accent, and a
typographic system where each register means something specific. Light is the default
because the work is sustained document reading under office light; dark is fully supported
because contract review happens late.

**Color strategy: Restrained.** Tinted neutrals plus a single accent used only for primary
action, current selection and state. Semantic colour is reserved for attention level and
change direction, and never carries meaning alone.

Neutrals are tinted toward the accent's own hue at very low chroma (0.003–0.012), not
toward warm-by-default. Deliberately not a warm paper palette.

## Color

All values OKLCH.

### Light (default)

| Token | Value | Role |
|---|---|---|
| `--bg` | `oklch(0.983 0.003 262)` | App ground |
| `--surface` | `oklch(1 0 0)` | Cards, panes, rows |
| `--surface-sunk` | `oklch(0.967 0.004 262)` | Toolbars, table headers, insets |
| `--ink` | `oklch(0.24 0.014 262)` | Body text |
| `--ink-muted` | `oklch(0.47 0.012 262)` | Secondary text — passes 4.5:1 |
| `--ink-faint` | `oklch(0.60 0.010 262)` | Labels, metadata — large/bold only |
| `--line` | `oklch(0.906 0.005 262)` | Borders |
| `--line-soft` | `oklch(0.945 0.004 262)` | Internal dividers |
| `--accent` | `oklch(0.52 0.172 262)` | Primary action, selection, focus |
| `--accent-ink` | `oklch(0.42 0.160 262)` | Accent text on light |
| `--accent-wash` | `oklch(0.953 0.021 262)` | Selected row, highlight |
| `--raise` | `oklch(0.48 0.148 24)` | High attention, removals |
| `--raise-wash` | `oklch(0.961 0.019 24)` | |
| `--watch` | `oklch(0.52 0.106 68)` | Medium attention, warnings |
| `--watch-wash` | `oklch(0.964 0.027 68)` | |
| `--drop` | `oklch(0.46 0.098 157)` | Additions, confirmed |
| `--drop-wash` | `oklch(0.957 0.027 157)` | |

### Dark

Same roles, re-derived rather than inverted. Surfaces lift with elevation; accent and
semantics gain lightness so they stay legible on dark ground.

| Token | Value |
|---|---|
| `--bg` | `oklch(0.165 0.008 262)` |
| `--surface` | `oklch(0.204 0.009 262)` |
| `--surface-sunk` | `oklch(0.183 0.008 262)` |
| `--ink` | `oklch(0.94 0.004 262)` |
| `--ink-muted` | `oklch(0.74 0.010 262)` |
| `--ink-faint` | `oklch(0.60 0.010 262)` |
| `--line` | `oklch(0.295 0.010 262)` |
| `--line-soft` | `oklch(0.243 0.009 262)` |
| `--accent` | `oklch(0.72 0.145 262)` |
| `--accent-wash` | `oklch(0.285 0.055 262)` |
| `--raise` | `oklch(0.74 0.130 24)` |
| `--watch` | `oklch(0.80 0.105 72)` |
| `--drop` | `oklch(0.75 0.115 157)` |

Theme follows the OS by default and can be overridden; the choice persists per device.

## Typography

**One superfamily, three semantic registers.** IBM Plex was designed as a system, so the
three faces share proportions and the contrast reads as meaning rather than decoration.

| Register | Face | Carries |
|---|---|---|
| UI | IBM Plex Sans | Chrome, labels, summaries, buttons, tables |
| Data | IBM Plex Mono | Amounts, deltas, dates, SHA-256, block ids, section numbers |
| Source | IBM Plex Serif | **Only** text quoted from a document |

The serif is not decorative: it marks "these words came from the contract" and separates
evidence from the tool's own voice at a glance. Mono marks "compare this character by
character".

### Scale

Fixed rem, ratio ≈1.125 from a 14px base. Dense product UI, not fluid display type.

`--text-2xs` 11px · `--text-xs` 12px · `--text-sm` 13px · `--text-base` 14px ·
`--text-md` 15px · `--text-lg` 17px · `--text-xl` 19px · `--text-2xl` 22px ·
`--text-3xl` 26px · `--text-4xl` 30px

Tracking tightens as size grows: `0.01em` at label sizes, `0` at body, `-0.011em` at 22px,
`-0.018em` at 26px, `-0.022em` at 30px. Floor is `-0.03em`.

Weights: 400 body, 450 emphasis, 500 headings and buttons, 600 only for the highest-signal
figures. Tabular numerals wherever digits align.

## Spacing

4px base, Mercury-style scale: 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96.
Panel padding 12–16. Card padding 14. Row padding 12/16. Section gaps 24–32.

## Radius & elevation

Radius: 4px controls, 6px cards and panes, 8px popovers, 999px pills.

Elevation is mostly borders. Two shadows only: `--shadow-pop` for popovers and
`--shadow-rail` for sticky toolbars over scrolled content. No shadows on static cards.

## Components

Every interactive element ships default, hover, focus-visible, active, disabled and — where
it fetches or computes — loading and error.

- **Buttons:** solid (primary), outline (secondary), ghost (tertiary). One shape across the
  app: 4px radius, 28px compact / 32px default height.
- **Change card:** the core object. Attention badge + category + type, claim, the value
  shift in mono, then the two-column evidence spread. Selected state is an accent ring, not
  a fill.
- **Tables:** sunk header, hairline row dividers, hover tint, right-aligned tabular figures.
- **Empty states** teach the next action. **Skeletons**, not centred spinners, for content
  that is loading.

## Motion

160–220ms, `cubic-bezier(0.22, 1, 0.36, 1)` (ease-out-quint). Motion conveys state change
only: selection, panel open, row enter, toast. No page-load choreography. All of it
collapses to an instant change under `prefers-reduced-motion`.

## Keyboard

The review loop is fully keyboard-driven, because a reviewer works through a list.

`j`/`k` or `↓`/`↑` move between changes · `c` confirm · `x` false alert · `d` needs
discussion · `Enter` open the citation · `/` search · `g` then `s`/`c`/`m` switch tab ·
`?` shortcuts · `⌘K` command palette.
