/** Normalization used for matching only. Raw text is never destroyed. */

const QUOTES: Record<string, string> = {
  "‘": "'", "’": "'", "‚": "'", "‛": "'",
  "“": '"', "”": '"', "„": '"', "«": '"', "»": '"',
};
const DASHES: Record<string, string> = {
  "‐": "-", "‑": "-", "‒": "-", "–": "-", "—": "-", "―": "-",
};
const SPACES: Record<string, string> = {
  " ": " ", " ": " ", " ": " ", " ": " ", " ": " ", "​": "",
};
const TRANSLATE: Record<string, string> = { ...QUOTES, ...DASHES, ...SPACES };
const TRANSLATE_RE = new RegExp(`[${Object.keys(TRANSLATE).join("")}]`, "g");

const LEADING_MARKER = /^\s*(?:\d+(?:\.\d+)*|[a-z]|[ivxlc]+)[.)]\s+/i;
const HEADING_NUMBER = /^(\d+(?:\.\d+)*)[.)]?\s*/;

function fold(text: string): string {
  return text.normalize("NFKC").replace(TRANSLATE_RE, (c) => TRANSLATE[c] ?? c);
}

/** Lowercased, whitespace-collapsed form for similarity and diffing. */
export function normalizeText(text: string): string {
  return fold(text).replace(/\s+/g, " ").trim().toLowerCase();
}

/** "4.0 PAYMENT TERMS" -> "payment terms". */
export function normalizeHeading(text: string): string {
  return fold(text)
    .trim()
    .replace(HEADING_NUMBER, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function headingNumber(text: string): string | null {
  const m = HEADING_NUMBER.exec(fold(text).trim());
  if (!m?.[1]) return null;
  const n = m[1].replace(/\.$/, "");
  return n || null;
}

/** Numbering churn alone must not look like a text change. */
export function stripListMarker(text: string): string {
  return text.replace(LEADING_MARKER, "").trim();
}

export function tokens(normalized: string): string[] {
  return normalized.match(/[\p{L}\p{N}$£€₦%./-]+/gu) ?? [];
}

export function sentenceEnded(text: string): boolean {
  return /[.:;!?]\s*$/.test(text.trim());
}

const LIST_MARK = /^([-•·*]|\(?[a-z]\)|\(?[ivx]+\))\s+/i;
const NUMBERED_HEADING = /^(\d+(?:\.\d+)*)\.?\s+(.{0,90})$/;

/** Shared heuristic so PDF, DOCX and text extraction classify blocks identically. */
export function guessBlockType(text: string): "heading" | "list_item" | "paragraph" {
  const s = text.trim();
  if (!s) return "paragraph";
  if (LIST_MARK.test(s)) return "list_item";

  const numbered = NUMBERED_HEADING.exec(s);
  if (numbered && !sentenceEnded(s) && (numbered[2] ?? "").split(/\s+/).length <= 12) {
    return "heading";
  }

  const words = s.split(/\s+/);
  if (words.length > 0 && words.length <= 10 && s === s.toUpperCase() && /\p{L}/u.test(s)) {
    return "heading";
  }
  if (words.length > 0 && words.length <= 9 && !sentenceEnded(s) && /^\p{Lu}/u.test(s)) {
    const capitalised = words.filter((w) => /^\p{Lu}/u.test(w)).length;
    if (capitalised / words.length >= 0.6) return "heading";
  }
  return "paragraph";
}

/**
 * Drop running headers/footers: identical short lines appearing on most pages.
 * An exact-text heuristic beats layout analysis here because repeated runners are
 * byte-identical far more often than not.
 */
export function stripRepeatedRunners<T extends { text: string; page: number }>(
  blocks: T[],
): T[] {
  const pages = new Set(blocks.map((b) => b.page));
  if (pages.size < 3) return blocks;

  const counts = new Map<string, number>();
  for (const b of blocks) {
    if (b.text.length > 90) continue;
    const key = normalizeText(b.text);
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const threshold = Math.max(3, Math.floor(pages.size * 0.6));
  const runners = new Set<string>();
  for (const [key, n] of counts) if (n >= threshold) runners.add(key);
  if (runners.size === 0) return blocks;

  return blocks.filter((b) => !(b.text.length <= 90 && runners.has(normalizeText(b.text))));
}
