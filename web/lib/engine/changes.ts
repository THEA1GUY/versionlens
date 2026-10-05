/** Canonical change object plus the category / importance vocabulary. */

import type { Citation } from "./model";

export type ChangeType =
  | "ADDED"
  | "REMOVED"
  | "MODIFIED"
  | "MEANING_CHANGED"
  | "MOVED"
  | "SECTION_ADDED"
  | "SECTION_REMOVED"
  | "SECTION_RENAMED";

export type Category =
  | "PRICING"
  | "PAYMENT_TERMS"
  | "SCOPE"
  | "DATES"
  | "DURATION"
  | "OBLIGATIONS"
  | "RIGHTS"
  | "RESPONSIBILITIES"
  | "TERMINATION"
  | "LIABILITY"
  | "RENEWAL"
  | "CONFIDENTIALITY"
  | "GOVERNING_TERMS"
  | "WORDING"
  | "FORMATTING";

export type Importance = "HIGH" | "MEDIUM" | "LOW";

export type ReviewStatus =
  | "unreviewed"
  | "confirmed"
  | "false_alert"
  | "needs_discussion"
  | "resolved";

export type Detector =
  | "text_diff"
  | "structured_extraction"
  | "semantic_analysis"
  | "section_alignment";

export interface ChangeValue {
  value: number | string | null;
  unit?: string | null;
  currency?: string | null;
  sourceText?: string | null;
  kind?: string | null;
  context?: string | null;
  actor?: string | null;
  action?: string | null;
  strength?: number | null;
  frequency?: string | null;
  daysEquivalent?: number | null;
}

export interface ChangeDelta {
  absolute?: number | null;
  percentage?: number | null;
  percentagePoints?: number | null;
  days?: number | null;
  strengthChange?: number | null;
  unit?: string | null;
}

export interface DiffOp {
  op: "equal" | "insert" | "delete" | "replace";
  a: string;
  b: string;
}

export interface ReviewerNote {
  author: string | null;
  body: string;
  createdAt: string;
}

export interface Change {
  id: string;
  type: ChangeType;
  category: Category;
  categories: Category[];
  summary: string;
  importance: Importance;
  importanceScore: number;
  confidence: number;
  confidenceLabel: string;
  confidenceSignals: Record<string, number>;
  oldValue: ChangeValue | null;
  newValue: ChangeValue | null;
  delta: ChangeDelta | null;
  direction: string | null;
  citationA: Citation | null;
  citationB: Citation | null;
  textA: string;
  textB: string;
  wordDiff: DiffOp[];
  detectors: Detector[];
  sectionA: string | null;
  sectionB: string | null;
  notes: string[];
  reviewStatus: ReviewStatus;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewerNotes: ReviewerNote[];
}

/** Rule-based importance, surfaced to users as "review priority", never "legal risk". */
export const CATEGORY_WEIGHT: Record<Category, number> = {
  PRICING: 4,
  PAYMENT_TERMS: 4,
  TERMINATION: 4,
  LIABILITY: 4,
  SCOPE: 3,
  DATES: 3,
  DURATION: 3,
  OBLIGATIONS: 3,
  RESPONSIBILITIES: 3,
  RIGHTS: 3,
  RENEWAL: 3,
  CONFIDENTIALITY: 3,
  GOVERNING_TERMS: 3,
  WORDING: 1,
  FORMATTING: 0,
};

/** Order matters: the first match becomes the primary category. */
export const CATEGORY_KEYWORDS: Array<[Category, string[]]> = [
  ["PRICING", ["price", "pricing", "fee", "fees", "cost", "charge", "rate card",
    "discount", "commission", "deposit", "tax", "vat", "penalty",
    "total contract value", "consideration"]],
  ["PAYMENT_TERMS", ["payment", "invoice", "invoices", "payable", "paid", "upfront",
    "instalment", "installment", "milestone payment", "remit", "interest on late"]],
  ["TERMINATION", ["terminate", "termination", "cancel", "cancellation", "notice period",
    "breach", "wind down", "exit"]],
  ["LIABILITY", ["liability", "liable", "indemnif", "damages", "warrant", "guarantee",
    "force majeure", "cap on"]],
  ["CONFIDENTIALITY", ["confidential", "non-disclosure", "nda", "proprietary information",
    "data protection", "personal data", "gdpr", "privacy", "data processing"]],
  ["RENEWAL", ["renew", "renewal", "extension", "auto-renew", "evergreen"]],
  ["GOVERNING_TERMS", ["governing law", "jurisdiction", "arbitration", "dispute resolution",
    "venue", "applicable law"]],
  ["SCOPE", ["scope", "deliverable", "deliverables", "service", "services", "training",
    "support", "maintenance", "exclusion", "excluded", "included", "workshop",
    "report", "reporting", "sla"]],
  ["DATES", ["date", "deadline", "commence", "effective", "expiry", "expire", "go-live",
    "milestone", "schedule"]],
  ["RESPONSIBILITIES", ["responsible", "responsibilit", "accountable", "owner", "assign",
    "delegate", "duties", "point of contact"]],
];

/** Tag by subject matter. Returns [] so callers can apply their own fallback. */
export function categorizeText(...texts: Array<string | null | undefined>): Category[] {
  const blob = texts.filter(Boolean).join(" ").toLowerCase();
  if (!blob) return [];
  const hits: Category[] = [];
  for (const [category, keywords] of CATEGORY_KEYWORDS) {
    if (keywords.some((kw) => blob.includes(kw))) hits.push(category);
  }
  return hits;
}

export function mergeCategories(primary: Category[], extra: Category[]): Category[] {
  const out = [...primary];
  for (const c of extra) if (!out.includes(c)) out.push(c);
  return out.length > 0 ? out : ["WORDING"];
}

export const CATEGORY_LABEL: Record<Category, string> = {
  PRICING: "Pricing",
  PAYMENT_TERMS: "Payment",
  SCOPE: "Scope",
  DATES: "Dates",
  DURATION: "Duration",
  OBLIGATIONS: "Obligations",
  RIGHTS: "Rights",
  RESPONSIBILITIES: "Responsibilities",
  TERMINATION: "Termination",
  LIABILITY: "Liability",
  RENEWAL: "Renewal",
  CONFIDENTIALITY: "Confidentiality",
  GOVERNING_TERMS: "Governing terms",
  WORDING: "Wording",
  FORMATTING: "Formatting",
};

export const TYPE_LABEL: Record<ChangeType, string> = {
  ADDED: "Added",
  REMOVED: "Removed",
  MODIFIED: "Modified",
  MEANING_CHANGED: "Meaning changed",
  MOVED: "Moved",
  SECTION_ADDED: "Section added",
  SECTION_REMOVED: "Section removed",
  SECTION_RENAMED: "Section renamed",
};

/** Text label, not colour alone — the UI must work without colour perception. */
export const TYPE_MARK: Record<ChangeType, string> = {
  ADDED: "+",
  REMOVED: "−",
  MODIFIED: "±",
  MEANING_CHANGED: "!",
  MOVED: "→",
  SECTION_ADDED: "+",
  SECTION_REMOVED: "−",
  SECTION_RENAMED: "~",
};

export const REVIEW_LABEL: Record<ReviewStatus, string> = {
  unreviewed: "Unreviewed",
  confirmed: "Confirmed",
  false_alert: "False alert",
  needs_discussion: "Needs discussion",
  resolved: "Resolved",
};

export const IMPORTANCE_LABEL: Record<Importance, string> = {
  HIGH: "High attention",
  MEDIUM: "Medium attention",
  LOW: "Minor",
};

export const DETECTOR_LABEL: Record<Detector, string> = {
  text_diff: "Text difference",
  structured_extraction: "Structured value comparison",
  semantic_analysis: "Semantic analysis",
  section_alignment: "Section alignment",
};
