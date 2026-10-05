import type { Change, ChangeValue, Importance, ReviewStatus } from "./types";

const CURRENCY_GLYPH: Record<string, string> = {
  NGN: "₦",
  USD: "$",
  GBP: "£",
  EUR: "€",
  JPY: "¥",
};

export function formatValue(value: ChangeValue | null): string {
  if (!value) return "—";
  if (value.source_text) return value.source_text;
  if (value.value === null || value.value === undefined) return "—";
  if (typeof value.value === "number") {
    const glyph = value.currency ? CURRENCY_GLYPH[value.currency] : undefined;
    const body = value.value.toLocaleString(undefined, { maximumFractionDigits: 2 });
    if (glyph) return `${glyph}${body}`;
    if (value.unit === "percent") return `${body}%`;
    if (value.unit && value.unit !== "text") return `${body} ${value.unit}`;
    return body;
  }
  return String(value.value);
}

/** The compact "X → Y" line shown on a change card. Empty when there is no value pair. */
export function valuePair(change: Change): string | null {
  const before = formatValue(change.old_value);
  const after = formatValue(change.new_value);
  if (before === "—" && after === "—") return null;
  if (change.old_value?.unit === "text" || change.new_value?.unit === "text") return null;
  if (change.old_value?.unit === "section" || change.new_value?.unit === "section") return null;
  if (before === "—") return `added: ${after}`;
  if (after === "—") return `removed: ${before}`;
  return `${before} → ${after}`;
}

export function formatDelta(change: Change): string[] {
  const delta = change.delta;
  if (!delta) return [];
  const out: string[] = [];
  const signed = (n: number, digits = 2) =>
    `${n > 0 ? "+" : ""}${n.toLocaleString(undefined, { maximumFractionDigits: digits })}`;

  if (delta.absolute !== null && delta.absolute !== undefined) {
    const glyph = delta.unit ? (CURRENCY_GLYPH[delta.unit] ?? "") : "";
    out.push(`${delta.absolute > 0 ? "+" : "−"}${glyph}${Math.abs(delta.absolute).toLocaleString()}`);
  }
  if (delta.percentage !== null && delta.percentage !== undefined) {
    out.push(`${signed(delta.percentage)}%`);
  }
  if (delta.percentage_points !== null && delta.percentage_points !== undefined) {
    out.push(`${signed(delta.percentage_points)} percentage points`);
  }
  if (delta.days !== null && delta.days !== undefined) {
    out.push(`${signed(delta.days, 0)} days`);
  }
  if (delta.strength_change !== null && delta.strength_change !== undefined) {
    out.push(delta.strength_change < 0 ? "weaker wording" : "stronger wording");
  }
  return out;
}

export const CATEGORY_LABEL: Record<string, string> = {
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

export const TYPE_LABEL: Record<string, string> = {
  ADDED: "Added",
  REMOVED: "Removed",
  MODIFIED: "Modified",
  MEANING_CHANGED: "Meaning changed",
  MOVED: "Moved",
  SECTION_ADDED: "Section added",
  SECTION_REMOVED: "Section removed",
  SECTION_RENAMED: "Section renamed",
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

/** Text label, not colour alone — the UI must work without colour perception (PDD §12). */
export const TYPE_MARK: Record<string, string> = {
  ADDED: "+",
  REMOVED: "−",
  MODIFIED: "±",
  MEANING_CHANGED: "!",
  MOVED: "→",
  SECTION_ADDED: "+",
  SECTION_REMOVED: "−",
  SECTION_RENAMED: "~",
};

export function categoryLabel(value: string): string {
  return CATEGORY_LABEL[value] ?? value;
}

export function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function citationLabel(section: string | null, page: number | null): string {
  const parts: string[] = [];
  if (section) parts.push(shortSection(section));
  if (page !== null && page !== undefined) parts.push(`Page ${page}`);
  return parts.join(" · ") || "—";
}

/** Section paths can be deep; show the leaf plus one ancestor. */
export function shortSection(path: string): string {
  const parts = path.split(" > ");
  if (parts.length <= 2) return path;
  return `… > ${parts.slice(-2).join(" > ")}`;
}
