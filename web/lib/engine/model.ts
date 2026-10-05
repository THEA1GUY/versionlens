/**
 * Core document model. Every piece of text keeps its origin so citations never need
 * guessing.
 *
 * Block ids are side-neutral (`p1-b26`, not `A-p1-b26`): an id identifies a position
 * inside one document and which document is carried separately. That lets a stored
 * extraction and a citation produced during a comparison resolve to the same block.
 */

export const ENGINE_VERSION = "2.0.0";
export const EXTRACTION_VERSION = "2.0.0";

export type Side = "A" | "B";

export type BlockType =
  | "heading"
  | "paragraph"
  | "list_item"
  | "table"
  | "table_row"
  | "header"
  | "footer";

export type ExtractionStatus =
  | "extraction_successful"
  | "low_extraction_confidence"
  | "scanned_document"
  | "unreadable_page"
  | "unsupported_content";

/** Page-space rectangle: [x0, top, x1, bottom], in PDF points, top-left origin. */
export type BBox = [number, number, number, number];

export interface Block {
  id: string;
  side: Side;
  page: number;
  blockIndex: number;
  blockType: BlockType;
  /** Raw text — what gets quoted and cited. Never normalised in place. */
  text: string;
  /** Lowercased, punctuation-light form used for matching only. */
  normalized: string;
  sectionId: string | null;
  bbox: BBox | null;
  /** table_row blocks carry their cells so table diffing is structural, not textual. */
  cells: string[] | null;
  rowKey: string | null;
}

export interface Page {
  pageNumber: number;
  rawText: string;
  status: ExtractionStatus;
  extractionConfidence: number;
  note: string | null;
  /** Page box in points, so an overlay can map bbox -> rendered pixels. */
  width: number | null;
  height: number | null;
}

export interface Section {
  id: string;
  side: Side;
  sectionNumber: string | null;
  heading: string;
  normalizedHeading: string;
  orderIndex: number;
  startPage: number;
  endPage: number;
  parentId: string | null;
  level: number;
  blockIds: string[];
}

export interface DocumentModel {
  side: Side;
  filename: string;
  sha256: string;
  mimeType: string;
  sizeBytes: number;
  pages: Page[];
  blocks: Block[];
  sections: Section[];
  extractionVersion: string;
  warnings: string[];
  /** True when pagination is estimated rather than read from the file (DOCX). */
  paginationApproximate: boolean;
}

export interface Citation {
  documentVersion: Side;
  blockId: string;
  page: number;
  section: string;
  charStart: number;
  charEnd: number;
  text: string;
  bbox: BBox | null;
}

/** Human citation label, e.g. "7.1 Payment". */
export function sectionLabel(section: Section): string {
  if (section.sectionNumber) {
    return `${section.sectionNumber} ${section.heading}`.trim();
  }
  return section.heading || "(untitled)";
}

export function blockId(page: number, index: number): string {
  return `p${page}-b${index}`;
}

export class DocumentIndex {
  private readonly blocksById: Map<string, Block>;
  private readonly sectionsById: Map<string, Section>;

  constructor(readonly doc: DocumentModel) {
    this.blocksById = new Map(doc.blocks.map((b) => [b.id, b]));
    this.sectionsById = new Map(doc.sections.map((s) => [s.id, s]));
  }

  block(id: string): Block | undefined {
    return this.blocksById.get(id);
  }

  section(id: string | null): Section | undefined {
    return id === null ? undefined : this.sectionsById.get(id);
  }

  blocksOf(sectionId: string): Block[] {
    const section = this.sectionsById.get(sectionId);
    if (!section) return [];
    const out: Block[] = [];
    for (const id of section.blockIds) {
      const block = this.blocksById.get(id);
      if (block) out.push(block);
    }
    return out;
  }

  /** "5 Payment > 5.2 Late Payment" — what a citation displays. */
  path(sectionId: string | null): string {
    let section = this.section(sectionId);
    if (!section) return "(unsectioned)";
    const parts = [sectionLabel(section)];
    const seen = new Set([section.id]);
    while (section?.parentId && !seen.has(section.parentId)) {
      const parent = this.section(section.parentId);
      if (!parent) break;
      seen.add(parent.id);
      parts.push(sectionLabel(parent));
      section = parent;
    }
    return parts.reverse().join(" > ");
  }

  /** Sections that directly own blocks — the unit alignment operates on. */
  leafSections(): Section[] {
    return this.doc.sections.filter((s) => s.blockIds.length > 0);
  }

  problemPages(): Page[] {
    return this.doc.pages.filter((p) => p.status !== "extraction_successful");
  }
}

export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
