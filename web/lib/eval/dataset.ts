/**
 * Labelled evaluation pairs beyond the friendly demo.
 *
 * These are written to be awkward on purpose, targeting the places the engine is
 * weakest: repeated near-identical headings (where assignment can mis-pair), clauses
 * rewritten so heavily that lexical similarity alone cannot pair them, numbers spelled
 * out, and a clause that moved rather than changed.
 *
 * They are still synthetic. Real reviewed contract pairs belong here too, and until some
 * are added the numbers this harness reports describe the pipeline, not the product.
 */

import type { GroundTruth } from "./score";

interface Pair {
  name: string;
  a: string;
  b: string;
  truth: GroundTruth[];
}

/* ------------------------------------------------- services agreement, awkward ------ */

const SERVICES_A = `Master Services Agreement

1. Definitions

"Services" means the work described in the applicable Schedule.

2. Insurance

Supplier shall maintain insurance throughout the term of this Agreement.

3. Liability

The Supplier's total liability under this Agreement shall not exceed £500,000.

Neither party shall be liable for indirect or consequential loss.

4. Renewal

This Agreement renews automatically for successive periods of twelve months unless either party gives notice.

5. Governing Law

This Agreement is governed by the laws of England and Wales.

6. Schedule 1 — Implementation

The Supplier shall deliver the implementation within ninety days of the Effective Date.

The implementation fee is £120,000.

7. Schedule 2 — Hosting

The Supplier shall provide hosting with an availability target of 99.5%.

The annual hosting fee is £48,000.

8. Schedule 3 — Support

The Supplier shall provide support during business hours.

The annual support fee is £36,000.

9. Data Ownership

All Client data remains the property of the Client.
`;

const SERVICES_B = `Master Services Agreement

1. Definitions

"Services" means the work described in the applicable Schedule.

2. Data Ownership

All Client data remains the property of the Client.

3. Insurance

Supplier may maintain appropriate insurance where reasonably required.

4. Liability

The Supplier's total liability under this Agreement shall not exceed £250,000.

Neither party shall be liable for indirect or consequential loss.

5. Renewal

This Agreement renews automatically for successive periods of twenty-four months unless either party gives notice.

6. Governing Law

This Agreement is governed by the laws of the Republic of Ireland.

7. Schedule 1 — Implementation

The Supplier shall deliver the implementation within one hundred and twenty days of the Effective Date.

The implementation fee is £150,000.

8. Schedule 2 — Hosting

The Supplier shall provide hosting with an availability target of 99.9%.

The annual hosting fee is £48,000.

9. Schedule 3 — Support

The Supplier shall provide support during business hours.

The annual support fee is £42,000.
`;

const SERVICES_TRUTH: GroundTruth[] = [
  {
    id: "SVC-001",
    category: "LIABILITY",
    importance: "CRITICAL",
    note: "Liability cap halved, £500,000 -> £250,000",
    match: ["500,000", "250,000"],
    expect: { old: 500_000, new: 250_000, absolute: -250_000, percentage: -50 },
  },
  {
    id: "SVC-002",
    category: "OBLIGATIONS",
    importance: "HIGH",
    note: "Insurance obligation rewritten from mandatory to permissive",
    match: ["insurance"],
  },
  {
    id: "SVC-003",
    category: "RENEWAL",
    importance: "HIGH",
    note: "Auto-renewal term doubled, twelve -> twenty-four months (spelled out)",
    match: ["twelve months", "twenty-four months"],
    expect: { old: 12, new: 24 },
  },
  {
    id: "SVC-004",
    category: "GOVERNING_TERMS",
    importance: "HIGH",
    note:
      "Governing law moved from England and Wales to Republic of Ireland. Reported as a " +
      "removal plus an addition: the two clauses share only boilerplate, so pairing them " +
      "would be a guess.",
    match: ["England and Wales", "Republic of Ireland"],
    matchMode: "split",
  },
  {
    id: "SVC-005",
    category: "DURATION",
    importance: "HIGH",
    note: "Schedule 1 implementation ninety -> one hundred and twenty days (spelled out)",
    match: ["ninety days", "one hundred and twenty days"],
    expect: { old: 90, new: 120 },
  },
  {
    id: "SVC-006",
    category: "PRICING",
    importance: "HIGH",
    note: "Schedule 1 implementation fee £120,000 -> £150,000",
    match: ["120,000", "150,000"],
    expect: { old: 120_000, new: 150_000, absolute: 30_000, percentage: 25 },
  },
  {
    id: "SVC-007",
    category: "PRICING",
    importance: "MEDIUM",
    note: "Schedule 3 support fee £36,000 -> £42,000 — must not be confused with Schedule 2",
    match: ["36,000", "42,000"],
    expect: { old: 36_000, new: 42_000 },
  },
  {
    id: "SVC-008",
    category: "SCOPE",
    importance: "MEDIUM",
    note: "Hosting availability target 99.5% -> 99.9%",
    match: ["99.5", "99.9"],
    expect: { old: 99.5, new: 99.9 },
  },
];

export const DATASET: Pair[] = [
  { name: "services-agreement", a: SERVICES_A, b: SERVICES_B, truth: SERVICES_TRUTH },
];
