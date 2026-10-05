import { describe, expect, it } from "vitest";
import { buildTimeline, summariseChain } from "../../chain";
import { compareDocuments } from "../compare";
import { extractPlainText } from "../extract";
import type { StoredComparison } from "../../store/db";

function version(price: string, delivery: string, support: string): string {
  return `Proposal

1. Pricing

The total project price is ${price} exclusive of taxes.

2. Delivery

The Supplier shall complete the project within ${delivery} of the commencement date.

3. Support

The Supplier shall provide support and maintenance for ${support} following launch.
`;
}

const V1 = version("₦5,000,000", "45 days", "12 months");
const V2 = version("₦6,000,000", "60 days", "12 months");
const V3 = version("₦6,500,000", "60 days", "6 months");

async function step(a: string, b: string, id: string): Promise<StoredComparison> {
  const result = await compareDocuments(
    extractPlainText(a, "A", "a.txt", "sa", a.length),
    extractPlainText(b, "B", "b.txt", "sb", b.length),
    {},
  );
  return {
    id,
    name: id,
    documentCategory: null,
    notes: null,
    documentIds: [],
    createdAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    status: result.status,
    stageMessage: null,
    result,
    review: {},
  };
}

describe("version chain", () => {
  it("tracks a value across every round", async () => {
    const steps = [await step(V1, V2, "cmp_1"), await step(V2, V3, "cmp_2")];
    const rows = buildTimeline(steps);

    const price = rows.find((r) => r.currency === "NGN");
    expect(price, JSON.stringify(rows.map((r) => r.key))).toBeDefined();
    expect(price!.points.map((p) => p?.value ?? null)).toEqual([5_000_000, 6_000_000, 6_500_000]);
    expect(price!.netAbsolute).toBe(1_500_000);
    expect(price!.netPercentage).toBe(30);
    expect(price!.steps).toBe(2);
  });

  it("leaves a gap where a value did not change that round", async () => {
    const steps = [await step(V1, V2, "cmp_1"), await step(V2, V3, "cmp_2")];
    const rows = buildTimeline(steps);

    // Support only moves in the second step, so the first version is never observed.
    const support = rows.find((r) => r.unit === "months");
    expect(support).toBeDefined();
    expect(support!.points[0]).toBeNull();
    expect(support!.points[1]?.value).toBe(12);
    expect(support!.points[2]?.value).toBe(6);
    expect(support!.netAbsolute).toBe(-6);
  });

  it("ranks the most-moved value first", async () => {
    const steps = [await step(V1, V2, "cmp_1"), await step(V2, V3, "cmp_2")];
    const rows = buildTimeline(steps);
    expect(rows[0]?.steps).toBeGreaterThanOrEqual(rows[rows.length - 1]?.steps ?? 0);
  });

  it("keeps each step's own totals", async () => {
    const steps = [await step(V1, V2, "cmp_1"), await step(V2, V3, "cmp_2")];
    const summary = summariseChain(steps, ["v1.txt", "v2.txt", "v3.txt"]);
    expect(summary.versions).toBe(3);
    expect(summary.perStep).toHaveLength(2);
    expect(summary.perStep[0]?.label).toBe("v1.txt → v2.txt");
    expect(summary.totalChanges).toBe(
      summary.perStep.reduce((s, x) => s + x.total, 0),
    );
    expect(summary.totalChanges).toBeGreaterThan(0);
  });

  it("produces an empty timeline when nothing numeric changed", async () => {
    const steps = [await step(V1, V1, "cmp_same")];
    expect(buildTimeline(steps)).toEqual([]);
  });
});
