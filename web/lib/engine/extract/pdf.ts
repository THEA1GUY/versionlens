/**
 * PDF -> pages + blocks, with page and bbox provenance retained.
 *
 * Everything runs in the browser: the file is never uploaded. Bounding boxes are kept
 * in PDF user space so the viewer can map them onto a rendered page.
 */

import {
  type BBox,
  type Block,
  type DocumentModel,
  type ExtractionStatus,
  type Page,
  type Side,
  blockId,
} from "../model";
import { guessBlockType, normalizeText, sentenceEnded } from "../normalize";

/** A page with less text than this, in a PDF that draws images, is almost certainly a scan. */
const SCAN_TEXT_THRESHOLD = 40;

interface TextPiece {
  text: string;
  x0: number;
  top: number;
  x1: number;
  bottom: number;
}

type PdfModule = typeof import("pdfjs-dist");
let pdfjsPromise: Promise<PdfModule> | null = null;

/** Loaded lazily and configured for a bundled worker. */
async function loadPdfjs(): Promise<PdfModule> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const pdfjs = await import("pdfjs-dist");
      const workerUrl = new URL(
        "pdfjs-dist/build/pdf.worker.min.mjs",
        import.meta.url,
      ).toString();
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
      return pdfjs;
    })();
  }
  return pdfjsPromise;
}

export async function extractPdf(
  data: ArrayBuffer,
  side: Side,
  filename: string,
  sha256: string,
): Promise<DocumentModel> {
  const pdfjs = await loadPdfjs();
  // pdf.js transfers the buffer, so hand it a copy and keep the caller's intact.
  const doc = await pdfjs.getDocument({ data: data.slice(0) }).promise;

  const pages: Page[] = [];
  const blocks: Block[] = [];

  for (let pageNo = 1; pageNo <= doc.numPages; pageNo++) {
    let page;
    try {
      page = await doc.getPage(pageNo);
    } catch (err) {
      pages.push(blankPage(pageNo, "unreadable_page", `parser error: ${String(err)}`));
      continue;
    }

    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const operators = await page.getOperatorList().catch(() => null);
    const hasImages = operators
      ? operators.fnArray.some(
          (fn: number) =>
            fn === pdfjs.OPS.paintImageXObject ||
            fn === pdfjs.OPS.paintImageXObjectRepeat ||
            fn === pdfjs.OPS.paintInlineImageXObject,
        )
      : false;

    const pieces: TextPiece[] = [];
    for (const item of content.items) {
      if (!("str" in item) || !item.str) continue;
      const tx = item.transform as number[];
      const x = tx[4] ?? 0;
      const yBaseline = tx[5] ?? 0;
      const height = item.height || Math.abs(tx[3] ?? 10) || 10;
      const width = item.width ?? 0;
      // pdf.js reports a bottom-left origin; the rest of the engine uses top-left.
      const top = viewport.height - yBaseline - height;
      pieces.push({
        text: item.str,
        x0: x,
        top,
        x1: x + width,
        bottom: top + height,
      });
    }

    const rawText = pieces.map((p) => p.text).join(" ").replace(/\s+/g, " ").trim();

    if (rawText.length < SCAN_TEXT_THRESHOLD && hasImages) {
      pages.push(
        blankPage(pageNo, "scanned_document", "image-only page, no text layer", viewport),
      );
      continue;
    }
    if (!rawText) {
      pages.push(blankPage(pageNo, "unreadable_page", "no extractable text", viewport));
      continue;
    }

    const confident = rawText.length >= SCAN_TEXT_THRESHOLD;
    pages.push({
      pageNumber: pageNo,
      rawText,
      status: confident ? "extraction_successful" : "low_extraction_confidence",
      extractionConfidence: confident ? 1 : 0.5,
      note: null,
      width: viewport.width,
      height: viewport.height,
    });

    for (const line of groupIntoLines(pieces)) {
      blocks.push({
        id: "",
        side,
        page: pageNo,
        blockIndex: 0,
        blockType: guessBlockType(line.text),
        text: line.text,
        normalized: "",
        sectionId: null,
        bbox: line.bbox,
        cells: null,
        rowKey: null,
      });
    }
  }

  const merged = mergeParagraphLines(blocks);
  merged.forEach((b, i) => {
    b.blockIndex = i;
    b.id = blockId(b.page, i);
    b.normalized = normalizeText(b.text);
  });

  const warnings = pages
    .filter((p) => p.status === "scanned_document" || p.status === "unreadable_page")
    .map(
      (p) =>
        `Page ${p.pageNumber} could not be reliably extracted (${p.status}). ` +
        "Changes on this page may be incomplete.",
    );

  return {
    side,
    filename,
    sha256,
    mimeType: "application/pdf",
    sizeBytes: data.byteLength,
    pages,
    blocks: merged,
    sections: [],
    extractionVersion: "2.0.0",
    warnings,
    paginationApproximate: false,
  };
}

function blankPage(
  pageNumber: number,
  status: ExtractionStatus,
  note: string,
  viewport?: { width: number; height: number },
): Page {
  return {
    pageNumber,
    rawText: "",
    status,
    extractionConfidence: status === "scanned_document" ? 0.1 : 0,
    note,
    width: viewport?.width ?? null,
    height: viewport?.height ?? null,
  };
}

/** Cluster text pieces into visual lines by their vertical midpoint. */
function groupIntoLines(pieces: TextPiece[]): Array<{ text: string; bbox: BBox }> {
  const rows = new Map<number, TextPiece[]>();
  for (const p of pieces) {
    if (!p.text.trim()) continue;
    const key = Math.round((p.top + p.bottom) / 2 / 3);
    const list = rows.get(key);
    if (list) list.push(p);
    else rows.set(key, [p]);
  }

  const out: Array<{ text: string; bbox: BBox }> = [];
  for (const key of [...rows.keys()].sort((a, b) => a - b)) {
    const row = (rows.get(key) as TextPiece[]).sort((a, b) => a.x0 - b.x0);
    const text = row.map((p) => p.text).join(" ").replace(/\s+/g, " ").trim();
    if (!text) continue;
    out.push({
      text,
      bbox: [
        Math.min(...row.map((p) => p.x0)),
        Math.min(...row.map((p) => p.top)),
        Math.max(...row.map((p) => p.x1)),
        Math.max(...row.map((p) => p.bottom)),
      ],
    });
  }
  return out;
}

/** PDF lines are layout artifacts; merge consecutive body lines back into paragraphs. */
function mergeParagraphLines(blocks: Block[]): Block[] {
  const merged: Block[] = [];
  for (const b of blocks) {
    const prev = merged[merged.length - 1];
    const joinable =
      prev !== undefined &&
      prev.blockType === "paragraph" &&
      b.blockType === "paragraph" &&
      prev.page === b.page &&
      !sentenceEnded(prev.text);

    if (joinable && prev) {
      prev.text = joinHyphenated(prev.text, b.text);
      if (prev.bbox && b.bbox) {
        prev.bbox = [
          Math.min(prev.bbox[0], b.bbox[0]),
          Math.min(prev.bbox[1], b.bbox[1]),
          Math.max(prev.bbox[2], b.bbox[2]),
          Math.max(prev.bbox[3], b.bbox[3]),
        ];
      }
      continue;
    }
    merged.push(b);
  }
  return merged;
}

function joinHyphenated(left: string, right: string): string {
  if (left.trimEnd().endsWith("-")) {
    return left.trimEnd().slice(0, -1) + right.trimStart();
  }
  return `${left.trimEnd()} ${right.trimStart()}`;
}

/** Re-exported so the viewer can render pages from the same loader. */
export { loadPdfjs };
