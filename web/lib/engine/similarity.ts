/**
 * String similarity, ported from the metrics the Python engine used (rapidfuzz).
 *
 * All ratios are LCS-based: `2 * lcs / (len(a) + len(b))`, which is the same formula
 * rapidfuzz's `ratio` uses, so thresholds tuned against the Python engine carry over.
 */

/** Guards the O(n*m) inner loop against pathological inputs. */
const MAX_COMPARE_CHARS = 3000;

function clip(s: string): string {
  return s.length > MAX_COMPARE_CHARS ? s.slice(0, MAX_COMPARE_CHARS) : s;
}

/** Longest common subsequence length, rolling-row so memory is O(min(n, m)). */
export function lcsLength(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return a.length;
  // Keep the shorter string on the inner axis.
  if (a.length < b.length) [a, b] = [b, a];

  const m = b.length;
  let prev = new Uint32Array(m + 1);
  let cur = new Uint32Array(m + 1);

  for (let i = 1; i <= a.length; i++) {
    const ai = a.charCodeAt(i - 1);
    cur[0] = 0;
    for (let j = 1; j <= m; j++) {
      cur[j] =
        ai === b.charCodeAt(j - 1)
          ? (prev[j - 1] as number) + 1
          : Math.max(prev[j] as number, cur[j - 1] as number);
    }
    const swap = prev;
    prev = cur;
    cur = swap;
  }
  return prev[m] as number;
}

/** 0..1. Identical strings score 1. */
export function ratio(a: string, b: string): number {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  if (a === b) return 1;
  const x = clip(a);
  const y = clip(b);
  const total = x.length + y.length;
  return total === 0 ? 0 : (2 * lcsLength(x, y)) / total;
}

function tokenise(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/** Word order is ignored — the same clause with reordered phrases still matches. */
export function tokenSortRatio(a: string, b: string): number {
  const x = tokenise(a).sort().join(" ");
  const y = tokenise(b).sort().join(" ");
  return ratio(x, y);
}

/**
 * Compares the shared tokens against each side's remainder, then takes the best of
 * the three. Robust when one side simply has extra clauses appended.
 */
export function tokenSetRatio(a: string, b: string): number {
  const setA = new Set(tokenise(a));
  const setB = new Set(tokenise(b));
  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;

  const shared: string[] = [];
  const onlyA: string[] = [];
  const onlyB: string[] = [];
  for (const t of setA) (setB.has(t) ? shared : onlyA).push(t);
  for (const t of setB) if (!setA.has(t)) onlyB.push(t);

  shared.sort();
  onlyA.sort();
  onlyB.sort();

  const base = shared.join(" ");
  const left = [base, onlyA.join(" ")].filter(Boolean).join(" ");
  const right = [base, onlyB.join(" ")].filter(Boolean).join(" ");

  return Math.max(ratio(base, left), ratio(base, right), ratio(left, right));
}

/** Best alignment of the shorter string against any window of the longer one. */
export function partialRatio(a: string, b: string): number {
  if (!a || !b) return 0;
  const [shortStr, longStr] = a.length <= b.length ? [a, b] : [b, a];
  if (shortStr.length === longStr.length) return ratio(shortStr, longStr);
  const window = shortStr.length;
  let best = 0;
  // Step through in half-window strides; exhaustive sliding is O(n*m*window).
  const stride = Math.max(1, Math.floor(window / 2));
  for (let start = 0; start + window <= longStr.length; start += stride) {
    best = Math.max(best, ratio(shortStr, longStr.slice(start, start + window)));
    if (best >= 0.999) return best;
  }
  best = Math.max(best, ratio(shortStr, longStr.slice(-window)));
  return best;
}
