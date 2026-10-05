/**
 * Deterministic structured extraction.
 *
 * This layer is what gives high recall on amounts, dates, durations and percentages
 * without asking a model to find them. Every entity keeps its source span so a change
 * can cite the exact characters that produced it.
 */

export type EntityType =
  | "MONEY"
  | "DATE"
  | "DURATION"
  | "PERCENT"
  | "QUANTITY"
  | "NOTICE_PERIOD"
  | "PAYMENT_PERIOD"
  | "INTEREST_RATE"
  | "OBLIGATION";

export interface Entity {
  type: EntityType;
  sourceText: string;
  charStart: number;
  charEnd: number;
  blockId: string;
  value: number | string | null;
  unit: string | null;
  currency: string | null;
  confidence: number;
  attrs: Record<string, unknown>;
}

export type DateLocale = "DMY" | "MDY";

/* ------------------------------------------------------------- number words */

const UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70,
  eighty: 80, ninety: 90,
};
const SCALES: Record<string, number> = {
  hundred: 100, thousand: 1_000, million: 1_000_000, billion: 1_000_000_000,
};

const NUMBER_WORDS = [
  ...Object.keys(UNITS), ...Object.keys(TENS), ...Object.keys(SCALES), "and", "a",
].sort((a, b) => b.length - a.length);
const NUM_ALT = NUMBER_WORDS.join("|");
const WORD_NUMBER_PATTERN = `(?:${NUM_ALT})(?:[\\s-]+(?:${NUM_ALT}))*`;

/** "ninety" -> 90, "three hundred and fifty" -> 350. Null when not a number. */
export function wordsToNumber(phrase: string): number | null {
  const parts = phrase
    .trim()
    .toLowerCase()
    .split(/[\s-]+/)
    .filter((p) => p && p !== "and");
  if (parts.length === 0) return null;

  let total = 0;
  let current = 0;
  let sawNumber = false;
  for (const part of parts) {
    if (part === "a") {
      current = Math.max(current, 1);
      continue;
    }
    if (part in UNITS) {
      current += UNITS[part] as number;
      sawNumber = true;
    } else if (part in TENS) {
      current += TENS[part] as number;
      sawNumber = true;
    } else if (part in SCALES) {
      const scale = SCALES[part] as number;
      if (current === 0) current = 1;
      if (scale >= 1000) {
        total += current * scale;
        current = 0;
      } else {
        current *= scale;
      }
      sawNumber = true;
    } else {
      return null;
    }
  }
  return sawNumber ? total + current : null;
}

export function parseNumber(text: string): number | null {
  const cleaned = text.trim().replace(/,/g, "").replace(/\s/g, "");
  if (/^\d+(\.\d+)?$/.test(cleaned)) return Number(cleaned);
  return wordsToNumber(text);
}

/* -------------------------------------------------------------------- money */

const CURRENCY_SYMBOLS: Record<string, string> = {
  "₦": "NGN", $: "USD", "£": "GBP", "€": "EUR", "¥": "JPY",
};
const CURRENCY_CODES: Record<string, string> = {
  ngn: "NGN", naira: "NGN", usd: "USD", dollars: "USD", dollar: "USD",
  gbp: "GBP", pounds: "GBP", pound: "GBP", eur: "EUR", euros: "EUR", euro: "EUR",
  kes: "KES", zar: "ZAR", ghs: "GHS",
};
const MULTIPLIERS: Record<string, number> = {
  k: 1_000, thousand: 1_000, m: 1_000_000, mn: 1_000_000, million: 1_000_000,
  bn: 1_000_000_000, billion: 1_000_000_000,
};

// JavaScript has no scoped `(?-i:…)` flag, so the bare-N naira shorthand is matched
// case-insensitively and its case is checked in code below. Without that check,
// "withi(n 45) days" reads as a currency amount and a duration becomes a price.
const MONEY_RE = new RegExp(
  "(?<pre>₦|\\$|£|€|¥|(?<![A-Za-z])N(?=\\d)|\\bNGN|\\bUSD|\\bGBP|\\bEUR|\\bKES|\\bZAR|\\bGHS)?" +
    "\\s*(?<amount>\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?)" +
    "\\s*(?<mult>k|m|mn|bn|thousand|million|billion)?\\b" +
    "\\s*(?<post>naira|dollars?|pounds?|euros?|NGN|USD|GBP|EUR|KES|ZAR|GHS)?",
  "giu",
);

const WORD_MONEY_RE = new RegExp(
  "(?<pre>₦|\\$|£|€|NGN|USD|GBP|EUR)?\\s*" +
    `(?<words>${WORD_NUMBER_PATTERN})` +
    "\\s*(?<post>naira|dollars?|pounds?|euros?)",
  "giu",
);

function currencyCode(token: string | undefined): string | null {
  if (!token) return null;
  const t = token.trim();
  if (t in CURRENCY_SYMBOLS) return CURRENCY_SYMBOLS[t] as string;
  const low = t.toLowerCase();
  if (low === "n") return "NGN";
  return CURRENCY_CODES[low] ?? null;
}

export function extractMoney(text: string, blockId: string): Entity[] {
  const out: Entity[] = [];
  const taken: Array<[number, number]> = [];

  MONEY_RE.lastIndex = 0;
  for (const m of text.matchAll(MONEY_RE)) {
    const g = m.groups ?? {};
    const pre = g.pre;
    const post = g.post;
    if (!pre && !post) continue; // a bare number is not money

    // The bare-N shorthand must be an uppercase N (N3,500,000), never the tail of a word.
    if (pre && pre.length === 1 && /[a-z]/i.test(pre) && pre !== "N") continue;

    const amountRaw = g.amount;
    if (!amountRaw) continue;
    let amount = parseNumber(amountRaw);
    if (amount === null) continue;

    const mult = (g.mult ?? "").toLowerCase();
    if (mult) amount *= MULTIPLIERS[mult] as number;

    const code = currencyCode(pre) ?? currencyCode(post);
    const start = m.index ?? 0;
    const end = start + m[0].length;
    taken.push([start, end]);
    out.push({
      type: "MONEY",
      sourceText: m[0].trim(),
      charStart: start,
      charEnd: end,
      blockId,
      value: Math.round(amount * 100) / 100,
      unit: code,
      currency: code,
      confidence: code ? 1 : 0.6,
      attrs: {},
    });
  }

  WORD_MONEY_RE.lastIndex = 0;
  for (const m of text.matchAll(WORD_MONEY_RE)) {
    const start = m.index ?? 0;
    if (taken.some(([s, e]) => s <= start && start < e)) continue;
    const amount = wordsToNumber(m.groups?.words ?? "");
    if (amount === null) continue;
    const code = currencyCode(m.groups?.pre) ?? currencyCode(m.groups?.post);
    out.push({
      type: "MONEY",
      sourceText: m[0].trim(),
      charStart: start,
      charEnd: start + m[0].length,
      blockId,
      value: amount,
      unit: code,
      currency: code,
      confidence: 0.85,
      attrs: {},
    });
  }
  return out;
}

/* ------------------------------------------------------------------ percent */

const PERCENT_RE = new RegExp(
  `(?<amount>\\d+(?:\\.\\d+)?|${WORD_NUMBER_PATTERN})\\s*(?:%|per\\s?cent(?:age)?)`,
  "giu",
);
const RATE_CONTEXT = /\b(interest|late\s+payment|per\s+annum|p\.a\.|apr)\b/i;

const PERCENT_CONTEXTS: Array<[string, string]> = [
  ["upfront", "upfront"], ["up front", "upfront"], ["in advance", "upfront"],
  ["deposit", "deposit"], ["on completion", "on_completion"],
  ["discount", "discount"], ["vat", "tax"], ["tax", "tax"],
  ["commission", "commission"], ["interest", "interest"], ["penalt", "penalty"],
];

function percentContext(window: string): string {
  const low = window.toLowerCase();
  for (const [kw, label] of PERCENT_CONTEXTS) if (low.includes(kw)) return label;
  return "general";
}

export function extractPercent(text: string, blockId: string): Entity[] {
  const out: Entity[] = [];
  PERCENT_RE.lastIndex = 0;
  for (const m of text.matchAll(PERCENT_RE)) {
    const value = parseNumber(m.groups?.amount ?? "");
    if (value === null) continue;
    const start = m.index ?? 0;
    const end = start + m[0].length;
    const window = text.slice(Math.max(0, start - 60), end + 60);
    out.push({
      type: RATE_CONTEXT.test(window) ? "INTEREST_RATE" : "PERCENT",
      sourceText: m[0].trim(),
      charStart: start,
      charEnd: end,
      blockId,
      value,
      unit: "percent",
      currency: null,
      confidence: 1,
      attrs: { context: percentContext(window) },
    });
  }
  return out;
}

/* -------------------------------------------------------------------- dates */

const MONTHS: Record<string, number> = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4,
  may: 5, june: 6, jun: 6, july: 7, jul: 7, august: 8, aug: 8, september: 9,
  sep: 9, sept: 9, october: 10, oct: 10, november: 11, nov: 11, december: 12, dec: 12,
};
const MONTH_ALT = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join("|");

const DATE_DMY = new RegExp(
  `\\b(?<day>\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(?<month>${MONTH_ALT})\\.?` +
    "(?:,?\\s+(?<year>\\d{4}))?\\b",
  "giu",
);
const DATE_MDY = new RegExp(
  `\\b(?<month>${MONTH_ALT})\\.?\\s+(?<day>\\d{1,2})(?:st|nd|rd|th)?` +
    "(?:,?\\s+(?<year>\\d{4}))?\\b",
  "giu",
);
const DATE_NUMERIC = /\b(?<a>\d{1,4})[/.-](?<b>\d{1,2})[/.-](?<c>\d{2,4})\b/gu;

const DATE_KIND_WORDS: Array<[string, string]> = [
  ["commenc", "start"], ["start", "start"], ["effective", "start"], ["begin", "start"],
  ["expir", "end"], ["end", "end"], ["terminat", "end"],
  ["deliver", "delivery"], ["complet", "delivery"], ["go-live", "delivery"],
  ["renew", "renewal"], ["milestone", "milestone"], ["due", "due"],
];

function dateKind(text: string, at: number): string {
  const window = text.slice(Math.max(0, at - 90), at + 40).toLowerCase();
  for (const [kw, label] of DATE_KIND_WORDS) if (window.includes(kw)) return label;
  return "general";
}

export function extractDates(
  text: string,
  blockId: string,
  locale: DateLocale = "DMY",
): Entity[] {
  const out: Entity[] = [];
  const taken: Array<[number, number]> = [];

  const add = (
    start: number, end: number, src: string,
    y: number, mo: number, d: number, conf: number, note?: string,
  ): void => {
    if (taken.some(([s, e]) => s < end && start < e)) return;
    taken.push([start, end]);
    const attrs: Record<string, unknown> = { kind: dateKind(text, start) };
    if (note) attrs.note = note;
    const pad = (n: number, w: number) => String(n).padStart(w, "0");
    out.push({
      type: "DATE",
      sourceText: src,
      charStart: start,
      charEnd: end,
      blockId,
      value: y ? `${pad(y, 4)}-${pad(mo, 2)}-${pad(d, 2)}` : `--${pad(mo, 2)}-${pad(d, 2)}`,
      unit: "date",
      currency: null,
      confidence: conf,
      attrs,
    });
  };

  for (const rx of [DATE_DMY, DATE_MDY]) {
    rx.lastIndex = 0;
    for (const m of text.matchAll(rx)) {
      const monthKey = (m.groups?.month ?? "").toLowerCase().replace(/\.$/, "");
      const month = MONTHS[monthKey];
      if (!month) continue;
      const day = Number(m.groups?.day);
      if (!(day >= 1 && day <= 31)) continue;
      const year = m.groups?.year ? Number(m.groups.year) : 0;
      const start = m.index ?? 0;
      add(start, start + m[0].length, m[0].trim(), year, month, day,
        year ? 1 : 0.6, year ? undefined : "year not stated");
    }
  }

  DATE_NUMERIC.lastIndex = 0;
  for (const m of text.matchAll(DATE_NUMERIC)) {
    const g = m.groups ?? {};
    const a = Number(g.a);
    const b = Number(g.b);
    const c = Number(g.c);
    let y: number;
    let mo: number;
    let d: number;
    let conf = 0.9;
    let note: string | undefined;

    if ((g.a ?? "").length === 4) {
      y = a; mo = b; d = c; conf = 1;
    } else {
      y = c < 100 ? c + 2000 : c;
      if (locale === "DMY") { d = a; mo = b; } else { mo = a; d = b; }
      if (a <= 12 && b <= 12 && a !== b) {
        conf = 0.55;
        note = "ambiguous day/month order";
      }
    }
    if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) continue;
    const start = m.index ?? 0;
    add(start, start + m[0].length, m[0].trim(), y, mo, d, conf, note);
  }

  out.sort((x, y2) => x.charStart - y2.charStart);
  return out;
}

export function isoToDate(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(d.getTime()) ? null : d;
}

/* ----------------------------------------------------------------- duration */

const DURATION_UNITS: Record<string, string> = {
  day: "days", days: "days", "business day": "days", "business days": "days",
  week: "weeks", weeks: "weeks", month: "months", months: "months",
  year: "years", years: "years", hour: "hours", hours: "hours",
  "calendar day": "days", "calendar days": "days",
  "working day": "days", "working days": "days",
};
const UNIT_ALT = Object.keys(DURATION_UNITS).sort((a, b) => b.length - a.length).join("|");

const DURATION_RE = new RegExp(
  `\\b(?<amount>\\d+(?:\\.\\d+)?|${WORD_NUMBER_PATTERN})[\\s-]+(?<unit>${UNIT_ALT})\\b`,
  "giu",
);
const PAYMENT_CONTEXT = /\b(invoice|invoices|payment|paid|pay|payable|remit|settle|settlement)\b/i;
const NOTICE_CONTEXT = /\b(notice|notify|terminat|cancel)\w*\b/i;
const DURATION_KIND_WORDS: Array<[string, string]> = [
  ["support", "support"], ["maintenance", "support"], ["warrant", "warranty"],
  ["deliver", "delivery"], ["complet", "delivery"], ["implement", "delivery"],
  ["renew", "renewal"], ["confidential", "confidentiality"], ["term of", "term"],
  ["cure", "cure"], ["remedy", "cure"],
];

function durationKind(window: string): string {
  const low = window.toLowerCase();
  for (const [kw, label] of DURATION_KIND_WORDS) if (low.includes(kw)) return label;
  return "general";
}

const DAYS_PER: Record<string, number> = {
  hours: 1 / 24, days: 1, weeks: 7, months: 30, years: 365,
};

/** Rough comparison helper only — never used to compute calendar dates. */
export function toDays(amount: number, unit: string): number | null {
  const factor = DAYS_PER[unit];
  return factor === undefined ? null : Math.round(amount * factor * 100) / 100;
}

export function extractDurations(text: string, blockId: string): Entity[] {
  const out: Entity[] = [];
  DURATION_RE.lastIndex = 0;
  for (const m of text.matchAll(DURATION_RE)) {
    const amount = parseNumber(m.groups?.amount ?? "");
    if (amount === null) continue;
    const unit = DURATION_UNITS[(m.groups?.unit ?? "").toLowerCase()];
    if (!unit) continue;

    const start = m.index ?? 0;
    const end = start + m[0].length;
    const window = text.slice(Math.max(0, start - 110), end + 60);

    let type: EntityType;
    let kind: string;
    if (PAYMENT_CONTEXT.test(window)) {
      type = "PAYMENT_PERIOD";
      kind = "payment";
    } else if (NOTICE_CONTEXT.test(window)) {
      type = "NOTICE_PERIOD";
      kind = "notice";
    } else {
      type = "DURATION";
      kind = durationKind(window);
    }

    out.push({
      type,
      sourceText: m[0].trim(),
      charStart: start,
      charEnd: end,
      blockId,
      value: amount,
      unit,
      currency: null,
      confidence: 1,
      attrs: { kind, daysEquivalent: toDays(amount, unit) },
    });
  }
  return out;
}

/* --------------------------------------------------------------- obligation */

export const MODALITY_STRENGTH: Record<string, number> = {
  must: 7, shall: 6, "is required to": 6, "are required to": 6, required: 6,
  "agrees to": 5, "undertakes to": 5, will: 4,
  "is responsible for": 4, "are responsible for": 4, should: 3,
  may: 2, "is permitted to": 2, "are permitted to": 2,
  "is entitled to": 2, "are entitled to": 2, can: 2,
  "at its discretion": 1, optional: 1, recommended: 2,
  endeavour: 2, endeavor: 2, "reasonable efforts": 2,
};
const MODAL_ALT = Object.keys(MODALITY_STRENGTH)
  .sort((a, b) => b.length - a.length)
  .join("|");

const ROLE_WORDS = [
  "supplier", "vendor", "client", "customer", "contractor", "consultant",
  "provider", "service provider", "company", "partner", "licensee", "licensor",
  "buyer", "seller", "purchaser", "employer", "employee", "tenant", "landlord",
  "lessee", "lessor", "agency", "developer", "either party", "each party",
  "both parties", "parties", "party",
].sort((a, b) => b.length - a.length);
const ROLE_ALT = ROLE_WORDS.join("|");

const OBLIGATION_RE = new RegExp(
  `\\b(?<actor>(?:the\\s+)?(?:${ROLE_ALT})|[A-Z][\\w&.'-]*(?:\\s+[A-Z][\\w&.'-]*){0,3})` +
    `\\s+(?<modality>${MODAL_ALT})\\s+(?<rest>.{0,220})`,
  "giu",
);
const FREQUENCY_RE =
  /\b(hourly|daily|weekly|fortnightly|bi-weekly|monthly|quarterly|semi-annually|annually|yearly|per\s+(?:day|week|month|quarter|year))\b/i;
const NEGATION_RE = /^\s*(not|never|no longer|refrain from)\b/i;

/** Regex alternatives double-fire; keep the longest match per overlapping span. */
function dedupeOverlaps(entities: Entity[]): Entity[] {
  const sorted = [...entities].sort(
    (a, b) => a.charStart - b.charStart || (b.charEnd - b.charStart) - (a.charEnd - a.charStart),
  );
  const kept: Entity[] = [];
  for (const e of sorted) {
    if (kept.some((k) => k.charStart < e.charEnd && e.charStart < k.charEnd)) continue;
    kept.push(e);
  }
  return kept;
}

export function extractObligations(text: string, blockId: string): Entity[] {
  const out: Entity[] = [];
  OBLIGATION_RE.lastIndex = 0;
  for (const m of text.matchAll(OBLIGATION_RE)) {
    const g = m.groups ?? {};
    const modality = (g.modality ?? "").toLowerCase();
    const rest = (g.rest ?? "").trim();
    const actionMatch = /^(not\s+)?([a-z]+(?:\s+[a-z]+)?)/i.exec(rest);
    const action = actionMatch ? actionMatch[0].trim().toLowerCase() : "";
    const actor = (g.actor ?? "").trim().replace(/^the\s+/i, "").toLowerCase();
    const freq = FREQUENCY_RE.exec(rest);
    const start = m.index ?? 0;

    out.push({
      type: "OBLIGATION",
      sourceText: m[0].trim(),
      charStart: start,
      charEnd: start + m[0].length,
      blockId,
      value: modality,
      unit: "modality",
      currency: null,
      confidence: 0.9,
      attrs: {
        actor,
        modality,
        strength: MODALITY_STRENGTH[modality] ?? 3,
        action,
        object: rest.slice(0, 160),
        frequency: freq ? freq[0].toLowerCase() : null,
        negated: NEGATION_RE.test(rest),
      },
    });
  }
  return dedupeOverlaps(out);
}

/* ------------------------------------------------------------------ top API */

export function extractEntities(
  block: { id: string; text: string },
  locale: DateLocale = "DMY",
): Entity[] {
  const { text, id } = block;
  const found = [
    ...extractMoney(text, id),
    ...extractPercent(text, id),
    ...extractDates(text, id, locale),
    ...extractDurations(text, id),
    ...extractObligations(text, id),
  ];
  found.sort((a, b) => a.charStart - b.charStart || a.type.localeCompare(b.type));
  return found;
}

export function entitiesFor(
  blocks: Array<{ id: string; text: string }>,
  locale: DateLocale = "DMY",
): Map<string, Entity[]> {
  return new Map(blocks.map((b) => [b.id, extractEntities(b, locale)]));
}
