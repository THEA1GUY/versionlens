/**
 * Optimal assignment (Jonker-Volgenant / Hungarian), replacing the Python engine's
 * greedy best-first pairing.
 *
 * Greedy takes the single highest-scoring pair first and never reconsiders, so one
 * 0.81 match can block two 0.79 matches that together score higher. This maximises the
 * total score across the whole assignment instead. It matters most on documents with
 * repeated near-identical headings — "Schedule 1 / 2 / 3", "Annex A / B / C" — which is
 * exactly where mis-pairing is expensive.
 *
 * O(n^2 * m) on an n x m matrix. Section counts are in the dozens, so this is trivial.
 */

const INF = Number.POSITIVE_INFINITY;

export interface Assignment {
  /** Index into columns for each row, or -1 when the row is unassigned. */
  rowToCol: Int32Array;
  /** Index into rows for each column, or -1 when the column is unassigned. */
  colToRow: Int32Array;
}

/**
 * Minimises total cost. `cost[r][c]` may be Infinity to forbid a pairing.
 * Rectangular input is handled: the smaller side is fully assigned.
 */
export function solveAssignment(cost: number[][]): Assignment {
  const nRows = cost.length;
  const nCols = nRows > 0 ? (cost[0] as number[]).length : 0;
  const rowToCol = new Int32Array(nRows).fill(-1);
  const colToRow = new Int32Array(nCols).fill(-1);
  if (nRows === 0 || nCols === 0) return { rowToCol, colToRow };

  // Transposing keeps the outer loop on the smaller dimension.
  if (nRows > nCols) {
    const transposed: number[][] = Array.from({ length: nCols }, (_, c) =>
      Array.from({ length: nRows }, (_, r) => (cost[r] as number[])[c] as number),
    );
    const inner = solveAssignment(transposed);
    for (let c = 0; c < nCols; c++) {
      const r = inner.rowToCol[c] as number;
      if (r >= 0) {
        colToRow[c] = r;
        rowToCol[r] = c;
      }
    }
    return { rowToCol, colToRow };
  }

  // Shortest augmenting path with potentials (u, v). 1-indexed working arrays.
  const u = new Float64Array(nRows + 1);
  const v = new Float64Array(nCols + 1);
  const way = new Int32Array(nCols + 1).fill(0);
  const p = new Int32Array(nCols + 1).fill(0); // p[col] = row assigned to col

  for (let i = 1; i <= nRows; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Float64Array(nCols + 1).fill(INF);
    const used = new Uint8Array(nCols + 1);

    do {
      used[j0] = 1;
      const i0 = p[j0] as number;
      let delta = INF;
      let j1 = 0;

      for (let j = 1; j <= nCols; j++) {
        if (used[j]) continue;
        const raw = ((cost[i0 - 1] as number[])[j - 1] as number);
        const cur = raw === INF ? INF : raw - (u[i0] as number) - (v[j] as number);
        if (cur < (minv[j] as number)) {
          minv[j] = cur;
          way[j] = j0;
        }
        if ((minv[j] as number) < delta) {
          delta = minv[j] as number;
          j1 = j;
        }
      }

      if (delta === INF) {
        // No reachable column left: this row stays unassigned.
        break;
      }

      for (let j = 0; j <= nCols; j++) {
        if (used[j]) {
          u[p[j] as number] = (u[p[j] as number] as number) + delta;
          v[j] = (v[j] as number) - delta;
        } else {
          minv[j] = (minv[j] as number) - delta;
        }
      }
      j0 = j1;
    } while ((p[j0] as number) !== 0);

    if ((p[j0] as number) === 0 && j0 !== 0) {
      // Augment along the path.
      let cur = j0;
      while (cur !== 0) {
        const prev = way[cur] as number;
        p[cur] = p[prev] as number;
        cur = prev;
      }
    }
  }

  for (let j = 1; j <= nCols; j++) {
    const row = p[j] as number;
    if (row > 0) {
      const r = row - 1;
      const c = j - 1;
      // Forbidden pairings can survive augmentation; drop them.
      if (((cost[r] as number[])[c] as number) !== INF) {
        rowToCol[r] = c;
        colToRow[c] = r;
      }
    }
  }
  return { rowToCol, colToRow };
}

/**
 * Convenience wrapper for scores (higher is better).
 *
 * The objective is the total *margin above the threshold*, not the total score. That
 * distinction matters: leaving a section unmatched is a valid, informative outcome here
 * — it means added or removed — while a wrong pairing cascades into bogus diffs. Summing
 * raw scores rewards quantity of matches, so the solver would take two mediocre pairs
 * (0.53 + 0.50) over one excellent one (0.95) and report a removed Exclusivity clause as
 * a renamed Termination clause. Subtracting the threshold makes a confident pair worth
 * more than several marginal ones, while still preferring two good pairs over one
 * slightly better pair that strands them.
 */
export function maximiseScores(
  score: number[][],
  threshold: number,
): Array<{ row: number; col: number; score: number }> {
  if (score.length === 0 || (score[0] as number[] | undefined)?.length === undefined) {
    return [];
  }
  const nRows = score.length;
  const nCols = (score[0] as number[]).length;

  // Hungarian assigns every row it can. On a square matrix that forces a perfect
  // matching, so a row with no good partner gets pushed onto a bad one. Padding with one
  // zero-cost dummy column per row makes "leave this unmatched" an option the solver can
  // choose, which is what lets a confident pair win over two marginal ones.
  const cost = score.map((row, r) => {
    const real = row.map((s) => (s < threshold ? INF : -(s - threshold)));
    const dummies = new Array<number>(nRows).fill(INF);
    dummies[r] = 0;
    return [...real, ...dummies];
  });

  const { rowToCol } = solveAssignment(cost);
  const out: Array<{ row: number; col: number; score: number }> = [];
  for (let r = 0; r < nRows; r++) {
    const c = rowToCol[r] as number;
    if (c < 0 || c >= nCols) continue; // unassigned, or parked on its dummy column
    const s = (score[r] as number[])[c] as number;
    if (s >= threshold) out.push({ row: r, col: c, score: s });
  }
  return out;
}
