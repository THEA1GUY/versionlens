/**
 * Word-level deterministic diff over already-aligned blocks.
 *
 * Running this only after alignment is what keeps highlighting tight: the UI gets
 * "$20,000 -> $28,000" rather than a whole sentence painted as changed.
 */

import type { DiffOp } from "./changes";

const TOKEN_RE = /\s+|[^\s]+/g;
const WORD_CHAR = /[\p{L}\p{N}$£€₦%]/u;

export function splitTokens(text: string): string[] {
  return text.match(TOKEN_RE) ?? [];
}

type Opcode = ["equal" | "insert" | "delete" | "replace", number, number, number, number];

/**
 * Opcodes over two token sequences, via LCS backtracking.
 *
 * Python's difflib was the reference; this uses a plain LCS table, which gives the same
 * grouping for the block-sized inputs here (a few hundred tokens) without difflib's
 * junk heuristics.
 */
function opcodes(a: string[], b: string[]): Opcode[] {
  const n = a.length;
  const m = b.length;
  if (n === 0 && m === 0) return [];
  if (n === 0) return [["insert", 0, 0, 0, m]];
  if (m === 0) return [["delete", 0, n, 0, 0]];

  // table[i][j] = LCS length of a[i:], b[j:]
  const table: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    const row = table[i] as Uint32Array;
    const next = table[i + 1] as Uint32Array;
    for (let j = m - 1; j >= 0; j--) {
      row[j] = a[i] === b[j]
        ? (next[j + 1] as number) + 1
        : Math.max(next[j] as number, row[j + 1] as number);
    }
  }

  const raw: Array<"equal" | "insert" | "delete"> = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      raw.push("equal");
      i++;
      j++;
    } else if ((table[i + 1] as Uint32Array)[j]! >= (table[i] as Uint32Array)[j + 1]!) {
      raw.push("delete");
      i++;
    } else {
      raw.push("insert");
      j++;
    }
  }
  while (i < n) { raw.push("delete"); i++; }
  while (j < m) { raw.push("insert"); j++; }

  // Collapse the per-token tags into spans.
  const out: Opcode[] = [];
  let ai = 0;
  let bi = 0;
  let k = 0;
  while (k < raw.length) {
    const tag = raw[k] as "equal" | "insert" | "delete";
    let end = k;
    while (end < raw.length && raw[end] === tag) end++;
    const count = end - k;
    if (tag === "equal") {
      out.push(["equal", ai, ai + count, bi, bi + count]);
      ai += count;
      bi += count;
    } else if (tag === "delete") {
      out.push(["delete", ai, ai + count, bi, bi]);
      ai += count;
    } else {
      out.push(["insert", ai, ai, bi, bi + count]);
      bi += count;
    }
    k = end;
  }
  return out;
}

export function wordDiff(textA: string, textB: string): DiffOp[] {
  const a = splitTokens(textA);
  const b = splitTokens(textB);
  const keyA = a.map((t) => t.toLowerCase());
  const keyB = b.map((t) => t.toLowerCase());

  const ops: DiffOp[] = [];
  for (const [tag, i1, i2, j1, j2] of opcodes(keyA, keyB)) {
    const segA = a.slice(i1, i2).join("");
    const segB = b.slice(j1, j2).join("");
    if (tag === "equal") ops.push({ op: "equal", a: segA, b: segB });
    else if (tag === "insert") ops.push({ op: "insert", a: "", b: segB });
    else if (tag === "delete") ops.push({ op: "delete", a: segA, b: "" });
    else ops.push({ op: "replace", a: segA, b: segB });
  }
  return mergeAdjacent(ops);
}

/** Collapse delete+insert into replace, and swallow whitespace-only equals between them. */
function mergeAdjacent(ops: DiffOp[]): DiffOp[] {
  const merged: DiffOp[] = [];
  for (const op of ops) {
    const prev = merged[merged.length - 1];
    if (!prev) {
      merged.push({ ...op });
      continue;
    }
    if (prev.op === "delete" && op.op === "insert") {
      prev.op = "replace";
      prev.b = op.b;
      continue;
    }
    if (prev.op === op.op && prev.op !== "equal") {
      prev.a += op.a;
      prev.b += op.b;
      continue;
    }
    const before = merged[merged.length - 2];
    if (
      prev.op === "equal" &&
      prev.a.trim() === "" &&
      before &&
      before.op === op.op &&
      op.op !== "equal"
    ) {
      before.a += prev.a + op.a;
      before.b += prev.b + op.b;
      merged.pop();
      continue;
    }
    merged.push({ ...op });
  }
  return merged;
}

/** Just the changed parts, for a compact "X -> Y" summary. */
export function changedFragments(ops: DiffOp[]): { before: string; after: string } {
  const before = ops
    .filter((o) => (o.op === "delete" || o.op === "replace") && o.a.trim())
    .map((o) => o.a.trim())
    .join(" ");
  const after = ops
    .filter((o) => (o.op === "insert" || o.op === "replace") && o.b.trim())
    .map((o) => o.b.trim())
    .join(" ");
  return { before: before.trim(), after: after.trim() };
}

function cosmeticKey(text: string): string {
  let out = "";
  for (const ch of text) if (WORD_CHAR.test(ch)) out += ch.toLowerCase();
  return out;
}

/** True when the only differences are whitespace, case, punctuation or list markers. */
export function isCosmetic(textA: string, textB: string): boolean {
  return cosmeticKey(textA) === cosmeticKey(textB);
}
