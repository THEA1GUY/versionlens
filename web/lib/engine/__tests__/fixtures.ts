/**
 * The controlled demo pair, as plain text so the engine can be exercised without
 * browser file APIs. Mirrors the Python engine's fixture: the same renames, renumbering,
 * value edits, obligation weakening, and added/removed sections.
 */

export const VERSION_A = `Acme Website Redesign Proposal

Prepared for Acme Industries Limited

Version 3 — 12 August 2026

1. Introduction

This proposal sets out the terms on which Northwind Digital Limited (the Supplier) will deliver a website redesign for Acme Industries Limited (the Client).

2. Project Scope

The Supplier shall deliver a full redesign of the Client's public website, including information architecture, visual design and front-end implementation.

The Supplier shall provide on-site training for up to twelve Client staff.

The Supplier shall provide security monitoring.

The Supplier shall migrate all existing content from the current platform.

3. Pricing

The total project price is ₦5,000,000 exclusive of applicable taxes.

The price includes design, development, testing and deployment.

4. Delivery

The Supplier shall complete the project within 45 days of the commencement date.

The commencement date is 5 October 2026.

5. Support

The Supplier shall provide support and maintenance for 12 months following launch.

Support requests shall be acknowledged within 8 hours.

6. Payment Terms

The Client shall pay 50% of the total price upfront on signature of this proposal.

The Client shall pay invoices within 30 days of receipt.

Late payment shall attract interest at 2% per month.

7. Responsibilities

The Client shall nominate a single point of contact for the duration of the project.

The Client shall provide brand assets within five days of the commencement date.

8. Confidentiality

Each party shall keep the other party's confidential information confidential for three years following termination of this agreement.

9. Exclusivity

The Supplier shall not provide website redesign services to any direct competitor of the Client for twelve months following launch.

10. Termination

Either party may terminate this agreement by giving 14 days written notice.

The Client shall pay for all work completed up to the termination date.

11. Governing Law

This agreement is governed by the laws of the Federal Republic of Nigeria.
`;

export const VERSION_B = `Acme Website Redesign Proposal

Prepared for Acme Industries Limited

Version 4 — 2 September 2026

1. Introduction

This proposal sets out the terms on which Northwind Digital Limited (the Supplier) will deliver a website redesign for Acme Industries Limited (the Client).

2. Scope of Services

The Supplier shall deliver a full redesign of the Client's public website, including information architecture, visual design and front-end implementation.

The Supplier may provide security monitoring when requested.

The Supplier shall migrate all existing content from the current platform.

The Supplier shall provide monthly analytics reporting to the Client.

3. Commercial Terms

The total project price is ₦6,000,000 exclusive of applicable taxes.

The price includes design, development, testing and deployment.

4. Timeline

The Supplier shall complete the project within 60 days of the commencement date.

The commencement date is 12 October 2026.

5. Support

The Supplier shall provide support and maintenance for 6 months following launch.

Support requests shall be acknowledged within 8 hours.

6. Payment

The Client shall pay 70% of the total price upfront on signature of this proposal.

The Client shall pay invoices within 60 days of receipt.

Late payment shall attract interest at 2% per month.

7. Responsibilities

The Client shall nominate a single point of contact for the duration of the project.

The Client shall provide brand assets within five days of the commencement date.

The Client must provide weekly access reports to the Supplier.

8. Confidentiality

Each party shall keep the other party's confidential information confidential for three years following termination of this agreement.

9. Termination

Either party may terminate this agreement by giving 30 days written notice.

The Client shall pay for all work completed up to the termination date.

10. Governing Law

This agreement is governed by the laws of the Federal Republic of Nigeria.

11. Data Protection

The Supplier shall process personal data only on the documented instructions of the Client and shall delete all personal data within 30 days of termination.
`;

export interface GroundTruthRecord {
  id: string;
  category: string;
  importance: "HIGH" | "MEDIUM" | "LOW";
  note: string;
  /** Every marker must appear somewhere in the serialised comparison. */
  match: string[];
  /** Optional exact value expectations. */
  expect?: { old?: number | string; new?: number | string; absolute?: number; percentage?: number; days?: number };
}

export const GROUND_TRUTH: GroundTruthRecord[] = [
  { id: "TEST-001", category: "PRICING", importance: "HIGH", note: "Total price ₦5,000,000 -> ₦6,000,000",
    match: ["5,000,000", "6,000,000"], expect: { old: 5_000_000, new: 6_000_000, absolute: 1_000_000, percentage: 20 } },
  { id: "TEST-002", category: "DURATION", importance: "HIGH", note: "Delivery 45 -> 60 days",
    match: ["45 days", "60 days"], expect: { old: 45, new: 60 } },
  { id: "TEST-003", category: "SCOPE", importance: "HIGH", note: "On-site training removed",
    match: ["on-site training"] },
  { id: "TEST-004", category: "DURATION", importance: "HIGH", note: "Support 12 -> 6 months",
    match: ["12 months", "6 months"], expect: { old: 12, new: 6 } },
  { id: "TEST-005", category: "PAYMENT_TERMS", importance: "HIGH", note: "Upfront 50% -> 70%",
    match: ["50%", "70%"], expect: { old: 50, new: 70 } },
  { id: "TEST-006", category: "TERMINATION", importance: "HIGH", note: "Notice 14 -> 30 days",
    match: ["14 days", "30 days"], expect: { old: 14, new: 30 } },
  { id: "TEST-007", category: "PAYMENT_TERMS", importance: "HIGH", note: "Invoice period 30 -> 60 days",
    match: ["within 30 days", "within 60 days"] },
  { id: "TEST-008", category: "OBLIGATIONS", importance: "HIGH", note: "Security monitoring shall -> may",
    match: ["security monitoring"] },
  { id: "TEST-009", category: "SCOPE", importance: "MEDIUM", note: "Monthly analytics reporting added",
    match: ["analytics reporting"] },
  { id: "TEST-010", category: "RESPONSIBILITIES", importance: "MEDIUM", note: "New weekly access reports obligation",
    match: ["weekly access reports"] },
  { id: "TEST-011", category: "SCOPE", importance: "HIGH", note: "Exclusivity section removed",
    match: ["Exclusivity"] },
  { id: "TEST-012", category: "CONFIDENTIALITY", importance: "MEDIUM", note: "Data Protection section added",
    match: ["Data Protection"] },
  { id: "TEST-013", category: "DATES", importance: "MEDIUM", note: "Commencement date moved 7 days later",
    match: ["5 October 2026", "12 October 2026"], expect: { days: 7 } },
  { id: "TEST-017", category: "DATES", importance: "LOW", note: "Cover date 12 August -> 2 September",
    match: ["12 August 2026", "2 September 2026"] },
];
