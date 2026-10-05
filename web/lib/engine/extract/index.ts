/** Format dispatch for extraction. Everything runs in the browser. */

import {
  type Block,
  type DocumentModel,
  type Page,
  type Side,
  blockId,
  sha256Hex,
} from "../model";
import { guessBlockType, normalizeText, stripRepeatedRunners } from "../normalize";
import { extractDocx } from "./docx";
import { extractPdf } from "./pdf";

export const SUPPORTED_EXTENSIONS = [".pdf", ".docx", ".txt", ".md"] as const;

export function isSupported(filename: string): boolean {
  const lower = filename.toLowerCase();
  return SUPPORTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export class UnsupportedFormatError extends Error {
  constructor(filename: string) {
    super(
      `Unsupported file type: ${filename}. Supported formats are ` +
        `${SUPPORTED_EXTENSIONS.join(", ")}.`,
    );
    this.name = "UnsupportedFormatError";
  }
}

export async function extractFile(file: File, side: Side): Promise<DocumentModel> {
  const data = await file.arrayBuffer();
  const sha256 = await sha256Hex(data);
  const name = file.name.toLowerCase();

  let doc: DocumentModel;
  if (name.endsWith(".pdf")) {
    doc = await extractPdf(data, side, file.name, sha256);
  } else if (name.endsWith(".docx")) {
    doc = await extractDocx(data, side, file.name, sha256);
  } else if (name.endsWith(".txt") || name.endsWith(".md")) {
    doc = extractPlainText(new TextDecoder().decode(data), side, file.name, sha256, data.byteLength);
  } else {
    throw new UnsupportedFormatError(file.name);
  }

  // Running headers and footers repeat on most pages and carry no signal; dropping them
  // here keeps every extractor consistent.
  const kept = stripRepeatedRunners(doc.blocks);
  if (kept.length !== doc.blocks.length) {
    kept.forEach((b, i) => {
      b.blockIndex = i;
      b.id = blockId(b.page, i);
    });
    doc.blocks = kept;
  }
  return doc;
}

export function extractPlainText(
  raw: string,
  side: Side,
  filename: string,
  sha256: string,
  sizeBytes: number,
): DocumentModel {
  const chunks = raw.includes("\f") ? raw.split("\f") : [raw];
  const pages: Page[] = [];
  const blocks: Block[] = [];

  chunks.forEach((chunk, i) => {
    const pageNumber = i + 1;
    pages.push({
      pageNumber,
      rawText: chunk,
      status: "extraction_successful",
      extractionConfidence: 1,
      note: null,
      width: null,
      height: null,
    });
    for (const para of chunk.split(/\n\s*\n/)) {
      const text = para.split(/\s+/).filter(Boolean).join(" ");
      if (!text) continue;
      blocks.push({
        id: blockId(pageNumber, blocks.length),
        side,
        page: pageNumber,
        blockIndex: blocks.length,
        blockType: guessBlockType(text),
        text,
        normalized: normalizeText(text),
        sectionId: null,
        bbox: null,
        cells: null,
        rowKey: null,
      });
    }
  });

  return {
    side,
    filename,
    sha256,
    mimeType: "text/plain",
    sizeBytes,
    pages,
    blocks,
    sections: [],
    extractionVersion: "2.0.0",
    warnings: [],
    paginationApproximate: !raw.includes("\f"),
  };
}

export { extractDocx, extractPdf };
