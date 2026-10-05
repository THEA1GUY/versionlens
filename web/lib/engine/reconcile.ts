/**
 * Change reconciliation and citation binding.
 *
 * Three detectors can see the same edit. This module makes them one change object with
 * a `detectors` list, rather than three alerts about the same sentence, and attaches
 * citations built from real block ids.
 */

import type { BlockAlignment, SectionAlignment } from "./align";
import {
  type Category,
  type Change,
  type ChangeType,
  type Detector,
  type DiffOp,
  categorizeText,
  mergeCategories,
} from "./changes";
import { changedFragments, isCosmetic, wordDiff } from "./diff";
import type { Entity } from "./entities";
import { type Block, type Citation, type DocumentIndex, sectionLabel } from "./model";
import { confidence, confidenceLabel, importance } from "./score";
import type { SemanticFinding } from "./semantic";
import { partialRatio, ratio } from "./similarity";
import { type StructuredFinding, compareEntities } from "./structured";

/** A modified passage reaches the semantic layer only when a model adds information. */
const MODALITY_HINTS = [
  "shall", "must", "may", "will", "should", "required", "obliged", "entitled",
  "permitted", "responsible", "agrees", "undertakes", "reasonable", "endeavour",
  "endeavor", "discretion", "sole", "where applicable", "if requested", "as needed",
  "subject to", "at its option", "best efforts", "not", "no longer", "exclusive",
];
const SEMANTIC_MIN_RATIO = 0.04;

/**
 * Only exact values are safe to compare across a section's leftover blocks. Obligations
 * need true clause alignment — pairing two unrelated clauses' modalities invents
 * changes. Table rows are excluded too: a row's identity is its first cell, and row
 * add/remove is already reported.
 */
const FALLBACK_TYPES = new Set([
  "MONEY", "DATE", "DURATION", "PERCENT", "PAYMENT_PERIOD", "NOTICE_PERIOD", "INTEREST_RATE",
]);

export function pairId(alignment: BlockAlignment): string {
  return `${alignment.blockA?.id ?? "-"}::${alignment.blockB?.id ?? "-"}`;
}

function sectionPairKey(alignment: SectionAlignment): string {
  return `${alignment.sectionA?.id ?? "-"}::${alignment.sectionB?.id ?? "-"}`;
}

export function semanticCandidates(alignments: BlockAlignment[]): Array<{
  id: string;
  textA: string;
  textB: string;
  hint: string;
}> {
  const scored: Array<{ priority: number; payload: { id: string; textA: string; textB: string; hint: string } }> = [];
  for (const al of alignments) {
    if ((al.status !== "MODIFIED" && al.status !== "MOVED") || !al.blockA || !al.blockB) continue;
    const a = al.blockA;
    const b = al.blockB;
    if (isCosmetic(a.text, b.text)) continue;

    const changeRatio = 1 - ratio(a.normalized, b.normalized);
    if (changeRatio < SEMANTIC_MIN_RATIO) continue;

    const { before, after } = changedFragments(wordDiff(a.text, b.text));
    const blob = `${before} ${after}`.toLowerCase();
    const modality = MODALITY_HINTS.some((h) => blob.includes(h));
    if (!modality && changeRatio < 0.18) continue;

    scored.push({
      priority: changeRatio + (modality ? 0.5 : 0),
      payload: {
        id: pairId(al),
        textA: a.text,
        textB: b.text,
        hint: before || after ? `${before} -> ${after}` : "",
      },
    });
  }
  scored.sort((x, y) => y.priority - x.priority);
  return scored.map((s) => s.payload);
}

/**
 * Changed text not already explained by a structured finding.
 *
 * Without this, a price edit would be reported twice: once as a pricing change and
 * again as an unexplained wording change on the same sentence.
 */
function residualFragments(ops: DiffOp[], findings: StructuredFinding[]): string[] {
  const covered: string[] = [];
  for (const f of findings) {
    for (const e of [f.entityA, f.entityB]) {
      if (e) covered.push(e.sourceText.toLowerCase());
    }
  }
  const residual: string[] = [];
  for (const op of ops) {
    if (op.op === "equal") continue;
    for (const fragment of [op.a, op.b]) {
      const frag = fragment.trim();
      if (!frag || !/[\p{L}\p{N}]/u.test(frag)) continue;
      const low = frag.toLowerCase();
      if (covered.some((c) => low.includes(c) || c.includes(low))) continue;
      if (covered.some((c) => partialRatio(low, c) >= 0.9)) continue;
      residual.push(frag);
    }
  }
  return residual;
}

function entitySpan(entity: Entity | null): [number, number] | null {
  return entity ? [entity.charStart, entity.charEnd] : null;
}

function entityCategories(entities: Iterable<Entity>): Category[] {
  const mapping: Record<string, Category> = {
    MONEY: "PRICING",
    PERCENT: "PRICING",
    INTEREST_RATE: "PAYMENT_TERMS",
    PAYMENT_PERIOD: "PAYMENT_TERMS",
    NOTICE_PERIOD: "TERMINATION",
    DATE: "DATES",
    DURATION: "DURATION",
    OBLIGATION: "OBLIGATIONS",
  };
  const out: Category[] = [];
  for (const e of entities) {
    const c = mapping[e.type];
    if (c && !out.includes(c)) out.push(c);
  }
  return out;
}

function categoriesFor(texts: Array<string | null | undefined>, fallback: Category): Category[] {
  const hits = categorizeText(...texts);
  return hits.length > 0 ? hits : [fallback];
}

function shorten(text: string, limit = 180): string {
  const s = text.split(/\s+/).filter(Boolean).join(" ");
  return s.length <= limit ? s : `${s.slice(0, limit - 1).trimEnd()}…`;
}

function rewriteSummary(before: string, after: string): string {
  if (before && after) return `Wording changed: "${shorten(before, 120)}" → "${shorten(after, 120)}".`;
  if (after) return `Text added: "${shorten(after, 160)}".`;
  if (before) return `Text removed: "${shorten(before, 160)}".`;
  return "Text modified.";
}

const IMPORTANCE_ORDER: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };

export class ChangeBuilder {
  private counter = 0;

  constructor(
    private readonly indexA: DocumentIndex,
    private readonly indexB: DocumentIndex,
  ) {}

  private nextId(): string {
    this.counter += 1;
    return `chg_${String(this.counter).padStart(5, "0")}`;
  }

  /** Built from the document model only — a model never supplies these. */
  citation(block: Block | null, side: "A" | "B", span?: [number, number] | null): Citation | null {
    if (!block) return null;
    const index = side === "A" ? this.indexA : this.indexB;
    const [rawStart, rawEnd] = span ?? [0, block.text.length];
    const start = Math.max(0, Math.min(rawStart, block.text.length));
    const end = Math.max(start, Math.min(rawEnd, block.text.length));
    return {
      documentVersion: side,
      blockId: block.id,
      page: block.page,
      section: index.path(block.sectionId),
      charStart: start,
      charEnd: end,
      text: span ? block.text.slice(start, end) : block.text,
      bbox: block.bbox,
    };
  }

  private sectionPath(index: DocumentIndex, block: Block | null): string | null {
    return block ? index.path(block.sectionId) : null;
  }

  private blank(partial: Partial<Change> & Pick<Change, "type" | "category" | "categories" | "summary">): Change {
    return {
      id: this.nextId(),
      importance: "LOW",
      importanceScore: 0,
      confidence: 0,
      confidenceLabel: "Low confidence",
      confidenceSignals: {},
      oldValue: null,
      newValue: null,
      delta: null,
      direction: null,
      citationA: null,
      citationB: null,
      textA: "",
      textB: "",
      wordDiff: [],
      detectors: [],
      sectionA: null,
      sectionB: null,
      notes: [],
      reviewStatus: "unreviewed",
      reviewedBy: null,
      reviewedAt: null,
      reviewerNotes: [],
      ...partial,
    };
  }

  build(
    blockAlignments: BlockAlignment[],
    sectionAlignments: SectionAlignment[],
    entitiesA: Map<string, Entity[]>,
    entitiesB: Map<string, Entity[]>,
    semantic: Map<string, SemanticFinding> = new Map(),
  ): Change[] {
    const changes: Change[] = [];

    // A wholly added or removed section is reported once, by the section layer. Its
    // individual blocks must not also be listed, or one removed clause becomes three
    // alerts. Kept per side: block ids identify a position within one document, so
    // "p2-b5" exists in both.
    const { sideA: suppressedA, sideB: suppressedB } = blocksInWholeSections(
      sectionAlignments, this.indexA, this.indexB,
    );

    const unpairedA = new Map<string, Block[]>();
    const unpairedB = new Map<string, Block[]>();

    for (const al of blockAlignments) {
      if (al.status === "UNCHANGED") continue;
      if (al.status === "ADDED" && al.blockB && suppressedB.has(al.blockB.id)) continue;
      if (al.status === "REMOVED" && al.blockA && suppressedA.has(al.blockA.id)) continue;

      if (al.status === "MODIFIED") {
        changes.push(...this.modified(al, entitiesA, entitiesB, semantic));
      } else if (al.status === "ADDED") {
        changes.push(this.addedOrRemoved(al, entitiesB, true));
        if (al.sectionAlignment?.status === "MATCHED" && al.blockB) {
          push(unpairedB, sectionPairKey(al.sectionAlignment), al.blockB);
        }
      } else if (al.status === "REMOVED") {
        changes.push(this.addedOrRemoved(al, entitiesA, false));
        if (al.sectionAlignment?.status === "MATCHED" && al.blockA) {
          push(unpairedA, sectionPairKey(al.sectionAlignment), al.blockA);
        }
      } else if (al.status === "MOVED") {
        changes.push(...this.moved(al, entitiesA, entitiesB, semantic));
      }
    }

    changes.push(...this.sectionFallback(sectionAlignments, unpairedA, unpairedB, entitiesA, entitiesB));
    changes.push(...this.sectionLevel(sectionAlignments));

    for (const change of changes) {
      const { level, score } = importance(change);
      change.importance = level;
      change.importanceScore = score;
    }
    changes.sort((x, y) => {
      const ix = IMPORTANCE_ORDER[x.importance] ?? 2;
      const iy = IMPORTANCE_ORDER[y.importance] ?? 2;
      if (ix !== iy) return ix - iy;
      if (x.importanceScore !== y.importanceScore) return y.importanceScore - x.importanceScore;
      const px = x.citationB?.page ?? x.citationA?.page ?? 999;
      const py = y.citationB?.page ?? y.citationA?.page ?? 999;
      return px - py || x.id.localeCompare(y.id);
    });
    return changes;
  }

  /* ---------------------------------------------------------------- modified */

  private modified(
    al: BlockAlignment,
    entitiesA: Map<string, Entity[]>,
    entitiesB: Map<string, Entity[]>,
    semantic: Map<string, SemanticFinding>,
  ): Change[] {
    const a = al.blockA as Block;
    const b = al.blockB as Block;
    const ops = wordDiff(a.text, b.text);
    const findings = compareEntities(a, b, entitiesA.get(a.id) ?? [], entitiesB.get(b.id) ?? []);
    const sem = semantic.get(pairId(al)) ?? null;
    const alignConf = al.sectionAlignment?.confidence ?? 0.8;

    const out = findings.map((f) => this.fromStructured(f, al, ops, alignConf, sem));

    const residual = residualFragments(ops, findings);
    const cosmetic = isCosmetic(a.text, b.text);
    const meaning = Boolean(sem?.meaningChanged);

    if (residual.length === 0) {
      if (out.length > 0) {
        // Structured extraction already explains every changed fragment. A semantic
        // meaning flag corroborates those findings; it records itself on them rather
        // than raising a second alert for the same edit. The structured change keeps
        // its own type and exact delta, which are more precise than the model's prose.
        if (meaning && sem?.summary) {
          for (const change of out) change.notes.push(`Semantic analysis: ${sem.summary}`);
        }
        return out;
      }
      if (!meaning) {
        return cosmetic ? [this.cosmetic(al, ops, alignConf)] : out;
      }
    }

    if (cosmetic && !meaning) {
      return [...out, this.cosmetic(al, ops, alignConf)];
    }

    const { before, after } = changedFragments(ops);
    let categories = categoriesFor([a.text, b.text], "WORDING");
    if (meaning && sem?.category) categories = mergeCategories([sem.category], categories);

    const summary = meaning && sem?.summary ? sem.summary : rewriteSummary(before, after);
    const detectors: Detector[] = sem ? ["text_diff", "semantic_analysis"] : ["text_diff"];
    const { score, signals } = confidence({
      alignment: alignConf,
      diff: Math.min(1, 0.55 + al.similarity * 0.4),
      semantic: sem?.confidence ?? null,
    });

    const change = this.blank({
      type: meaning ? "MEANING_CHANGED" : "MODIFIED",
      category: categories[0] as Category,
      categories,
      summary,
      confidence: score,
      confidenceLabel: confidenceLabel(score),
      confidenceSignals: signals,
      oldValue: before ? { value: before, unit: "text" } : null,
      newValue: after ? { value: after, unit: "text" } : null,
      direction: meaning ? "meaning_changed" : "text_modified",
      citationA: this.citation(a, "A"),
      citationB: this.citation(b, "B"),
      textA: a.text,
      textB: b.text,
      wordDiff: ops,
      detectors,
      sectionA: this.sectionPath(this.indexA, a),
      sectionB: this.sectionPath(this.indexB, b),
    });
    if (meaning && sem) {
      change.notes.push("Meaning change flagged by semantic analysis. Review recommended.");
    }
    out.push(change);
    return out;
  }

  private fromStructured(
    finding: StructuredFinding,
    al: BlockAlignment,
    ops: DiffOp[],
    alignConf: number,
    sem: SemanticFinding | null,
  ): Change {
    const a = al.blockA;
    const b = al.blockB;
    const categories = mergeCategories(
      [finding.category],
      categoriesFor([a?.text, b?.text], finding.category),
    );
    const detectors: Detector[] = ["structured_extraction", "text_diff"];
    let semanticConf: number | null = null;
    if (sem?.meaningChanged) {
      detectors.push("semantic_analysis");
      semanticConf = sem.confidence;
    }
    const { score, signals } = confidence({
      alignment: alignConf,
      diff: Math.min(1, 0.6 + al.similarity * 0.4),
      extraction: finding.confidence,
      semantic: semanticConf,
    });
    const type: ChangeType =
      finding.oldValue === null ? "ADDED" : finding.newValue === null ? "REMOVED" : "MODIFIED";

    return this.blank({
      type,
      category: categories[0] as Category,
      categories,
      summary: finding.summary,
      confidence: score,
      confidenceLabel: confidenceLabel(score),
      confidenceSignals: signals,
      oldValue: finding.oldValue,
      newValue: finding.newValue,
      delta: Object.keys(finding.delta).length > 0 ? finding.delta : null,
      direction: finding.direction,
      citationA: this.citation(a, "A", entitySpan(finding.entityA)),
      citationB: this.citation(b, "B", entitySpan(finding.entityB)),
      textA: a?.text ?? "",
      textB: b?.text ?? "",
      wordDiff: ops,
      detectors,
      sectionA: this.sectionPath(this.indexA, a),
      sectionB: this.sectionPath(this.indexB, b),
    });
  }

  private cosmetic(al: BlockAlignment, ops: DiffOp[], alignConf: number): Change {
    const { score, signals } = confidence({ alignment: alignConf, diff: 1 });
    return this.blank({
      type: "MODIFIED",
      category: "FORMATTING",
      categories: ["FORMATTING"],
      summary: "Formatting or punctuation only — no wording change detected.",
      confidence: score,
      confidenceLabel: confidenceLabel(score),
      confidenceSignals: signals,
      direction: "formatting",
      citationA: this.citation(al.blockA, "A"),
      citationB: this.citation(al.blockB, "B"),
      textA: al.blockA?.text ?? "",
      textB: al.blockB?.text ?? "",
      wordDiff: ops,
      detectors: ["text_diff"],
      sectionA: this.sectionPath(this.indexA, al.blockA),
      sectionB: this.sectionPath(this.indexB, al.blockB),
    });
  }

  /* ----------------------------------------------------------- added/removed */

  private addedOrRemoved(
    al: BlockAlignment,
    entities: Map<string, Entity[]>,
    added: boolean,
  ): Change {
    const block = (added ? al.blockB : al.blockA) as Block;
    const index = added ? this.indexB : this.indexA;
    const found = entities.get(block.id) ?? [];
    const verb = added ? "added" : "removed";

    // The owning section heading says what the clause is about more reliably than the
    // clause's own words: "must provide weekly reports" under "Responsibilities" is a
    // responsibilities change, not a generic scope change.
    const section = index.section(block.sectionId);
    const categories = mergeCategories(
      categorizeText(section?.heading),
      mergeCategories(categoriesFor([block.text], "SCOPE"), entityCategories(found)),
    );

    const headline =
      block.blockType === "table_row" && block.cells
        ? `Table row ${verb}: ${block.cells[0] || "(unnamed)"}` +
          (block.cells.slice(1).filter(Boolean).length > 0
            ? ` (${block.cells.slice(1).filter(Boolean).join(", ")})`
            : "")
        : `Content ${verb}: ${shorten(block.text)}`;

    const alignConf = al.sectionAlignment?.confidence ?? 0.7;
    const { score, signals } = confidence({
      alignment: alignConf,
      diff: 1,
      extraction: found.length > 0 ? 0.95 : null,
    });
    const value = { value: block.text, unit: "text" };

    return this.blank({
      type: added ? "ADDED" : "REMOVED",
      category: categories[0] as Category,
      categories,
      summary: headline,
      confidence: score,
      confidenceLabel: confidenceLabel(score),
      confidenceSignals: signals,
      oldValue: added ? null : value,
      newValue: added ? value : null,
      direction: `content_${verb}`,
      citationA: added ? null : this.citation(block, "A"),
      citationB: added ? this.citation(block, "B") : null,
      textA: added ? "" : block.text,
      textB: added ? block.text : "",
      wordDiff: wordDiff(added ? "" : block.text, added ? block.text : ""),
      detectors: found.length > 0 ? ["text_diff", "structured_extraction"] : ["text_diff"],
      sectionA: added ? null : this.sectionPath(this.indexA, block),
      sectionB: added ? this.sectionPath(this.indexB, block) : null,
    });
  }

  /* ------------------------------------------------------------------ moved */

  private moved(
    al: BlockAlignment,
    entitiesA: Map<string, Entity[]>,
    entitiesB: Map<string, Entity[]>,
    semantic: Map<string, SemanticFinding>,
  ): Change[] {
    const a = al.blockA as Block;
    const b = al.blockB as Block;
    const ops = wordDiff(a.text, b.text);
    const { score, signals } = confidence({ alignment: al.similarity, diff: al.similarity });
    const categories = categoriesFor([a.text, b.text], "SCOPE");

    const moved = this.blank({
      type: "MOVED",
      category: categories[0] as Category,
      categories,
      summary:
        `Content moved from ${this.sectionPath(this.indexA, a)} (page ${a.page}) ` +
        `to ${this.sectionPath(this.indexB, b)} (page ${b.page}).` +
        (al.similarity >= 0.999 ? " No wording change detected." : ""),
      confidence: score,
      confidenceLabel: confidenceLabel(score),
      confidenceSignals: signals,
      direction: "moved",
      citationA: this.citation(a, "A"),
      citationB: this.citation(b, "B"),
      textA: a.text,
      textB: b.text,
      wordDiff: ops,
      detectors: ["text_diff"],
      sectionA: this.sectionPath(this.indexA, a),
      sectionB: this.sectionPath(this.indexB, b),
    });

    const out = [moved];
    // A moved block can also have been edited; report that separately.
    if (al.similarity < 0.999) out.push(...this.modified(al, entitiesA, entitiesB, semantic));
    return out;
  }

  /* ------------------------------------------------------- section fallback */

  /**
   * Compare values across a section's *unpaired* blocks.
   *
   * When a clause is rewritten so heavily that paragraph pairing fails, it is reported
   * as one removal plus one addition — correct, but it would lose the exact
   * "30 days -> 60 days" delta. Running structured comparison at section scope over the
   * leftovers recovers those deltas, which is what high recall on amounts, dates and
   * durations depends on.
   */
  private sectionFallback(
    sectionAlignments: SectionAlignment[],
    unpairedA: Map<string, Block[]>,
    unpairedB: Map<string, Block[]>,
    entitiesA: Map<string, Entity[]>,
    entitiesB: Map<string, Entity[]>,
  ): Change[] {
    const out: Change[] = [];
    for (const al of sectionAlignments) {
      if (al.status !== "MATCHED") continue;
      const key = sectionPairKey(al);
      const blocksA = unpairedA.get(key) ?? [];
      const blocksB = unpairedB.get(key) ?? [];
      if (blocksA.length === 0 || blocksB.length === 0) continue;

      const flatA = blocksA
        .filter((b) => b.blockType !== "table_row")
        .flatMap((b) => (entitiesA.get(b.id) ?? []).filter((e) => FALLBACK_TYPES.has(e.type)));
      const flatB = blocksB
        .filter((b) => b.blockType !== "table_row")
        .flatMap((b) => (entitiesB.get(b.id) ?? []).filter((e) => FALLBACK_TYPES.has(e.type)));
      if (flatA.length === 0 || flatB.length === 0) continue;

      for (const finding of compareEntities(blocksA[0] as Block, blocksB[0] as Block, flatA, flatB)) {
        // Only value-to-value changes are trustworthy at this scope; a lone added or
        // removed entity is already covered by the add/remove change.
        if (finding.oldValue === null || finding.newValue === null) continue;

        const blockA = finding.entityA ? this.indexA.block(finding.entityA.blockId) ?? null : null;
        const blockB = finding.entityB ? this.indexB.block(finding.entityB.blockId) ?? null : null;
        const { score, signals } = confidence({
          alignment: al.confidence,
          extraction: finding.confidence * 0.85,
        });
        const categories = mergeCategories(
          [finding.category],
          categoriesFor([blockA?.text, blockB?.text], finding.category),
        );
        const change = this.blank({
          type: "MODIFIED",
          category: categories[0] as Category,
          categories,
          summary: finding.summary,
          confidence: score,
          confidenceLabel: confidenceLabel(score),
          confidenceSignals: signals,
          oldValue: finding.oldValue,
          newValue: finding.newValue,
          delta: Object.keys(finding.delta).length > 0 ? finding.delta : null,
          direction: finding.direction,
          citationA: this.citation(blockA, "A", entitySpan(finding.entityA)),
          citationB: this.citation(blockB, "B", entitySpan(finding.entityB)),
          textA: blockA?.text ?? "",
          textB: blockB?.text ?? "",
          detectors: ["structured_extraction"],
          sectionA: this.sectionPath(this.indexA, blockA),
          sectionB: this.sectionPath(this.indexB, blockB),
        });
        change.notes.push(
          "Detected by value comparison within the section; the surrounding wording was " +
            "rewritten too heavily to align paragraph by paragraph.",
        );
        out.push(change);
      }
    }
    return out;
  }

  /* ---------------------------------------------------------- section level */

  private sectionLevel(sectionAlignments: SectionAlignment[]): Change[] {
    const out: Change[] = [];
    for (const al of sectionAlignments) {
      if (al.status === "MATCHED") {
        const renamed = this.renamed(al);
        if (renamed) out.push(renamed);
        continue;
      }
      const added = al.status === "ADDED";
      const section = added ? al.sectionB : al.sectionA;
      if (!section) continue;
      const index = added ? this.indexB : this.indexA;
      const blocks = index.blocksOf(section.id);
      if (blocks.length === 0) continue;

      const body = blocks.map((b) => b.text).join(" ");
      // The heading names the subject; body text mentions many topics in passing, so it
      // only decides the category when the heading says nothing.
      const categories = mergeCategories(
        categorizeText(section.heading),
        categoriesFor([body], "SCOPE"),
      );
      const { score, signals } = confidence({ alignment: 0.95, diff: 1 });
      const verb = added ? "added" : "removed";
      const pageRange =
        section.startPage === section.endPage
          ? `page ${section.startPage}`
          : `pages ${section.startPage}-${section.endPage}`;

      out.push(
        this.blank({
          type: added ? "SECTION_ADDED" : "SECTION_REMOVED",
          category: categories[0] as Category,
          categories,
          summary:
            `Section ${verb}: ${sectionLabel(section)} ` +
            `(${blocks.length} block${blocks.length === 1 ? "" : "s"}, ${pageRange}).`,
          confidence: score,
          confidenceLabel: confidenceLabel(score),
          confidenceSignals: signals,
          oldValue: added ? null : { value: sectionLabel(section), unit: "section" },
          newValue: added ? { value: sectionLabel(section), unit: "section" } : null,
          direction: `section_${verb}`,
          citationA: added ? null : this.citation(blocks[0] as Block, "A"),
          citationB: added ? this.citation(blocks[0] as Block, "B") : null,
          textA: added ? "" : shorten(body, 600),
          textB: added ? shorten(body, 600) : "",
          detectors: ["section_alignment"],
          sectionA: added ? null : this.indexA.path(section.id),
          sectionB: added ? this.indexB.path(section.id) : null,
        }),
      );
    }
    return out;
  }

  /** A renumbered or retitled section: one low-priority note, not a text edit. */
  private renamed(al: SectionAlignment): Change | null {
    const sa = al.sectionA;
    const sb = al.sectionB;
    if (!sa || !sb) return null;
    const headingChanged = sa.normalizedHeading !== sb.normalizedHeading;
    const numberChanged = (sa.sectionNumber ?? "") !== (sb.sectionNumber ?? "");
    if (!headingChanged && !numberChanged) return null;

    const summary = headingChanged
      ? `Section renamed: "${sectionLabel(sa)}" → "${sectionLabel(sb)}".`
      : `Section renumbered: "${sectionLabel(sa)}" → "${sectionLabel(sb)}".`;
    const categories = mergeCategories(categorizeText(sb.heading, sa.heading), ["FORMATTING"]);
    const { score, signals } = confidence({ alignment: al.confidence, diff: 1 });
    const blocksA = this.indexA.blocksOf(sa.id);
    const blocksB = this.indexB.blocksOf(sb.id);

    const change = this.blank({
      type: "SECTION_RENAMED",
      category: headingChanged ? (categories[0] as Category) : "FORMATTING",
      categories: headingChanged ? categories : ["FORMATTING"],
      summary,
      confidence: score,
      confidenceLabel: confidenceLabel(score),
      confidenceSignals: signals,
      oldValue: { value: sectionLabel(sa), unit: "section" },
      newValue: { value: sectionLabel(sb), unit: "section" },
      direction: headingChanged ? "section_renamed" : "section_renumbered",
      citationA: blocksA[0] ? this.citation(blocksA[0], "A") : null,
      citationB: blocksB[0] ? this.citation(blocksB[0], "B") : null,
      textA: sectionLabel(sa),
      textB: sectionLabel(sb),
      detectors: ["section_alignment"],
      sectionA: this.indexA.path(sa.id),
      sectionB: this.indexB.path(sb.id),
    });
    change.notes.push(
      `Matched with ${Math.round(al.confidence * 100)}% alignment confidence — the ` +
        "sections' content was compared as corresponding.",
    );
    return change;
  }
}

function push(map: Map<string, Block[]>, key: string, block: Block): void {
  const list = map.get(key);
  if (list) list.push(block);
  else map.set(key, [block]);
}

function blocksInWholeSections(
  sectionAlignments: SectionAlignment[],
  indexA: DocumentIndex,
  indexB: DocumentIndex,
): { sideA: Set<string>; sideB: Set<string> } {
  const sideA = new Set<string>();
  const sideB = new Set<string>();
  for (const al of sectionAlignments) {
    if (al.status === "ADDED" && al.sectionB) {
      for (const b of indexB.blocksOf(al.sectionB.id)) sideB.add(b.id);
    } else if (al.status === "REMOVED" && al.sectionA) {
      for (const b of indexA.blocksOf(al.sectionA.id)) sideA.add(b.id);
    }
  }
  return { sideA, sideB };
}
