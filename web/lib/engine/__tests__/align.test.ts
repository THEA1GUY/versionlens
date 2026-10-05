import { describe, expect, it } from "vitest";
import { TermWeights, blockSimilarity, contentTerms, headingSimilarity } from "../align";
import type { Block } from "../model";
import { normalizeText } from "../normalize";

function blk(text: string, id = "p1-b0"): Block {
  return {
    id,
    side: "A",
    page: 1,
    blockIndex: 0,
    blockType: "paragraph",
    text,
    normalized: normalizeText(text),
    sectionId: null,
    bbox: null,
    cells: null,
    rowKey: null,
  };
}

const CORPUS = [
  "Supplier shall maintain insurance throughout the agreement.",
  "Supplier may maintain appropriate insurance where reasonably required.",
  "The Supplier shall provide on-site training for up to twelve Client staff.",
  "The Supplier shall provide monthly analytics reporting to the Client.",
  "The Client shall pay invoices within 30 days of receipt.",
  "The Client shall pay invoices within 60 days of receipt.",
  "The Client shall nominate a single point of contact for the project.",
  "The Supplier shall migrate all existing content from the current platform.",
];

const weights = new TermWeights(CORPUS.map((t, i) => blk(t, `p1-b${i}`)));

describe("content terms", () => {
  it("drops stopwords and numbers, and stems", () => {
    const terms = contentTerms(normalizeText("The Supplier shall provide 30 monthly reports"));
    expect(terms).not.toContain("the");
    expect(terms).not.toContain("shall");
    expect(terms).not.toContain("30");
    expect(terms).toContain("supplier");
    // "reports" and "reporting" both stem toward a shared root.
    expect(terms.some((t) => t.startsWith("report"))).toBe(true);
  });
});

describe("block similarity", () => {
  it("pairs a heavily rewritten clause", () => {
    // The headline example: almost every word differs, but it is the same clause.
    const sim = blockSimilarity(blk(CORPUS[0]!), blk(CORPUS[1]!, "p1-b1"), weights);
    expect(sim).toBeGreaterThanOrEqual(0.5);
  });

  it("refuses two different clauses that share a boilerplate opening", () => {
    // Regression: "The Supplier shall provide" made a removed training clause and an
    // added analytics clause collapse into one bogus wording change.
    const sim = blockSimilarity(blk(CORPUS[2]!), blk(CORPUS[3]!, "p1-b3"), weights);
    expect(sim).toBeLessThan(0.5);
  });

  it("scores a rewrite above an unrelated pair", () => {
    const rewrite = blockSimilarity(blk(CORPUS[0]!), blk(CORPUS[1]!, "p1-b1"), weights);
    const unrelated = blockSimilarity(blk(CORPUS[2]!), blk(CORPUS[3]!, "p1-b3"), weights);
    expect(rewrite).toBeGreaterThan(unrelated);
  });

  it("scores a value-only edit near the top", () => {
    const sim = blockSimilarity(blk(CORPUS[4]!), blk(CORPUS[5]!, "p1-b5"), weights);
    expect(sim).toBeGreaterThan(0.9);
  });

  it("is symmetric", () => {
    const a = blockSimilarity(blk(CORPUS[0]!), blk(CORPUS[1]!, "x"), weights);
    const b = blockSimilarity(blk(CORPUS[1]!), blk(CORPUS[0]!, "x"), weights);
    expect(a).toBeCloseTo(b, 10);
  });
});

describe("heading similarity", () => {
  it.each([
    ["project scope", "scope of services"],
    ["pricing", "commercial terms"],
    ["delivery", "timeline"],
    ["payment terms", "payment"],
  ])("recognises %s as %s", (a, b) => {
    expect(headingSimilarity(a, b)).toBeGreaterThanOrEqual(0.6);
  });

  it("keeps unrelated headings apart", () => {
    expect(headingSimilarity("confidentiality", "pricing")).toBeLessThan(0.5);
  });

  it("scores identical headings at 1", () => {
    expect(headingSimilarity("payment", "payment")).toBe(1);
  });
});
