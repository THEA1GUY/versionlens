/**
 * Confidence and review-priority scoring.
 *
 * Confidence is mostly deterministic on purpose: a model's self-reported certainty is
 * one of four signals, never the whole score.
 */

import { CATEGORY_WEIGHT, type Change, type Importance } from "./changes";

export const W_ALIGNMENT = 0.2;
export const W_DIFF = 0.25;
export const W_EXTRACTION = 0.3;
export const W_SEMANTIC = 0.25;

export interface ConfidenceInput {
  alignment?: number | null;
  diff?: number | null;
  extraction?: number | null;
  semantic?: number | null;
}

/**
 * Weighted mean over the signals that actually fired, renormalised.
 *
 * A change found by structured extraction alone still scores well, because that
 * detector is exact. A change supported only by a model's opinion cannot exceed the
 * semantic weight on its own.
 */
export function confidence(input: ConfidenceInput): {
  score: number;
  signals: Record<string, number>;
} {
  const parts: Array<[string, number | null | undefined, number]> = [
    ["alignment", input.alignment, W_ALIGNMENT],
    ["diff", input.diff, W_DIFF],
    ["extraction", input.extraction, W_EXTRACTION],
    ["semantic", input.semantic, W_SEMANTIC],
  ];
  const present = parts.filter(
    (p): p is [string, number, number] => p[1] !== null && p[1] !== undefined,
  );
  const signals: Record<string, number> = {};
  for (const [name, value] of present) signals[name] = round(value, 4);
  if (present.length === 0) return { score: 0, signals };

  const totalWeight = present.reduce((s, p) => s + p[2], 0);
  const raw = present.reduce((s, p) => s + p[1] * p[2], 0) / totalWeight;
  return { score: round(Math.max(0, Math.min(1, raw)), 4), signals };
}

/** The UI never shows fake precision like "96.4732%". */
export function confidenceLabel(score: number): string {
  if (score >= 0.8) return "High confidence";
  if (score >= 0.55) return "Medium confidence";
  return "Low confidence";
}

const BIG_PERCENT = 10;
const BIG_DAYS = 14;

export function importance(change: Change): { level: Importance; score: number } {
  let score = Math.max(
    ...(change.categories.length > 0
      ? change.categories.map((c) => CATEGORY_WEIGHT[c] ?? 1)
      : [1]),
  );

  if (change.type === "SECTION_ADDED" || change.type === "SECTION_REMOVED") score += 2;
  else if (change.type === "ADDED" || change.type === "REMOVED") score += 1;
  else if (change.type === "MEANING_CHANGED") score += 1;
  else if (change.type === "MOVED") score -= 2;
  else if (change.type === "SECTION_RENAMED") score = Math.min(score, 1);

  const d = change.delta ?? {};
  if (isBig(d.percentage, BIG_PERCENT)) score += 1;
  if (isBig(d.days, BIG_DAYS)) score += 1;
  if (isBig(d.percentagePoints, BIG_PERCENT)) score += 1;
  if (isBig(d.strengthChange, 2)) score += 1;

  const only = new Set(change.categories);
  if (only.size === 1 && only.has("FORMATTING")) {
    score = 0;
  } else if (only.size === 1 && only.has("WORDING") && change.type !== "MEANING_CHANGED") {
    score = Math.min(score, 1);
  }

  const level: Importance = score >= 4 ? "HIGH" : score >= 2 ? "MEDIUM" : "LOW";
  return { level, score: round(score, 2) };
}

function isBig(value: number | null | undefined, threshold: number): boolean {
  return typeof value === "number" && Math.abs(value) >= threshold;
}

function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}
