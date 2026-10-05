import type { Change, ChangeValue } from "./engine/changes";

const CURRENCY_GLYPH: Record<string, string> = {
  NGN: "₦", USD: "$", GBP: "£", EUR: "€", JPY: "¥",
};

export function formatValue(value: ChangeValue | null | undefined): string {
  if (!value) return "—";
  if (value.sourceText) return value.sourceText;
  if (value.value === null || value.value === undefined) return "—";
  if (typeof value.value === "number") {
    const glyph = value.currency ? CURRENCY_GLYPH[value.currency] : undefined;
    const body = value.value.toLocaleString(undefined, { maximumFractionDigits: 2 });
    if (glyph) return `${glyph}${body}`;
    if (value.unit === "percent") return `${body}%`;
    if (value.unit && value.unit !== "text" && value.unit !== "section") {
      return `${body} ${value.unit}`;
    }
    return body;
  }
  return String(value.value);
}

/** The compact "X → Y" line. Null when there is no real value pair to show. */
export function valuePair(change: Change): { before: string; after: string } | null {
  const skip = ["text", "section"];
  if (
    (change.oldValue?.unit && skip.includes(change.oldValue.unit)) ||
    (change.newValue?.unit && skip.includes(change.newValue.unit))
  ) {
    return null;
  }
  const before = formatValue(change.oldValue);
  const after = formatValue(change.newValue);
  if (before === "—" && after === "—") return null;
  return { before, after };
}

export function formatDelta(change: Change): string[] {
  const d = change.delta;
  if (!d) return [];
  const out: string[] = [];
  const signed = (n: number, dp = 2): string =>
    `${n > 0 ? "+" : "−"}${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: dp })}`;

  if (d.absolute !== null && d.absolute !== undefined) {
    const glyph = d.unit ? (CURRENCY_GLYPH[d.unit] ?? "") : "";
    out.push(
      `${d.absolute > 0 ? "+" : "−"}${glyph}` +
        Math.abs(d.absolute).toLocaleString(undefined, { maximumFractionDigits: 2 }),
    );
  }
  if (d.percentage !== null && d.percentage !== undefined) out.push(`${signed(d.percentage)}%`);
  if (d.percentagePoints !== null && d.percentagePoints !== undefined) {
    out.push(`${signed(d.percentagePoints)} percentage points`);
  }
  if (d.days !== null && d.days !== undefined) out.push(`${signed(d.days, 0)} days`);
  if (d.strengthChange !== null && d.strengthChange !== undefined) {
    out.push(d.strengthChange < 0 ? "weaker wording" : "stronger wording");
  }
  return out;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Citation label. `approximatePage` suppresses the page number for a DOCX that carries
 * no pagination data — claiming a page we estimated would be a false citation.
 */
export function citationLabel(
  section: string | null | undefined,
  page: number | null | undefined,
  approximatePage = false,
): string {
  const parts: string[] = [];
  if (section) parts.push(shortSection(section));
  if (page !== null && page !== undefined) {
    parts.push(approximatePage ? `approx. page ${page}` : `page ${page}`);
  }
  return parts.join(" · ") || "—";
}

/** Section paths can be deep; show the leaf plus one ancestor. */
export function shortSection(path: string): string {
  const parts = path.split(" > ");
  if (parts.length <= 2) return path;
  return `… > ${parts.slice(-2).join(" > ")}`;
}

export function pluralise(n: number, singular: string, plural = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : plural}`;
}
