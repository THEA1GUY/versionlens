/**
 * Multi-version comparison.
 *
 * Alignment is pairwise, and chaining A->B->C compounds alignment error silently, so this
 * does not try to align three documents at once. It runs the ordinary comparison on each
 * consecutive pair — every step keeps its own citations and confidence — and then stitches
 * the structured value changes into a timeline.
 *
 * Stitching uses the one join that is actually sound: a step's new value is the next
 * step's old value, for the same kind of thing. That answers the question people really
 * ask of a negotiation ("how did the price move across all four rounds?") without
 * pretending to a clause identity the engine has not established.
 */

import type { Category, Change } from "./engine/changes";
import type { StoredComparison } from "./store/db";

export interface TimelinePoint {
  /** Index into the version list this value was observed at. */
  versionIndex: number;
  value: number | string;
  display: string;
  changeId: string;
  comparisonId: string;
}

export interface TimelineRow {
  key: string;
  label: string;
  category: Category;
  unit: string | null;
  currency: string | null;
  /** One entry per version, null where the value was not observed at that version. */
  points: Array<TimelinePoint | null>;
  /** Net movement from first observed to last, when both are numeric. */
  netAbsolute: number | null;
  netPercentage: number | null;
  steps: number;
}

const TRACKED_UNITS = new Set(["days", "weeks", "months", "years", "hours", "percent"]);

function isTracked(change: Change): boolean {
  if (!change.oldValue || !change.newValue) return false;
  const oldV = change.oldValue.value;
  const newV = change.newValue.value;
  if (typeof oldV !== "number" || typeof newV !== "number") return false;
  if (change.oldValue.currency || change.newValue.currency) return true;
  const unit = change.newValue.unit ?? change.oldValue.unit ?? "";
  return TRACKED_UNITS.has(unit);
}

/** Groups comparable things: the same currency, or the same kind of duration. */
function groupKey(change: Change): string {
  const v = change.newValue ?? change.oldValue;
  if (!v) return change.category;
  if (v.currency) return `MONEY|${v.currency}|${change.category}`;
  const unit = v.unit ?? "";
  const kind = v.kind ?? v.context ?? "general";
  return `${unit}|${kind}|${change.category}`;
}

function display(value: number | string, unit: string | null, currency: string | null): string {
  if (typeof value !== "number") return String(value);
  const glyph = currency
    ? ({ NGN: "₦", USD: "$", GBP: "£", EUR: "€", JPY: "¥" } as Record<string, string>)[currency] ?? ""
    : "";
  const body = value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (glyph) return `${glyph}${body}`;
  if (unit === "percent") return `${body}%`;
  return unit ? `${body} ${unit}` : body;
}

function labelFor(change: Change): string {
  const v = change.newValue ?? change.oldValue;
  const kind = v?.kind ?? v?.context;
  if (kind && kind !== "general") {
    return kind.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
  }
  if (v?.currency) return "Amount";
  if (v?.unit === "percent") return "Percentage";
  return change.category.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

/**
 * @param steps consecutive comparisons, oldest first. `steps[i]` compares version `i`
 *              with version `i + 1`.
 */
export function buildTimeline(steps: StoredComparison[]): TimelineRow[] {
  const versions = steps.length + 1;
  const rows = new Map<string, TimelineRow>();

  steps.forEach((step, stepIndex) => {
    for (const change of step.result?.changes ?? []) {
      if (!isTracked(change)) continue;
      const key = groupKey(change);
      const v = change.newValue ?? change.oldValue;
      const unit = v?.unit ?? null;
      const currency = v?.currency ?? null;

      let row = rows.get(key);
      if (!row) {
        row = {
          key,
          label: labelFor(change),
          category: change.category,
          unit,
          currency,
          points: new Array<TimelinePoint | null>(versions).fill(null),
          netAbsolute: null,
          netPercentage: null,
          steps: 0,
        };
        rows.set(key, row);
      }

      const oldValue = change.oldValue?.value;
      const newValue = change.newValue?.value;
      if (oldValue !== undefined && oldValue !== null && row.points[stepIndex] === null) {
        row.points[stepIndex] = {
          versionIndex: stepIndex,
          value: oldValue,
          display: display(oldValue, unit, currency),
          changeId: change.id,
          comparisonId: step.id,
        };
      }
      if (newValue !== undefined && newValue !== null) {
        row.points[stepIndex + 1] = {
          versionIndex: stepIndex + 1,
          value: newValue,
          display: display(newValue, unit, currency),
          changeId: change.id,
          comparisonId: step.id,
        };
      }
      row.steps += 1;
    }
  });

  for (const row of rows.values()) {
    const observed = row.points.filter((p): p is TimelinePoint => p !== null);
    const first = observed[0];
    const last = observed[observed.length - 1];
    if (first && last && typeof first.value === "number" && typeof last.value === "number") {
      row.netAbsolute = Math.round((last.value - first.value) * 100) / 100;
      row.netPercentage =
        first.value !== 0
          ? Math.round(((last.value - first.value) / first.value) * 10000) / 100
          : null;
    }
  }

  // Most-moved first: a value that changed at every round is the story of the negotiation.
  return [...rows.values()].sort(
    (a, b) => b.steps - a.steps || Math.abs(b.netPercentage ?? 0) - Math.abs(a.netPercentage ?? 0),
  );
}

export interface ChainSummary {
  versions: number;
  totalChanges: number;
  highAttention: number;
  perStep: Array<{ comparisonId: string; label: string; total: number; high: number }>;
}

export function summariseChain(steps: StoredComparison[], names: string[]): ChainSummary {
  const perStep = steps.map((step, i) => {
    const changes = step.result?.changes ?? [];
    return {
      comparisonId: step.id,
      label: `${names[i] ?? `v${i + 1}`} → ${names[i + 1] ?? `v${i + 2}`}`,
      total: changes.length,
      high: changes.filter((c) => c.importance === "HIGH").length,
    };
  });
  return {
    versions: steps.length + 1,
    totalChanges: perStep.reduce((s, x) => s + x.total, 0),
    highAttention: perStep.reduce((s, x) => s + x.high, 0),
    perStep,
  };
}
