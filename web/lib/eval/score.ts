/**
 * Evaluation scoring.
 *
 * Measures the engine that actually ships. Reports a per-category breakdown and a
 * severity-weighted recall, because an overall 95% can hide one weak category, and a
 * missed comma should not count the same as a missed million.
 */

import type { Change } from "../engine/changes";
import type { ComparisonResult } from "../engine/compare";

export interface GroundTruth {
  id: string;
  category: string;
  importance: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  note: string;
  /** Every marker must appear in the reported change for it to count as detected. */
  match: string[];
  /**
   * "single" (default) requires one change to carry every marker. "split" accepts the
   * markers spread across several changes, for edits the engine reports as a removal
   * plus an addition rather than one modification — a legitimate outcome when pairing
   * the two clauses would be a guess.
   */
  matchMode?: "single" | "split";
  expect?: {
    old?: number | string;
    new?: number | string;
    absolute?: number;
    percentage?: number;
    days?: number;
    percentagePoints?: number;
  };
}

export const SEVERITY_WEIGHT: Record<GroundTruth["importance"], number> = {
  CRITICAL: 5,
  HIGH: 4,
  MEDIUM: 2,
  LOW: 1,
};

export interface CategoryRow {
  known: number;
  detected: number;
  missed: number;
  wrongCategory: number;
}

export interface PairScore {
  pair: string;
  known: number;
  detected: number;
  missed: Array<{ id: string; note: string }>;
  /**
   * Reported changes no label accounts for. Kept separate from "false alert": on a
   * partially-labelled pair an unlabelled detection may well be a real change nobody
   * wrote down.
   */
  unmatched: Array<{ id: string; category: string; importance: string; summary: string }>;
  citationOk: number;
  citationChecked: number;
  categoryOk: number;
  weightedKnown: number;
  weightedDetected: number;
  valueOk: number;
  valueChecked: number;
  byCategory: Record<string, CategoryRow>;
  totalChanges: number;
}

function haystack(change: Change): string {
  return [
    change.summary,
    change.textA,
    change.textB,
    change.sectionA ?? "",
    change.sectionB ?? "",
    JSON.stringify(change.oldValue ?? {}),
    JSON.stringify(change.newValue ?? {}),
  ]
    .join(" ")
    .toLowerCase();
}

function sameNumber(expected: unknown, actual: unknown): boolean {
  const a = Number(expected);
  const b = Number(actual);
  if (Number.isFinite(a) && Number.isFinite(b)) return Math.abs(a - b) < 0.01;
  return String(expected).toLowerCase() === String(actual).toLowerCase();
}

/** True only when every numeric expectation the label states is met. */
function valuesAgree(record: GroundTruth, change: Change): boolean {
  const e = record.expect;
  if (!e) return false;
  let checks = 0;
  let passed = 0;
  const check = (expected: unknown, actual: unknown): void => {
    if (expected === undefined) return;
    checks += 1;
    if (sameNumber(expected, actual)) passed += 1;
  };
  check(e.old, change.oldValue?.value);
  check(e.new, change.newValue?.value);
  check(e.absolute, change.delta?.absolute);
  check(e.percentage, change.delta?.percentage);
  check(e.days, change.delta?.days);
  check(e.percentagePoints, change.delta?.percentagePoints);
  return checks > 0 && passed === checks;
}

/** A labelled change is detected when some reported change carries all its markers. */
function findMatch(record: GroundTruth, changes: Change[]): Change | null {
  const needles = record.match.map((m) => m.toLowerCase());
  if (record.matchMode === "split") return findSplitMatch(needles, changes);
  let best: Change | null = null;
  let bestRank = -1;
  for (const change of changes) {
    const blob = haystack(change);
    if (!needles.every((n) => blob.includes(n))) continue;
    let rank = 1;
    if (valuesAgree(record, change)) rank += 2;
    if (change.categories.includes(record.category as Change["category"])) rank += 1;
    if (change.importance !== "LOW") rank += 0.5;
    if (rank > bestRank) {
      best = change;
      bestRank = rank;
    }
  }
  return best;
}

/**
 * Split reports: the markers may land on different changes. Returns the highest-priority
 * contributing change so citation and category are still checked against something real.
 */
function findSplitMatch(needles: string[], changes: Change[]): Change | null {
  const contributors: Change[] = [];
  const covered = new Set<string>();
  for (const change of changes) {
    const blob = haystack(change);
    const hits = needles.filter((n) => blob.includes(n));
    if (hits.length === 0) continue;
    contributors.push(change);
    for (const n of hits) covered.add(n);
  }
  if (covered.size !== needles.length) return null;
  const rank = { HIGH: 0, MEDIUM: 1, LOW: 2 } as const;
  contributors.sort((a, b) => rank[a.importance] - rank[b.importance]);
  return contributors[0] ?? null;
}

/** Citation accuracy: the cited text must actually contain the labelled marker. */
function citationSupports(record: GroundTruth, change: Change): boolean {
  const needles = record.match.map((m) => m.toLowerCase());
  if (needles.length === 0) return true;
  const cited = [
    change.citationA?.text ?? "",
    change.citationB?.text ?? "",
    change.textA,
    change.textB,
  ]
    .join(" ")
    .toLowerCase();
  return needles.some((n) => cited.includes(n));
}

export function scorePair(
  pairName: string,
  truth: GroundTruth[],
  result: ComparisonResult,
): PairScore {
  const score: PairScore = {
    pair: pairName,
    known: 0,
    detected: 0,
    missed: [],
    unmatched: [],
    citationOk: 0,
    citationChecked: 0,
    categoryOk: 0,
    weightedKnown: 0,
    weightedDetected: 0,
    valueOk: 0,
    valueChecked: 0,
    byCategory: {},
    totalChanges: result.changes.length,
  };

  const claimed = new Set<string>();

  for (const record of truth) {
    const weight = SEVERITY_WEIGHT[record.importance];
    score.known += 1;
    score.weightedKnown += weight;
    const bucket = (score.byCategory[record.category] ??= {
      known: 0,
      detected: 0,
      missed: 0,
      wrongCategory: 0,
    });
    bucket.known += 1;

    const hit = findMatch(record, result.changes);
    if (!hit) {
      score.missed.push({ id: record.id, note: record.note });
      bucket.missed += 1;
      continue;
    }

    claimed.add(hit.id);
    score.detected += 1;
    score.weightedDetected += weight;
    bucket.detected += 1;

    if (hit.categories.includes(record.category as Change["category"])) score.categoryOk += 1;
    else bucket.wrongCategory += 1;

    score.citationChecked += 1;
    if (citationSupports(record, hit)) score.citationOk += 1;

    if (record.expect) {
      score.valueChecked += 1;
      if (valuesAgree(record, hit)) score.valueOk += 1;
    }
  }

  for (const change of result.changes) {
    if (claimed.has(change.id)) continue;
    // Minor changes are collapsed in the UI and deliberately not labelled.
    if (change.importance === "LOW") continue;
    score.unmatched.push({
      id: change.id,
      category: change.category,
      importance: change.importance,
      summary: change.summary,
    });
  }

  return score;
}

export interface EvalReport {
  pairs: number;
  knownChanges: number;
  detected: number;
  missed: number;
  unmatchedDetections: number;
  recall: number;
  precisionVsLabels: number;
  f1: number;
  severityWeightedRecall: number;
  citationAccuracy: number;
  categoryAccuracy: number;
  valueAccuracy: number;
  byCategory: Record<string, CategoryRow>;
}

export function aggregate(scores: PairScore[]): EvalReport {
  const sum = (pick: (s: PairScore) => number): number =>
    scores.reduce((acc, s) => acc + pick(s), 0);

  const known = sum((s) => s.known);
  const detected = sum((s) => s.detected);
  const missed = sum((s) => s.missed.length);
  const unmatched = sum((s) => s.unmatched.length);
  const weightedKnown = sum((s) => s.weightedKnown);
  const weightedDetected = sum((s) => s.weightedDetected);
  const citationOk = sum((s) => s.citationOk);
  const citationChecked = sum((s) => s.citationChecked);
  const categoryOk = sum((s) => s.categoryOk);
  const valueOk = sum((s) => s.valueOk);
  const valueChecked = sum((s) => s.valueChecked);

  const recall = known > 0 ? detected / known : 0;
  const precision = detected + unmatched > 0 ? detected / (detected + unmatched) : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  const byCategory: Record<string, CategoryRow> = {};
  for (const s of scores) {
    for (const [cat, row] of Object.entries(s.byCategory)) {
      const target = (byCategory[cat] ??= { known: 0, detected: 0, missed: 0, wrongCategory: 0 });
      target.known += row.known;
      target.detected += row.detected;
      target.missed += row.missed;
      target.wrongCategory += row.wrongCategory;
    }
  }

  return {
    pairs: scores.length,
    knownChanges: known,
    detected,
    missed,
    unmatchedDetections: unmatched,
    recall,
    precisionVsLabels: precision,
    f1,
    severityWeightedRecall: weightedKnown > 0 ? weightedDetected / weightedKnown : 0,
    citationAccuracy: citationChecked > 0 ? citationOk / citationChecked : 0,
    categoryAccuracy: detected > 0 ? categoryOk / detected : 0,
    valueAccuracy: valueChecked > 0 ? valueOk / valueChecked : 0,
    byCategory,
  };
}

export function formatReport(report: EvalReport, scores: PairScore[]): string {
  const pct = (n: number): string => `${(n * 100).toFixed(1)}%`;
  const lines: string[] = [
    "",
    `Evaluation — ${report.pairs} pair(s), deterministic layers only`,
    "",
    `  Known changes              ${report.knownChanges}`,
    `  Detected                   ${report.detected}`,
    `  Missed                     ${report.missed}`,
    `  Unmatched detections       ${report.unmatchedDetections}`,
    `  Recall                     ${pct(report.recall)}`,
    `  Precision (vs labels)      ${pct(report.precisionVsLabels)}`,
    `  F1                         ${pct(report.f1)}`,
    `  Severity-weighted recall   ${pct(report.severityWeightedRecall)}`,
    `  Citation accuracy          ${pct(report.citationAccuracy)}`,
    `  Category accuracy          ${pct(report.categoryAccuracy)}`,
    `  Value accuracy             ${pct(report.valueAccuracy)}`,
    "",
    `  ${"Category".padEnd(20)}${"Known".padStart(7)}${"Found".padStart(7)}${"Missed".padStart(8)}${"WrongCat".padStart(10)}`,
  ];
  for (const [cat, row] of Object.entries(report.byCategory).sort()) {
    lines.push(
      `  ${cat.padEnd(20)}${String(row.known).padStart(7)}${String(row.detected).padStart(7)}` +
        `${String(row.missed).padStart(8)}${String(row.wrongCategory).padStart(10)}`,
    );
  }
  for (const s of scores) {
    if (s.missed.length > 0) {
      lines.push("", `  MISSED in ${s.pair}:`);
      for (const m of s.missed) lines.push(`    - ${m.id}: ${m.note}`);
    }
    if (s.unmatched.length > 0) {
      lines.push("", `  UNMATCHED in ${s.pair} (unlabelled real change, or false alert):`);
      for (const u of s.unmatched) {
        lines.push(`    ? ${u.importance.padEnd(7)}${u.category.padEnd(18)}${u.summary.slice(0, 80)}`);
      }
    }
  }
  return lines.join("\n");
}
