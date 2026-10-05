import { describe, expect, it } from "vitest";
import { compareDocuments } from "../compare";
import { extractPlainText } from "../extract";
import type { DocumentModel, Page } from "../model";
import { type OcrPageResult, applyOcrResults, supportsVision } from "../ocr";
import { DEFAULT_LLM_SETTINGS } from "../providers";

/** The real transcript DeepSeek returned for the scanned fixture. */
const TRANSCRIPT = `Acme Website Redesign Proposal

Prepared for Acme Industries Limited
Version 3 — 12 August 2026

3. Pricing

The total project price is NGN 5,000,000 exclusive of applicable taxes.
The price includes design, development, testing and deployment.

4. Delivery

The Supplier shall complete the project within 45 days of the
commencement date. The commencement date is 5 October 2026.

6. Payment Terms

The Client shall pay 50% of the total price upfront on signature.
The Client shall pay invoices within 30 days of receipt.`;

const TRANSCRIPT_B = TRANSCRIPT.replace("NGN 5,000,000", "NGN 6,000,000")
  .replace("within 45 days", "within 60 days")
  .replace("pay 50%", "pay 70%");

function scannedDoc(side: "A" | "B"): DocumentModel {
  const page: Page = {
    pageNumber: 1,
    rawText: "",
    status: "scanned_document",
    extractionConfidence: 0.1,
    note: "image-only page, no text layer",
    width: 595,
    height: 842,
  };
  return {
    side,
    filename: `scan-${side}.pdf`,
    sha256: `sha-${side}`,
    mimeType: "application/pdf",
    sizeBytes: 1000,
    pages: [page],
    blocks: [],
    sections: [],
    extractionVersion: "2.0.0",
    warnings: [
      "Page 1 could not be reliably extracted (scanned_document). Changes on this page may be incomplete.",
    ],
    paginationApproximate: false,
  };
}

function result(text: string, confidence = 0.98): OcrPageResult {
  return { pageNumber: 1, text, confidence, illegible: false, error: null };
}

describe("vision support", () => {
  it("accepts a vision model and refuses a text-only one", () => {
    const base = { ...DEFAULT_LLM_SETTINGS, provider: "deepseek" as const };
    expect(supportsVision({ ...base, model: "deepseek-flash" })).toBe(true);
    expect(supportsVision({ ...base, model: "deepseek-v4-pro" })).toBe(false);
    expect(supportsVision({ ...base, model: "deepseek-chat" })).toBe(false);
  });
});

describe("applying OCR results", () => {
  it("turns a transcript into blocks marked as machine-read", () => {
    const doc = applyOcrResults(scannedDoc("A"), [result(TRANSCRIPT)], "A");
    expect(doc.blocks.length).toBeGreaterThan(5);
    expect(doc.blocks.every((b) => b.ocr === true)).toBe(true);
    expect(doc.blocks.every((b) => b.ocrConfidence === 0.98)).toBe(true);
  });

  it("never fabricates a bounding box", () => {
    // A transcript has no coordinates; a box here would place a citation confidently
    // in the wrong spot.
    const doc = applyOcrResults(scannedDoc("A"), [result(TRANSCRIPT)], "A");
    expect(doc.blocks.every((b) => b.bbox === null)).toBe(true);
  });

  it("gives blocks contiguous, side-neutral ids", () => {
    const doc = applyOcrResults(scannedDoc("A"), [result(TRANSCRIPT)], "A");
    doc.blocks.forEach((b, i) => {
      expect(b.blockIndex).toBe(i);
      expect(b.id).toBe(`p1-b${i}`);
    });
  });

  it("recognises headings in the transcript", () => {
    const doc = applyOcrResults(scannedDoc("A"), [result(TRANSCRIPT)], "A");
    const headings = doc.blocks.filter((b) => b.blockType === "heading").map((b) => b.text);
    expect(headings).toContain("3. Pricing");
    expect(headings).toContain("4. Delivery");
  });

  it("upgrades the page status and replaces the scan warning", () => {
    const doc = applyOcrResults(scannedDoc("A"), [result(TRANSCRIPT)], "A");
    expect(doc.pages[0]?.status).toBe("extraction_successful");
    expect(doc.pages[0]?.extractionConfidence).toBe(0.98);
    expect(doc.warnings.join(" ")).not.toContain("could not be reliably extracted");
    expect(doc.warnings.join(" ")).toContain("read by OCR");
  });

  it("marks a barely-legible page as low confidence", () => {
    const doc = applyOcrResults(scannedDoc("A"), [result(TRANSCRIPT, 0.4)], "A");
    expect(doc.pages[0]?.status).toBe("low_extraction_confidence");
  });

  it("reports a page OCR could not read, and keeps it empty", () => {
    const failed: OcrPageResult = {
      pageNumber: 1,
      text: "",
      confidence: 0,
      illegible: true,
      error: "429 Too Many Requests",
    };
    const doc = applyOcrResults(scannedDoc("A"), [failed], "A");
    expect(doc.blocks).toHaveLength(0);
    expect(doc.warnings.join(" ")).toContain("could not be read by OCR");
  });

  it("keeps OCR blocks after text already extracted from the same page", () => {
    const doc = scannedDoc("A");
    doc.blocks = [
      {
        id: "p1-b0",
        side: "A",
        page: 1,
        blockIndex: 0,
        blockType: "paragraph",
        text: "Existing text layer line.",
        normalized: "existing text layer line.",
        sectionId: null,
        bbox: [10, 10, 100, 20],
        cells: null,
        rowKey: null,
      },
    ];
    const merged = applyOcrResults(doc, [result(TRANSCRIPT)], "A");
    expect(merged.blocks[0]?.text).toBe("Existing text layer line.");
    expect(merged.blocks[0]?.ocr).toBeUndefined();
    expect(merged.blocks[1]?.ocr).toBe(true);
  });
});

describe("comparing OCR'd documents", () => {
  it("finds the value changes a reviewer would compare", async () => {
    const docA = applyOcrResults(scannedDoc("A"), [result(TRANSCRIPT)], "A");
    const docB = applyOcrResults(scannedDoc("B"), [result(TRANSCRIPT_B)], "B");
    const comparison = await compareDocuments(docA, docB, {});

    expect(comparison.status).not.toBe("FAILED");
    const pairs = comparison.changes.map((c) => [c.oldValue?.value, c.newValue?.value]);
    expect(pairs).toContainEqual([5_000_000, 6_000_000]);
    expect(pairs).toContainEqual([45, 60]);
    expect(pairs).toContainEqual([50, 70]);
  });

  it("cites a page but no position on it", async () => {
    const docA = applyOcrResults(scannedDoc("A"), [result(TRANSCRIPT)], "A");
    const docB = applyOcrResults(scannedDoc("B"), [result(TRANSCRIPT_B)], "B");
    const comparison = await compareDocuments(docA, docB, {});

    const priced = comparison.changes.find((c) => c.oldValue?.value === 5_000_000);
    expect(priced?.citationA?.page).toBe(1);
    expect(priced?.citationA?.bbox).toBeNull();
    expect(priced?.citationA?.text).toContain("5,000,000");
  });

  it("reads a plain-text control the same way, so OCR adds no distortion", async () => {
    const control = await compareDocuments(
      extractPlainText(TRANSCRIPT, "A", "a.txt", "sa", 1),
      extractPlainText(TRANSCRIPT_B, "B", "b.txt", "sb", 1),
      {},
    );
    const ocr = await compareDocuments(
      applyOcrResults(scannedDoc("A"), [result(TRANSCRIPT)], "A"),
      applyOcrResults(scannedDoc("B"), [result(TRANSCRIPT_B)], "B"),
      {},
    );
    expect(ocr.changes.length).toBe(control.changes.length);
  });
});
