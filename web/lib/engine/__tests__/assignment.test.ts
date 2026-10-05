import { describe, expect, it } from "vitest";
import { maximiseScores, solveAssignment } from "../assignment";

const INF = Number.POSITIVE_INFINITY;

function totalCost(cost: number[][], rowToCol: Int32Array): number {
  let sum = 0;
  for (let r = 0; r < rowToCol.length; r++) {
    const c = rowToCol[r] as number;
    if (c >= 0) sum += (cost[r] as number[])[c] as number;
  }
  return sum;
}

/**
 * Exhaustive optimum, for checking the solver on small matrices.
 *
 * Only min(rows, cols) pairs can exist, so a row may go unassigned when rows outnumber
 * columns — requiring every row to be assigned makes this unsatisfiable and was the
 * bug in the first version of this helper.
 */
function bruteForceMin(cost: number[][]): number {
  const n = cost.length;
  const m = (cost[0] as number[]).length;
  const target = Math.min(n, m);
  let best = INF;
  const used = new Array<boolean>(m).fill(false);
  const walk = (row: number, placed: number, acc: number): void => {
    if (acc >= best) return;
    if (placed === target) {
      best = Math.min(best, acc);
      return;
    }
    // Not enough rows left to reach the target.
    if (n - row < target - placed) return;
    for (let c = 0; c < m; c++) {
      if (used[c]) continue;
      const v = (cost[row] as number[])[c] as number;
      if (v === INF) continue;
      used[c] = true;
      walk(row + 1, placed + 1, acc + v);
      used[c] = false;
    }
    walk(row + 1, placed, acc); // skip this row
  };
  walk(0, 0, 0);
  return best;
}

describe("solveAssignment", () => {
  it("solves the classic 3x3 case", () => {
    const cost = [
      [4, 1, 3],
      [2, 0, 5],
      [3, 2, 2],
    ];
    const { rowToCol } = solveAssignment(cost);
    expect(totalCost(cost, rowToCol)).toBe(5);
  });

  it("assigns every row of a square matrix exactly once", () => {
    const cost = [
      [10, 19, 8, 15],
      [10, 18, 7, 17],
      [13, 16, 9, 14],
      [12, 19, 8, 18],
    ];
    const { rowToCol, colToRow } = solveAssignment(cost);
    const cols = new Set<number>();
    for (let r = 0; r < 4; r++) {
      const c = rowToCol[r] as number;
      expect(c).toBeGreaterThanOrEqual(0);
      expect(cols.has(c)).toBe(false);
      cols.add(c);
      expect(colToRow[c]).toBe(r);
    }
    expect(totalCost(cost, rowToCol)).toBe(bruteForceMin(cost));
  });

  it("handles more rows than columns", () => {
    const cost = [
      [5, 9],
      [1, 7],
      [3, 2],
    ];
    const { rowToCol } = solveAssignment(cost);
    const assigned = Array.from(rowToCol).filter((c) => c >= 0);
    expect(assigned.length).toBe(2);
    expect(new Set(assigned).size).toBe(2);
    expect(totalCost(cost, rowToCol)).toBe(3); // row1->col0 (1) + row2->col1 (2)
  });

  it("handles more columns than rows", () => {
    const cost = [
      [5, 1, 9],
      [8, 7, 2],
    ];
    const { rowToCol, colToRow } = solveAssignment(cost);
    expect(rowToCol[0]).toBe(1);
    expect(rowToCol[1]).toBe(2);
    expect(colToRow[0]).toBe(-1);
  });

  it("never selects a forbidden pairing", () => {
    const cost = [
      [INF, 2],
      [3, INF],
    ];
    const { rowToCol } = solveAssignment(cost);
    expect(rowToCol[0]).toBe(1);
    expect(rowToCol[1]).toBe(0);
  });

  it("leaves a row unassigned when every pairing is forbidden", () => {
    const cost = [
      [INF, INF],
      [1, 4],
    ];
    const { rowToCol } = solveAssignment(cost);
    expect(rowToCol[0]).toBe(-1);
    expect(rowToCol[1]).toBe(0);
  });

  it("matches brute force on random matrices", () => {
    let seed = 12345;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let trial = 0; trial < 40; trial++) {
      const n = 2 + Math.floor(rand() * 4);
      const m = 2 + Math.floor(rand() * 4);
      const cost = Array.from({ length: n }, () =>
        Array.from({ length: m }, () => Math.floor(rand() * 20)),
      );
      const { rowToCol } = solveAssignment(cost);
      expect(totalCost(cost, rowToCol)).toBe(bruteForceMin(cost));
    }
  });
});

describe("maximiseScores", () => {
  it("beats greedy where greedy is locally tempted", () => {
    // Greedy takes A0-B0 (0.81) first, which strands A1 (only B0 is viable for it).
    // Optimal pairs A0-B1 and A1-B0 for a higher total.
    const score = [
      [0.81, 0.8],
      [0.79, 0.1],
    ];
    const pairs = maximiseScores(score, 0.5);
    const map = new Map(pairs.map((p) => [p.row, p.col]));
    expect(map.get(0)).toBe(1);
    expect(map.get(1)).toBe(0);
    expect(pairs.reduce((s, p) => s + p.score, 0)).toBeCloseTo(1.59, 5);
  });

  it("refuses pairs below the threshold even when that leaves rows unmatched", () => {
    const score = [
      [0.9, 0.2],
      [0.1, 0.15],
    ];
    const pairs = maximiseScores(score, 0.5);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({ row: 0, col: 0 });
  });

  it("prefers one confident pair over two marginal ones", () => {
    // Regression, from real section data: maximising the raw total paired
    // "9 Exclusivity"<->"9 Termination" (0.53) and "10 Termination"<->"11 Data
    // Protection" (0.50) because 1.03 > 0.82, reporting a removed clause as a renamed
    // one. Scoring the margin above the threshold, and letting a row stay unmatched,
    // makes the single good pair win.
    const score = [
      [0.53, 0.12], // Exclusivity vs {Termination, Data Protection}
      [0.82, 0.504], // Termination vs {Termination, Data Protection}
    ];
    const pairs = maximiseScores(score, 0.42);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({ row: 1, col: 0 });
  });

  it("leaves a row unmatched rather than forcing a perfect matching", () => {
    const score = [
      [0.95, 0.43],
      [0.44, 0.43],
    ];
    const pairs = maximiseScores(score, 0.42);
    expect(pairs.some((p) => p.row === 0 && p.col === 0)).toBe(true);
    // Row 1's options are barely above the bar; taking one must not cost row 0 its match.
    expect(pairs.find((p) => p.row === 0)?.score).toBe(0.95);
  });

  it("returns nothing for an empty matrix", () => {
    expect(maximiseScores([], 0.4)).toEqual([]);
  });
});
