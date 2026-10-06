/**
 * The fictional contract pair behind the embedded demo.
 *
 * Invented parties, invented figures. The first line of each document says so, because
 * the document panes quote source text verbatim and a visitor should never be left
 * wondering whether they are looking at someone's real agreement.
 *
 * The pair is deliberately separate from `lib/eval/dataset.ts`. That dataset is tuned to
 * be awkward in order to stress the engine; this one is tuned to be legible in order to
 * show the product. Pointing the demo at a test fixture would couple them, and a future
 * change aimed at the evaluation harness would silently reshape the demo.
 */

import type { StoredComparison } from "../store/db";
import { ingestFile, listComparisons, runComparison } from "../workflow";

export const SAMPLE_NAME = "Sample — Harbourline services agreement, v1 to v2";

const BANNER =
  "FICTIONAL SAMPLE DOCUMENT — created to demonstrate VersionLens. " +
  "The parties, figures and terms below are invented.";

const SAMPLE_A = `${BANNER}

Services Agreement

between Harbourline Freight Ltd ("the Client")
and Vesper Analytics Limited ("the Supplier")

1. Definitions

"Services" means the work described in Schedule 1.

2. Insurance

The Supplier shall maintain professional indemnity insurance throughout the term of this Agreement.

3. Liability

The Supplier's total liability under this Agreement shall not exceed £500,000.

Neither party shall be liable for indirect or consequential loss.

4. Payment Terms

The Client shall pay each invoice within 30 days of receipt.

5. Renewal

This Agreement renews automatically for successive periods of twelve months unless either party gives notice.

6. Termination

Either party may terminate this Agreement on 60 days written notice.

7. Governing Law

This Agreement is governed by the laws of England and Wales.

8. Schedule 1 — Implementation

The Supplier shall deliver the implementation within ninety days of the Effective Date.

The implementation fee is £120,000.

9. Schedule 2 — Training

The Supplier shall provide on-site training for up to twelve Client staff.
`;

const SAMPLE_B = `${BANNER}

Services Agreement

between Harbourline Freight Ltd ("the Client")
and Vesper Analytics Limited ("the Supplier")

1. Definitions

"Services" means the work described in Schedule 1.

2. Insurance

The Supplier may maintain professional indemnity insurance where reasonably required.

3. Liability

The Supplier's total liability under this Agreement shall not exceed £250,000.

Neither party shall be liable for indirect or consequential loss.

4. Payment Terms

The Client shall pay each invoice within 45 days of receipt.

5. Renewal

This Agreement renews automatically for successive periods of twenty-four months unless either party gives notice.

6. Termination

Either party may terminate this Agreement on 30 days written notice.

7. Governing Law

This Agreement is governed by the laws of the Republic of Ireland.

8. Schedule 1 — Implementation

The Supplier shall deliver the implementation within one hundred and twenty days of the Effective Date.

The implementation fee is £138,000.

9. Schedule 2 — Data Retention

The Supplier shall retain Client data for seven years after termination.
`;

function sampleFile(name: string, body: string): File {
  return new File([body], name, { type: "text/plain" });
}

/**
 * Put the sample comparison in local storage and return it, reusing one already there.
 *
 * This runs the real pipeline rather than shipping a canned result, so the demo shows
 * genuine output with genuine citations. It needs no model: the deterministic layers
 * carry every change in this pair.
 */
export async function seedSample(): Promise<StoredComparison> {
  const existing = (await listComparisons()).find((c) => c.name === SAMPLE_NAME);
  if (existing?.result) return existing;

  const [a, b] = await Promise.all([
    ingestFile(sampleFile("SAMPLE-harbourline-services-agreement-v1.txt", SAMPLE_A), "A"),
    ingestFile(sampleFile("SAMPLE-harbourline-services-agreement-v2.txt", SAMPLE_B), "B"),
  ]);

  return runComparison(a.id, b.id, {
    name: SAMPLE_NAME,
    documentCategory: "Services agreement",
    notes: "Fictional sample pair, included to demonstrate the review workspace.",
  });
}
