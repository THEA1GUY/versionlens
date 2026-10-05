/**
 * Section and paragraph alignment.
 *
 * Alignment runs before diffing so that a renumbered or renamed section is recognised
 * as the same section rather than reported as one big removal plus one big addition.
 *
 * Both levels use optimal assignment rather than greedy best-first pairing, so one
 * locally-tempting match can never strand two better ones.
 */

import { maximiseScores } from "./assignment";
import type { Entity } from "./entities";
import type { Block, DocumentIndex, Section } from "./model";
import { normalizeText, stripListMarker, tokens } from "./normalize";
import { ratio, tokenSetRatio, tokenSortRatio } from "./similarity";

export const W_HEADING = 0.3;
export const W_CONTENT = 0.3;
export const W_ENTITY = 0.15;
export const W_POSITION = 0.15;
export const W_NUMBERING = 0.1;

export const SECTION_MATCH_THRESHOLD = 0.42;
export const BLOCK_MATCH_THRESHOLD = 0.5;
export const MOVE_MATCH_THRESHOLD = 0.85;

/**
 * Block similarity blends character similarity with rare-word overlap.
 *
 * Lexical similarity alone cannot tell a genuine rewrite from two different clauses
 * sharing a boilerplate opening — measured on real clauses, both score ~0.54. Rare-word
 * overlap separates them cleanly, because the rewrite keeps its distinctive nouns.
 */
export const W_LEXICAL = 0.45;
export const W_CONTENT_IDF = 0.55;

const STOPWORDS = new Set(
  `a an and any are as at be been by for from in into is it its of on or per shall
   that the this to upon which will with within without all such other than then there
   these those have has had not no but if when where whereas hereby herein thereof
   may must should can each either both same more most less least only also`.split(/\s+/),
);
const SUFFIXES = ["ies", "ing", "ed", "es", "s"];

/**
 * Contract headings get renamed constantly; these families keep the heading signal
 * alive through a rename instead of pushing all the weight onto body text.
 */
export const HEADING_FAMILIES: string[][] = [
  ["scope", "scope of work", "scope of services", "services", "services to be provided",
    "project scope", "deliverables", "work", "statement of work"],
  ["pricing", "price", "prices", "fees", "commercial terms", "charges", "costs",
    "consideration", "compensation", "remuneration"],
  ["payment", "payment terms", "payments", "invoicing", "invoices", "billing"],
  ["timeline", "delivery", "schedule", "timetable", "milestones", "term", "duration",
    "project timeline", "delivery schedule"],
  ["termination", "cancellation", "termination rights", "exit"],
  ["liability", "limitation of liability", "indemnity", "indemnification", "warranties",
    "warranty", "damages"],
  ["confidentiality", "non disclosure", "nda", "confidential information"],
  ["renewal", "extension", "auto renewal", "automatic renewal"],
  ["governing law", "jurisdiction", "dispute resolution", "disputes", "arbitration",
    "applicable law"],
  ["responsibilities", "obligations", "duties", "client responsibilities",
    "supplier responsibilities", "roles and responsibilities"],
  ["support", "maintenance", "support and maintenance", "service levels", "sla"],
  ["intellectual property", "ip", "ownership", "data ownership", "rights"],
  ["data protection", "privacy", "gdpr", "personal data"],
  ["insurance", "cover", "coverage"],
  ["exclusivity", "non compete", "exclusive rights"],
  ["training", "onboarding", "knowledge transfer"],
];

export interface SectionAlignment {
  sectionA: Section | null;
  sectionB: Section | null;
  confidence: number;
  signals: Record<string, number>;
  status: "MATCHED" | "ADDED" | "REMOVED";
}

export interface BlockAlignment {
  blockA: Block | null;
  blockB: Block | null;
  similarity: number;
  status: "UNCHANGED" | "MODIFIED" | "ADDED" | "REMOVED" | "MOVED";
  sectionAlignment: SectionAlignment | null;
}

/* ------------------------------------------------------------- term weights */

const TERM_RE = /[a-z][a-z-]+/g;

function stem(word: string): string {
  for (const suffix of SUFFIXES) {
    if (word.length > suffix.length + 2 && word.endsWith(suffix)) {
      return word.slice(0, -suffix.length);
    }
  }
  return word;
}

/**
 * Stemmed, stopword-free terms. Numbers are excluded deliberately — a changed amount
 * must not make two clauses look unrelated.
 */
export function contentTerms(normalized: string): string[] {
  const out: string[] = [];
  for (const raw of normalized.match(TERM_RE) ?? []) {
    const word = raw.replace(/^-+|-+$/g, "");
    if (word.length < 3 || STOPWORDS.has(word)) continue;
    out.push(stem(word));
  }
  return out;
}

/**
 * Document-level inverse document frequency over block text.
 *
 * "supplier", "client" and "provide" appear in most blocks of a contract and carry no
 * pairing signal; "insurance" or "exclusivity" appear once or twice and carry most of
 * it. Weighting the overlap by rarity is what makes a heavy rewrite pair correctly
 * while two unrelated clauses sharing an opening phrase do not.
 */
export class TermWeights {
  private readonly df = new Map<string, number>();
  private readonly total: number;

  constructor(blocks: Array<{ normalized: string }>) {
    let docs = 0;
    for (const block of blocks) {
      const terms = contentTerms(block.normalized);
      if (terms.length === 0) continue;
      docs += 1;
      for (const t of new Set(terms)) this.df.set(t, (this.df.get(t) ?? 0) + 1);
    }
    this.total = Math.max(1, docs);
  }

  weight(term: string): number {
    const df = this.df.get(term) ?? 0;
    return Math.log((this.total + 1) / (df + 1)) + 0.1;
  }

  overlap(termsA: string[], termsB: string[]): number {
    const setA = new Set(termsA);
    const setB = new Set(termsB);
    if (setA.size === 0 || setB.size === 0) return 0;
    let shared = 0;
    let massA = 0;
    let massB = 0;
    for (const t of setA) {
      const w = this.weight(t);
      massA += w;
      if (setB.has(t)) shared += w;
    }
    for (const t of setB) massB += this.weight(t);
    const floor = Math.min(massA, massB);
    return floor > 0 ? shared / floor : 0;
  }
}

/* ------------------------------------------------------------ section level */

function inFamily(heading: string, family: string[]): boolean {
  if (family.includes(heading)) return true;
  return family.some((term) => term.length > 4 && heading.includes(term));
}

function sameFamily(a: string, b: string): boolean {
  return HEADING_FAMILIES.some((f) => inFamily(a, f) && inFamily(b, f));
}

export function headingSimilarity(a: string, b: string): number {
  if (!a && !b) return 0.5;
  if (!a || !b) return 0;
  if (a === b) return 1;
  return Math.max(tokenSetRatio(a, b), sameFamily(a, b) ? 0.9 : 0);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let shared = 0;
  for (const x of a) if (b.has(x)) shared += 1;
  const union = a.size + b.size - shared;
  return union > 0 ? shared / union : 0;
}

function positionSimilarity(a: Section, b: Section, nA: number, nB: number): number {
  const pa = a.orderIndex / Math.max(1, nA);
  const pb = b.orderIndex / Math.max(1, nB);
  return Math.max(0, 1 - Math.abs(pa - pb) * 2);
}

function numberingSimilarity(a: string | null, b: string | null): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const pa = a.split(".");
  const pb = b.split(".");
  if (pa.length !== pb.length) return 0.1;
  if (pa.length > 1 && pa.slice(1).join(".") === pb.slice(1).join(".")) return 0.7;
  return 0.2;
}

function sectionText(index: DocumentIndex, section: Section): string {
  return index.blocksOf(section.id).map((b) => b.normalized).join(" ");
}

function sectionEntityKeys(
  index: DocumentIndex,
  section: Section,
  entities: Map<string, Entity[]>,
): Set<string> {
  const keys = new Set<string>();
  for (const block of index.blocksOf(section.id)) {
    for (const e of entities.get(block.id) ?? []) keys.add(`${e.type}:${String(e.value)}`);
  }
  return keys;
}

export function alignSections(
  indexA: DocumentIndex,
  indexB: DocumentIndex,
  entitiesA: Map<string, Entity[]>,
  entitiesB: Map<string, Entity[]>,
): SectionAlignment[] {
  const secsA = indexA.leafSections();
  const secsB = indexB.leafSections();
  if (secsA.length === 0 || secsB.length === 0) {
    return [
      ...secsA.map((s): SectionAlignment => ({
        sectionA: s, sectionB: null, confidence: 1, signals: {}, status: "REMOVED",
      })),
      ...secsB.map((s): SectionAlignment => ({
        sectionA: null, sectionB: s, confidence: 1, signals: {}, status: "ADDED",
      })),
    ];
  }

  const textsA = secsA.map((s) => sectionText(indexA, s));
  const textsB = secsB.map((s) => sectionText(indexB, s));
  const keysA = secsA.map((s) => sectionEntityKeys(indexA, s, entitiesA));
  const keysB = secsB.map((s) => sectionEntityKeys(indexB, s, entitiesB));

  const signalGrid: Array<Array<Record<string, number>>> = [];
  const scores: number[][] = secsA.map((sa, i) => {
    const row: number[] = [];
    const signalRow: Array<Record<string, number>> = [];
    for (let j = 0; j < secsB.length; j++) {
      const sb = secsB[j] as Section;
      const signals = {
        heading: headingSimilarity(sa.normalizedHeading, sb.normalizedHeading),
        content: tokenSetRatio(textsA[i] as string, textsB[j] as string),
        entity: jaccard(keysA[i] as Set<string>, keysB[j] as Set<string>),
        position: positionSimilarity(sa, sb, secsA.length, secsB.length),
        numbering: numberingSimilarity(sa.sectionNumber, sb.sectionNumber),
      };
      row.push(
        signals.heading * W_HEADING +
          signals.content * W_CONTENT +
          signals.entity * W_ENTITY +
          signals.position * W_POSITION +
          signals.numbering * W_NUMBERING,
      );
      signalRow.push(signals);
    }
    signalGrid.push(signalRow);
    return row;
  });

  const pairs = maximiseScores(scores, SECTION_MATCH_THRESHOLD);
  const usedA = new Set<number>();
  const usedB = new Set<number>();
  const out: SectionAlignment[] = [];

  for (const { row, col, score } of pairs) {
    usedA.add(row);
    usedB.add(col);
    out.push({
      sectionA: secsA[row] as Section,
      sectionB: secsB[col] as Section,
      confidence: Math.round(score * 10000) / 10000,
      signals: (signalGrid[row] as Array<Record<string, number>>)[col] as Record<string, number>,
      status: "MATCHED",
    });
  }
  secsA.forEach((s, i) => {
    if (!usedA.has(i)) {
      out.push({ sectionA: s, sectionB: null, confidence: 1, signals: {}, status: "REMOVED" });
    }
  });
  secsB.forEach((s, j) => {
    if (!usedB.has(j)) {
      out.push({ sectionA: null, sectionB: s, confidence: 1, signals: {}, status: "ADDED" });
    }
  });

  out.sort((x, y) => {
    const ox = x.sectionA?.orderIndex ?? x.sectionB?.orderIndex ?? 0;
    const oy = y.sectionA?.orderIndex ?? y.sectionB?.orderIndex ?? 0;
    return ox - oy || (x.sectionA ? 0 : 1) - (y.sectionA ? 0 : 1);
  });
  return out;
}

/* -------------------------------------------------------------- block level */

function matchKey(block: Block): string {
  return stripListMarker(block.normalized);
}

export function blockSimilarity(a: Block, b: Block, weights: TermWeights): number {
  const keyA = matchKey(a);
  const keyB = matchKey(b);
  let lexical = Math.max(ratio(keyA, keyB), tokenSortRatio(keyA, keyB) * 0.95);

  // A long shared opening inflates character similarity for clauses that are actually
  // unrelated ("The Supplier shall provide ..."). The distinctive tail decides.
  const ta = tokens(keyA);
  const tb = tokens(keyB);
  let prefix = 0;
  while (prefix < Math.min(ta.length, tb.length) && ta[prefix] === tb[prefix]) prefix += 1;
  if (prefix >= 3 && prefix < Math.min(ta.length, tb.length)) {
    const tail = ratio(ta.slice(prefix).join(" "), tb.slice(prefix).join(" "));
    lexical = Math.min(lexical, tail);
  }

  const content = weights.overlap(contentTerms(a.normalized), contentTerms(b.normalized));
  return Math.min(1, W_LEXICAL * lexical + W_CONTENT_IDF * content);
}

/** Table rows match on their first cell — that is the row's identity. */
function rowSimilarity(a: Block, b: Block, weights: TermWeights): number {
  if (a.blockType !== b.blockType) return 0;
  if (a.rowKey && b.rowKey) {
    const keySim = ratio(a.rowKey, b.rowKey);
    return keySim >= 0.85 ? Math.max(0.9, keySim) : keySim * 0.5;
  }
  return blockSimilarity(a, b, weights);
}

/**
 * Headings are excluded: a renamed section is reported once by the section layer, not
 * as a removed heading plus an added heading.
 */
function comparable(blocks: Block[]): Block[] {
  return blocks.filter(
    (b) => !["header", "footer", "table", "heading"].includes(b.blockType) && b.normalized,
  );
}

function pairWithinSection(
  blocksA: Block[],
  blocksB: Block[],
  alignment: SectionAlignment,
  weights: TermWeights,
): { matchedA: Set<string>; matchedB: Set<string>; pairs: BlockAlignment[] } {
  const pairs: BlockAlignment[] = [];
  const matchedA = new Set<string>();
  const matchedB = new Set<string>();

  // Exact-text anchors first: cheap and unambiguous.
  const byText = new Map<string, Block[]>();
  for (const b of blocksB) {
    const key = matchKey(b);
    const list = byText.get(key);
    if (list) list.push(b);
    else byText.set(key, [b]);
  }
  for (const a of blocksA) {
    const candidates = byText.get(matchKey(a));
    const b = candidates?.shift();
    if (!b) continue;
    matchedA.add(a.id);
    matchedB.add(b.id);
    pairs.push({ blockA: a, blockB: b, similarity: 1, status: "UNCHANGED", sectionAlignment: alignment });
  }

  const restA = blocksA.filter((b) => !matchedA.has(b.id));
  const restB = blocksB.filter((b) => !matchedB.has(b.id));
  if (restA.length > 0 && restB.length > 0) {
    const scores = restA.map((a) =>
      restB.map((b) =>
        a.blockType === "table_row" || b.blockType === "table_row"
          ? rowSimilarity(a, b, weights)
          : blockSimilarity(a, b, weights),
      ),
    );
    for (const { row, col, score } of maximiseScores(scores, BLOCK_MATCH_THRESHOLD)) {
      const a = restA[row] as Block;
      const b = restB[col] as Block;
      matchedA.add(a.id);
      matchedB.add(b.id);
      pairs.push({
        blockA: a,
        blockB: b,
        similarity: Math.round(score * 10000) / 10000,
        status: "MODIFIED",
        sectionAlignment: alignment,
      });
    }
  }
  return { matchedA, matchedB, pairs };
}

/** Near-identical text in a different section is a move, not a delete plus an add. */
function detectMoves(
  orphanA: Array<{ block: Block; alignment: SectionAlignment }>,
  orphanB: Array<{ block: Block; alignment: SectionAlignment }>,
  weights: TermWeights,
): BlockAlignment[] {
  const out: BlockAlignment[] = [];
  const usedA = new Set<string>();
  const usedB = new Set<string>();

  if (orphanA.length > 0 && orphanB.length > 0) {
    const scores = orphanA.map((a) =>
      orphanB.map((b) =>
        a.block.blockType !== b.block.blockType
          ? 0
          : blockSimilarity(a.block, b.block, weights),
      ),
    );
    for (const { row, col, score } of maximiseScores(scores, MOVE_MATCH_THRESHOLD)) {
      const a = orphanA[row] as { block: Block; alignment: SectionAlignment };
      const b = orphanB[col] as { block: Block; alignment: SectionAlignment };
      usedA.add(a.block.id);
      usedB.add(b.block.id);
      out.push({
        blockA: a.block,
        blockB: b.block,
        similarity: Math.round(score * 10000) / 10000,
        status: "MOVED",
        sectionAlignment: a.alignment,
      });
    }
  }

  for (const { block, alignment } of orphanA) {
    if (!usedA.has(block.id)) {
      out.push({ blockA: block, blockB: null, similarity: 0, status: "REMOVED", sectionAlignment: alignment });
    }
  }
  for (const { block, alignment } of orphanB) {
    if (!usedB.has(block.id)) {
      out.push({ blockA: null, blockB: block, similarity: 0, status: "ADDED", sectionAlignment: alignment });
    }
  }
  return out;
}

export function alignBlocks(
  indexA: DocumentIndex,
  indexB: DocumentIndex,
  alignments: SectionAlignment[],
  weights?: TermWeights,
): BlockAlignment[] {
  const w = weights ?? new TermWeights([...indexA.doc.blocks, ...indexB.doc.blocks]);
  const pairs: BlockAlignment[] = [];
  const orphanA: Array<{ block: Block; alignment: SectionAlignment }> = [];
  const orphanB: Array<{ block: Block; alignment: SectionAlignment }> = [];

  for (const alignment of alignments) {
    const blocksA = alignment.sectionA ? comparable(indexA.blocksOf(alignment.sectionA.id)) : [];
    const blocksB = alignment.sectionB ? comparable(indexB.blocksOf(alignment.sectionB.id)) : [];

    if (blocksA.length === 0) {
      for (const block of blocksB) orphanB.push({ block, alignment });
      continue;
    }
    if (blocksB.length === 0) {
      for (const block of blocksA) orphanA.push({ block, alignment });
      continue;
    }

    const { matchedA, matchedB, pairs: local } = pairWithinSection(blocksA, blocksB, alignment, w);
    pairs.push(...local);
    for (const block of blocksA) if (!matchedA.has(block.id)) orphanA.push({ block, alignment });
    for (const block of blocksB) if (!matchedB.has(block.id)) orphanB.push({ block, alignment });
  }

  pairs.push(...detectMoves(orphanA, orphanB, w));
  return pairs;
}

export { normalizeText };
