/**
 * The quality gate.
 *
 * Runs the shipped engine against every labelled pair and enforces the targets. A change
 * that keeps the unit tests green but drops recall is a regression, and this is what
 * catches it.
 *
 * Add real pairs under `lib/eval/dataset/` — these synthetic ones prove the pipeline,
 * not the product.
 */

import { describe, expect, it } from "vitest";
import { compareDocuments } from "../engine/compare";
import { extractPlainText } from "../engine/extract";
import { GROUND_TRUTH, VERSION_A, VERSION_B } from "../engine/__tests__/fixtures";
import { DATASET } from "./dataset";
import { type GroundTruth, aggregate, formatReport, scorePair } from "./score";

// Targets from the product spec.
const MIN_RECALL = 0.95;
const MIN_PRECISION = 0.9;
const MIN_CITATION_ACCURACY = 0.98;
const MIN_WEIGHTED_RECALL = 0.95;

interface Pair {
  name: string;
  a: string;
  b: string;
  truth: GroundTruth[];
}

const PAIRS: Pair[] = [
  {
    name: "demo-proposal",
    a: VERSION_A,
    b: VERSION_B,
    truth: GROUND_TRUTH as GroundTruth[],
  },
  ...DATASET,
];

describe("evaluation", () => {
  it("meets the quality targets across every labelled pair", async () => {
    const scores = [];
    for (const pair of PAIRS) {
      const result = await compareDocuments(
        extractPlainText(pair.a, "A", `${pair.name}-a.txt`, "sa", pair.a.length),
        extractPlainText(pair.b, "B", `${pair.name}-b.txt`, "sb", pair.b.length),
        { labelA: "A", labelB: "B" },
      );
      expect(result.status, `${pair.name} failed to complete`).not.toBe("FAILED");
      scores.push(scorePair(pair.name, pair.truth, result));
    }

    const report = aggregate(scores);
    // Printed so a regression shows what moved, not just that something did.
    console.log(formatReport(report, scores));

    expect(report.recall, "change recall").toBeGreaterThanOrEqual(MIN_RECALL);
    expect(report.precisionVsLabels, "precision vs labels").toBeGreaterThanOrEqual(MIN_PRECISION);
    expect(report.citationAccuracy, "citation accuracy").toBeGreaterThanOrEqual(
      MIN_CITATION_ACCURACY,
    );
    expect(report.severityWeightedRecall, "severity-weighted recall").toBeGreaterThanOrEqual(
      MIN_WEIGHTED_RECALL,
    );
    // Every stated numeric expectation must be reproduced exactly.
    expect(report.valueAccuracy, "value accuracy").toBe(1);
  });

  it("covers the categories the product claims to detect", () => {
    const covered = new Set(PAIRS.flatMap((p) => p.truth.map((t) => t.category)));
    for (const required of ["PRICING", "PAYMENT_TERMS", "DURATION", "DATES", "OBLIGATIONS"]) {
      expect(covered, `no labelled case for ${required}`).toContain(required);
    }
  });
});
