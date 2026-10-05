/**
 * DOCX -> pages + blocks, by reading word/document.xml directly.
 *
 * Pagination: DOCX is a flow format and does not store where pages break. Word writes
 * `w:lastRenderedPageBreak` hints every time it saves, and an explicit break is stored
 * as `w:br w:type="page"`. Both are honoured. A file produced by a tool that writes
 * neither (python-docx, some Google Docs exports) has no pagination information at all,
 * so the document is marked `paginationApproximate` and the UI cites section only.
 */

import {
  type Block,
  type DocumentModel,
  type Page,
  type Side,
  blockId,
} from "../model";
import { guessBlockType, normalizeText } from "../normalize";

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
/** Only used when the file carries no pagination hints at all. */
const CHARS_PER_PAGE = 2600;

export async function extractDocx(
  data: ArrayBuffer,
  side: Side,
  filename: string,
  sha256: string,
): Promise<DocumentModel> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(data);
  const entry = zip.file("word/document.xml");
  if (!entry) {
    throw new Error("Not a readable Word document: word/document.xml is missing.");
  }
  const xml = await entry.async("string");
  const dom = new DOMParser().parseFromString(xml, "application/xml");
  if (dom.querySelector("parsererror")) {
    throw new Error("Word document XML could not be parsed.");
  }

  const body = dom.getElementsByTagNameNS(W_NS, "body")[0];
  if (!body) throw new Error("Word document has no body.");

  const hasRenderedBreaks = dom.getElementsByTagNameNS(W_NS, "lastRenderedPageBreak").length > 0;
  const hasExplicitBreaks = Array.from(dom.getElementsByTagNameNS(W_NS, "br")).some(
    (br) => br.getAttributeNS(W_NS, "type") === "page",
  );
  const hasPaginationHints = hasRenderedBreaks || hasExplicitBreaks;

  const blocks: Block[] = [];
  const pageText = new Map<number, string[]>([[1, []]]);
  let page = 1;
  let charsOnPage = 0;

  const newPage = (): void => {
    page += 1;
    charsOnPage = 0;
    if (!pageText.has(page)) pageText.set(page, []);
  };

  const record = (text: string): void => {
    pageText.get(page)?.push(text);
    charsOnPage += text.length;
    // Estimation is a last resort, used only when the file tells us nothing.
    if (!hasPaginationHints && charsOnPage > CHARS_PER_PAGE) newPage();
  };

  for (const node of Array.from(body.children)) {
    const tag = node.localName;

    if (tag === "p") {
      // A break before this paragraph's text starts the new page before it is recorded.
      if (startsNewPage(node)) newPage();

      const text = paragraphText(node);
      if (!text) {
        if (endsWithPageBreak(node)) newPage();
        continue;
      }

      blocks.push({
        id: "",
        side,
        page,
        blockIndex: 0,
        blockType: docxBlockType(node, text),
        text,
        normalized: "",
        sectionId: null,
        bbox: null,
        cells: null,
        rowKey: null,
      });
      record(text);
      if (endsWithPageBreak(node)) newPage();
      continue;
    }

    if (tag === "tbl") {
      const rows = tableRows(node);
      if (rows.length === 0) continue;
      const header = rows[0] as string[];

      blocks.push({
        id: "",
        side,
        page,
        blockIndex: 0,
        blockType: "table",
        text: header.join(" | "),
        normalized: "",
        sectionId: null,
        bbox: null,
        cells: header,
        rowKey: null,
      });
      for (const row of rows.slice(1)) {
        blocks.push({
          id: "",
          side,
          page,
          blockIndex: 0,
          blockType: "table_row",
          text: row.join(" | "),
          normalized: "",
          sectionId: null,
          bbox: null,
          cells: row,
          rowKey: normalizeText(row[0] ?? ""),
        });
      }
      record(rows.map((r) => r.join(" ")).join(" "));
    }
  }

  blocks.forEach((b, i) => {
    b.blockIndex = i;
    b.id = blockId(b.page, i);
    b.normalized = normalizeText(b.text);
  });

  const pages: Page[] = [...pageText.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([pageNumber, texts]) => ({
      pageNumber,
      rawText: texts.join("\n"),
      status: texts.length > 0 ? ("extraction_successful" as const) : ("unreadable_page" as const),
      extractionConfidence: texts.length > 0 ? 1 : 0,
      note: null,
      width: null,
      height: null,
    }));

  const warnings: string[] = [];
  if (!hasPaginationHints) {
    warnings.push(
      "This Word file carries no pagination information, so page numbers are estimated. " +
        "Section and clause references are exact. Re-saving the file in Word, or " +
        "comparing a PDF, gives exact pages.",
    );
  }

  return {
    side,
    filename,
    sha256,
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    sizeBytes: data.byteLength,
    pages,
    blocks,
    sections: [],
    extractionVersion: "2.0.0",
    warnings,
    paginationApproximate: !hasPaginationHints,
  };
}

/** Word writes a rendered-break hint inside the first run of the paragraph that follows. */
function startsNewPage(paragraph: Element): boolean {
  const first = paragraph.getElementsByTagNameNS(W_NS, "lastRenderedPageBreak")[0];
  if (!first) return false;
  // Only treat it as a leading break when nothing textual precedes it.
  const runs = Array.from(paragraph.getElementsByTagNameNS(W_NS, "t"));
  if (runs.length === 0) return true;
  const firstText = runs[0] as Element;
  return Boolean(
    first.compareDocumentPosition(firstText) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
}

function endsWithPageBreak(paragraph: Element): boolean {
  return Array.from(paragraph.getElementsByTagNameNS(W_NS, "br")).some(
    (br) => br.getAttributeNS(W_NS, "type") === "page",
  );
}

function paragraphText(paragraph: Element): string {
  const parts: string[] = [];
  for (const t of Array.from(paragraph.getElementsByTagNameNS(W_NS, "t"))) {
    parts.push(t.textContent ?? "");
  }
  for (const _ of Array.from(paragraph.getElementsByTagNameNS(W_NS, "tab"))) {
    // Tabs separate values in simple layouts; keep them as spacing.
    parts.push(" ");
  }
  return parts.join("").replace(/\s+/g, " ").trim();
}

function docxBlockType(paragraph: Element, text: string): Block["blockType"] {
  const style = paragraph
    .getElementsByTagNameNS(W_NS, "pStyle")[0]
    ?.getAttributeNS(W_NS, "val")
    ?.toLowerCase();
  if (style) {
    if (style.startsWith("heading") || style === "title") return "heading";
    if (style.includes("list")) return "list_item";
  }
  if (paragraph.getElementsByTagNameNS(W_NS, "numPr").length > 0) return "list_item";
  return guessBlockType(text);
}

function tableRows(table: Element): string[][] {
  const rows: string[][] = [];
  for (const tr of Array.from(table.getElementsByTagNameNS(W_NS, "tr"))) {
    const cells: string[] = [];
    for (const tc of Array.from(tr.getElementsByTagNameNS(W_NS, "tc"))) {
      const text = Array.from(tc.getElementsByTagNameNS(W_NS, "t"))
        .map((t) => t.textContent ?? "")
        .join("")
        .replace(/\s+/g, " ")
        .trim();
      cells.push(text);
    }
    if (cells.some((c) => c)) rows.push(cells);
  }
  return rows;
}
