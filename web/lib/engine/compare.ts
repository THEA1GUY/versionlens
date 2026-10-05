/** Comparison orchestrator, with progress reporting. */

import {
  type BlockAlignment,
  type SectionAlignment,
  TermWeights,
  alignBlocks,
  alignSections,
  headingSimilarity,
} from "./align";
import type { Category, Change, Importance } from "./changes";
import { type DateLocale, type Entity, entitiesFor } from "./entities";
import {
  ENGINE_VERSION,
  EXTRACTION_VERSION,
  type DocumentModel,
  DocumentIndex,
  type Section,
  sectionLabel,
} from "./model";
import { ChangeBuilder, semanticCandidates } from "./reconcile";
import { segment } from "./segment";
import { type AlignmentCase, type SemanticFinding, SemanticAnalyzer } from "./semantic";

export const DISCLAIMER =
  "VersionLens helps users identify differences between document versions. Its output " +
  "is intended as a review aid and does not constitute legal advice. Important contracts " +
  "and legal documents should be reviewed by a qualified professional.";

export type Stage =
  | "EXTRACTING"
  | "SEGMENTING"
  | "ALIGNING"
  | "DIFFING"
  | "ANALYZING"
  | "GENERATING_RESULTS"
  | "COMPLETED"
  | "PARTIAL"
  | "FAILED";

export type ProgressFn = (stage: Stage, message: string) => void;

export interface DocumentSummary {
  label: string;
  filename: string;
  sha256: string;
  pageCount: number;
  sectionCount: number;
  blockCount: number;
  extractionVersion: string;
  paginationApproximate: boolean;
  pages: Array<{
    pageNumber: number;
    status: string;
    extractionConfidence: number;
    note: string | null;
    width: number | null;
    height: number | null;
  }>;
}

export interface SectionMapRow {
  status: "MATCHED" | "ADDED" | "REMOVED";
  sectionA: string | null;
  sectionB: string | null;
  pageA: number | null;
  pageB: number | null;
  alignmentConfidence: number;
  alignmentSignals: Record<string, number>;
  changeCount: number;
  arbitratedByModel: boolean;
}

export interface ComparisonSummary {
  headline: string;
  totalChanges: number;
  materialChanges: number;
  minorChanges: number;
  highAttention: number;
  mediumAttention: number;
  lowAttention: number;
  byCategory: Record<string, number>;
  byType: Record<string, number>;
  keyChanges: Array<{
    changeId: string;
    category: Category;
    summary: string;
    importance: Importance;
  }>;
  identical: boolean;
}

export interface ComparisonAudit {
  engineVersion: string;
  extractionVersion: string;
  analysisModelVersion: string;
  semanticCalls: number;
  semanticTokensIn: number;
  semanticTokensOut: number;
  semanticError: string | null;
  alignmentsArbitrated: number;
  startedAt: string;
  completedAt: string;
  durationSeconds: number;
  locale: DateLocale;
}

export interface ComparisonResult {
  status: Stage;
  changes: Change[];
  summary: ComparisonSummary;
  sectionMap: SectionMapRow[];
  documents: { a: DocumentSummary; b: DocumentSummary };
  warnings: string[];
  audit: ComparisonAudit;
  disclaimer: string;
  error: string | null;
}

export interface CompareOptions {
  labelA?: string;
  labelB?: string;
  analyzer?: SemanticAnalyzer | null;
  locale?: DateLocale;
  progress?: ProgressFn;
}

/**
 * Section pairings within this margin of the runner-up are genuinely ambiguous: the
 * deterministic score cannot separate them, so a model's subject-matter judgement adds
 * information. Everything outside the margin is decided without a call.
 */
const ARBITRATION_MARGIN = 0.06;
const MAX_ARBITRATION_CASES = 6;

export async function compareDocuments(
  docA: DocumentModel,
  docB: DocumentModel,
  options: CompareOptions = {},
): Promise<ComparisonResult> {
  const started = new Date();
  const locale = options.locale ?? "DMY";
  const analyzer = options.analyzer ?? null;
  const labelA = options.labelA ?? docA.filename;
  const labelB = options.labelB ?? docB.filename;
  const report: ProgressFn = options.progress ?? (() => {});

  try {
    report("SEGMENTING", "Identifying sections");
    segment(docA);
    segment(docB);
    const indexA = new DocumentIndex(docA);
    const indexB = new DocumentIndex(docB);

    const entitiesA = entitiesFor(docA.blocks, locale);
    const entitiesB = entitiesFor(docB.blocks, locale);

    report("ALIGNING", "Aligning corresponding sections");
    let sectionAlignments = alignSections(indexA, indexB, entitiesA, entitiesB);
    let arbitrated = 0;

    if (analyzer?.available) {
      const cases = ambiguousAlignments(indexA, indexB, sectionAlignments);
      if (cases.length > 0) {
        report("ALIGNING", `Resolving ${cases.length} ambiguous section pairing(s)`);
        const choices = await analyzer.arbitrateAlignment(cases);
        const applied = applyArbitration(sectionAlignments, choices, indexA, indexB);
        sectionAlignments = applied.alignments;
        arbitrated = applied.count;
      }
    }

    report("DIFFING", "Comparing terms and values");
    const weights = new TermWeights([...docA.blocks, ...docB.blocks]);
    const blockAlignments = alignBlocks(indexA, indexB, sectionAlignments, weights);

    let semantic = new Map<string, SemanticFinding>();
    let semanticNote: string | null = null;

    if (analyzer?.available) {
      const candidates = semanticCandidates(blockAlignments);
      if (candidates.length > 0) {
        report("ANALYZING", `Reviewing meaning changes (${candidates.length} passages)`);
        semantic = await analyzer.analyze(candidates);
        if (analyzer.usage.lastError && semantic.size === 0) {
          semanticNote =
            "Semantic analysis was unavailable; results are based on deterministic " +
            "comparison only.";
        }
      }
    } else {
      semanticNote =
        "No analysis model configured; meaning-change detection is limited to " +
        "deterministic signals.";
    }

    report("GENERATING_RESULTS", "Building report");
    const builder = new ChangeBuilder(indexA, indexB);
    const changes = builder.build(
      blockAlignments,
      sectionAlignments,
      entitiesA,
      entitiesB,
      semantic,
    );

    const warnings = [...docA.warnings, ...docB.warnings];
    if (semanticNote) warnings.push(semanticNote);

    const finished = new Date();
    const status: Stage = hasBlockingWarning(docA, docB) ? "PARTIAL" : "COMPLETED";

    const result: ComparisonResult = {
      status,
      changes,
      summary: buildSummary(changes, docA, docB, labelA, labelB),
      sectionMap: buildSectionMap(indexA, indexB, sectionAlignments, changes),
      documents: {
        a: documentSummary(docA, labelA, indexA),
        b: documentSummary(docB, labelB, indexB),
      },
      warnings,
      audit: {
        engineVersion: ENGINE_VERSION,
        extractionVersion: EXTRACTION_VERSION,
        analysisModelVersion: analyzer?.modelVersion ?? "none",
        semanticCalls: analyzer?.usage.calls ?? 0,
        semanticTokensIn: analyzer?.usage.tokensIn ?? 0,
        semanticTokensOut: analyzer?.usage.tokensOut ?? 0,
        semanticError: analyzer?.usage.lastError ?? null,
        alignmentsArbitrated: arbitrated,
        startedAt: started.toISOString(),
        completedAt: finished.toISOString(),
        durationSeconds: Math.round(((finished.getTime() - started.getTime()) / 1000) * 1000) / 1000,
        locale,
      },
      disclaimer: DISCLAIMER,
      error: null,
    };
    report(status, "Comparison complete");
    return result;
  } catch (err) {
    const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    report("FAILED", message);
    const finished = new Date();
    return {
      status: "FAILED",
      changes: [],
      summary: emptySummary(),
      sectionMap: [],
      documents: {
        a: documentSummary(docA, labelA, new DocumentIndex(docA)),
        b: documentSummary(docB, labelB, new DocumentIndex(docB)),
      },
      warnings: [],
      audit: {
        engineVersion: ENGINE_VERSION,
        extractionVersion: EXTRACTION_VERSION,
        analysisModelVersion: analyzer?.modelVersion ?? "none",
        semanticCalls: analyzer?.usage.calls ?? 0,
        semanticTokensIn: analyzer?.usage.tokensIn ?? 0,
        semanticTokensOut: analyzer?.usage.tokensOut ?? 0,
        semanticError: analyzer?.usage.lastError ?? null,
        alignmentsArbitrated: 0,
        startedAt: started.toISOString(),
        completedAt: finished.toISOString(),
        durationSeconds: 0,
        locale,
      },
      disclaimer: DISCLAIMER,
      error: message,
    };
  }
}

/* ------------------------------------------------------- alignment arbitration */

/**
 * Find the pairings the deterministic score could not separate.
 *
 * A section whose best and second-best candidates are within `ARBITRATION_MARGIN` is a
 * genuine coin-flip for lexical scoring — typically repeated headings like
 * "Schedule 1 / 2 / 3". Those few cases, and only those, are worth a model call.
 */
function ambiguousAlignments(
  indexA: DocumentIndex,
  indexB: DocumentIndex,
  alignments: SectionAlignment[],
): AlignmentCase[] {
  const matched = alignments.filter((a) => a.status === "MATCHED");
  const unmatchedB = alignments
    .filter((a) => a.status === "ADDED" && a.sectionB)
    .map((a) => a.sectionB as Section);
  if (matched.length === 0) return [];

  const cases: AlignmentCase[] = [];
  for (const al of matched) {
    const sa = al.sectionA as Section;
    const sb = al.sectionB as Section;
    // Rivals are the unmatched B sections whose heading scores close to the chosen one.
    const chosenScore = headingSimilarity(sa.normalizedHeading, sb.normalizedHeading);
    const rivals = unmatchedB
      .map((cand) => ({
        section: cand,
        score: headingSimilarity(sa.normalizedHeading, cand.normalizedHeading),
      }))
      .filter((r) => r.score >= chosenScore - ARBITRATION_MARGIN && r.score > 0.4)
      .sort((x, y) => y.score - x.score)
      .slice(0, 3);
    if (rivals.length === 0) continue;

    cases.push({
      id: `${sa.id}`,
      headingA: sectionLabel(sa),
      excerptA: excerpt(indexA, sa),
      candidates: [
        { id: sb.id, heading: sectionLabel(sb), excerpt: excerpt(indexB, sb), score: al.confidence },
        ...rivals.map((r) => ({
          id: r.section.id,
          heading: sectionLabel(r.section),
          excerpt: excerpt(indexB, r.section),
          score: r.score,
        })),
      ],
    });
    if (cases.length >= MAX_ARBITRATION_CASES) break;
  }
  return cases;
}

function excerpt(index: DocumentIndex, section: Section): string {
  return index
    .blocksOf(section.id)
    .map((b) => b.text)
    .join(" ")
    .slice(0, 500);
}

function applyArbitration(
  alignments: SectionAlignment[],
  choices: Map<string, { choice: string | null; confidence: number }>,
  indexA: DocumentIndex,
  indexB: DocumentIndex,
): { alignments: SectionAlignment[]; count: number } {
  if (choices.size === 0) return { alignments, count: 0 };

  const bySectionA = new Map(alignments.filter((a) => a.sectionA).map((a) => [a.sectionA!.id, a]));
  const takenB = new Set(alignments.filter((a) => a.sectionB).map((a) => a.sectionB!.id));
  let count = 0;

  for (const [caseId, decision] of choices) {
    const al = bySectionA.get(caseId);
    if (!al || !al.sectionA) continue;

    if (decision.choice === null) {
      // The model says none of the candidates is the same section. A wrong pairing is
      // worse than no pairing, so split it back into a removal plus an addition.
      if (al.status !== "MATCHED" || !al.sectionB) continue;
      const orphan = al.sectionB;
      al.sectionB = null;
      al.status = "REMOVED";
      al.signals = { ...al.signals, arbitration: 0 };
      takenB.delete(orphan.id);
      alignments.push({
        sectionA: null,
        sectionB: orphan,
        confidence: 1,
        signals: {},
        status: "ADDED",
      });
      count += 1;
      continue;
    }

    if (al.sectionB?.id === decision.choice) continue; // already correct
    const target = indexB.leafSections().find((s) => s.id === decision.choice);
    if (!target || takenB.has(target.id)) continue;

    const previous = al.sectionB;
    al.sectionB = target;
    al.confidence = Math.max(al.confidence, decision.confidence);
    al.signals = { ...al.signals, arbitration: decision.confidence };
    takenB.add(target.id);
    if (previous) {
      takenB.delete(previous.id);
      alignments.push({
        sectionA: null,
        sectionB: previous,
        confidence: 1,
        signals: {},
        status: "ADDED",
      });
    }
    count += 1;
  }
  void indexA;
  return { alignments, count };
}

/* -------------------------------------------------------------------- summary */

const MINOR_CATEGORIES = new Set<Category>(["FORMATTING", "WORDING"]);

function isMinor(change: Change): boolean {
  if (change.type === "MEANING_CHANGED") return false;
  if (change.type === "SECTION_RENAMED" || change.type === "MOVED") return true;
  return (
    change.importance === "LOW" && change.categories.every((c) => MINOR_CATEGORIES.has(c))
  );
}

function emptySummary(): ComparisonSummary {
  return {
    headline: "",
    totalChanges: 0,
    materialChanges: 0,
    minorChanges: 0,
    highAttention: 0,
    mediumAttention: 0,
    lowAttention: 0,
    byCategory: {},
    byType: {},
    keyChanges: [],
    identical: false,
  };
}

export function buildSummary(
  changes: Change[],
  docA: DocumentModel,
  docB: DocumentModel,
  labelA: string,
  labelB: string,
): ComparisonSummary {
  const byCategory: Record<string, number> = {};
  const byType: Record<string, number> = {};
  let high = 0;
  let medium = 0;
  let low = 0;

  for (const c of changes) {
    for (const cat of c.categories) byCategory[cat] = (byCategory[cat] ?? 0) + 1;
    byType[c.type] = (byType[c.type] ?? 0) + 1;
    if (c.importance === "HIGH") high += 1;
    else if (c.importance === "MEDIUM") medium += 1;
    else low += 1;
  }

  const material = changes.filter((c) => !isMinor(c)).length;
  const minor = changes.length - material;

  return {
    headline: headline(changes.length, material, labelA, labelB),
    totalChanges: changes.length,
    materialChanges: material,
    minorChanges: minor,
    highAttention: high,
    mediumAttention: medium,
    lowAttention: low,
    byCategory,
    byType,
    keyChanges: changes
      .filter((c) => c.importance === "HIGH")
      .slice(0, 12)
      .map((c) => ({
        changeId: c.id,
        category: c.category,
        summary: c.summary,
        importance: c.importance,
      })),
    identical: deterministicallyIdentical(docA, docB),
  };
}

function headline(total: number, material: number, labelA: string, labelB: string): string {
  if (total === 0) return `No differences detected between ${labelA} and ${labelB}.`;
  if (material === 0) {
    return (
      `No material changes detected. ${total} minor formatting or wording ` +
      `difference${total === 1 ? "" : "s"} found.`
    );
  }
  return `${labelB} contains ${total} detected change${total === 1 ? "" : "s"} compared with ${labelA}.`;
}

/** Only claim "identical" when it is actually provable. */
function deterministicallyIdentical(docA: DocumentModel, docB: DocumentModel): boolean {
  if (docA.sha256 === docB.sha256) return true;
  if (docA.blocks.length !== docB.blocks.length) return false;
  return docA.blocks.every((b, i) => b.normalized === docB.blocks[i]?.normalized);
}

function hasBlockingWarning(docA: DocumentModel, docB: DocumentModel): boolean {
  return [docA, docB].some((doc) =>
    doc.pages.some((p) => p.status === "scanned_document" || p.status === "unreadable_page"),
  );
}

function documentSummary(
  doc: DocumentModel,
  label: string,
  index: DocumentIndex,
): DocumentSummary {
  return {
    label,
    filename: doc.filename,
    sha256: doc.sha256,
    pageCount: doc.pages.length,
    sectionCount: index.leafSections().length,
    blockCount: doc.blocks.length,
    extractionVersion: doc.extractionVersion,
    paginationApproximate: doc.paginationApproximate,
    pages: doc.pages.map((p) => ({
      pageNumber: p.pageNumber,
      status: p.status,
      extractionConfidence: p.extractionConfidence,
      note: p.note,
      width: p.width,
      height: p.height,
    })),
  };
}

export function buildSectionMap(
  indexA: DocumentIndex,
  indexB: DocumentIndex,
  alignments: SectionAlignment[],
  changes: Change[],
): SectionMapRow[] {
  const counts = new Map<string, number>();
  for (const c of changes) {
    const label = c.sectionB ?? c.sectionA;
    if (label) counts.set(label, (counts.get(label) ?? 0) + 1);
  }

  return alignments.map((al) => {
    const labelA = al.sectionA ? indexA.path(al.sectionA.id) : null;
    const labelB = al.sectionB ? indexB.path(al.sectionB.id) : null;
    const key = labelB ?? labelA ?? "";
    return {
      status: al.status,
      sectionA: labelA,
      sectionB: labelB,
      pageA: al.sectionA?.startPage ?? null,
      pageB: al.sectionB?.startPage ?? null,
      alignmentConfidence: al.confidence,
      alignmentSignals: Object.fromEntries(
        Object.entries(al.signals).map(([k, v]) => [k, Math.round(v * 1000) / 1000]),
      ),
      changeCount: counts.get(key) ?? 0,
      arbitratedByModel: "arbitration" in al.signals,
    };
  });
}

export { type Entity, type BlockAlignment, type SectionAlignment };
