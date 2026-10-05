/**
 * Structured value comparison.
 *
 * Entities are compared independently of the text diff. That redundancy is deliberate:
 * if the wording was rewritten so heavily that the diff is unreadable, the amount or
 * date change is still caught here with an exact numeric delta.
 */

import type { Category, ChangeDelta, ChangeValue } from "./changes";
import { type Entity, isoToDate } from "./entities";
import type { Block } from "./model";

const CURRENCY_GLYPH: Record<string, string> = {
  NGN: "₦", USD: "$", GBP: "£", EUR: "€", JPY: "¥",
};

export interface StructuredFinding {
  category: Category;
  summary: string;
  oldValue: ChangeValue | null;
  newValue: ChangeValue | null;
  delta: ChangeDelta;
  direction: string | null;
  entityA: Entity | null;
  entityB: Entity | null;
  blockA: Block | null;
  blockB: Block | null;
  confidence: number;
}

/** Entities only compare against the same sort of thing in the same role. */
function groupKey(e: Entity): string {
  if (e.type === "MONEY") return `MONEY|${e.currency ?? "?"}`;
  if (e.type === "OBLIGATION") return `OBLIGATION|${String(e.attrs.actor ?? "")}`;
  if (e.type === "DURATION" || e.type === "DATE") {
    return `${e.type}|${String(e.attrs.kind ?? "general")}`;
  }
  if (e.type === "PERCENT") return `PERCENT|${String(e.attrs.context ?? "general")}`;
  return e.type;
}

/**
 * Positional pairing, but values that are already equal are matched first, so a single
 * edit among several amounts does not cascade into spurious differences.
 */
function pairEntities(listA: Entity[], listB: Entity[]): Array<[Entity | null, Entity | null]> {
  const remainingA = [...listA];
  const remainingB = [...listB];
  const pairs: Array<[Entity | null, Entity | null]> = [];

  for (const a of [...remainingA]) {
    const idx = remainingB.findIndex((b) => b.value === a.value);
    if (idx >= 0) {
      remainingA.splice(remainingA.indexOf(a), 1);
      const [b] = remainingB.splice(idx, 1);
      pairs.push([a, b as Entity]);
    }
  }
  while (remainingA.length > 0 || remainingB.length > 0) {
    pairs.push([remainingA.shift() ?? null, remainingB.shift() ?? null]);
  }
  return pairs;
}

export function compareEntities(
  blockA: Block | null,
  blockB: Block | null,
  entitiesA: Entity[],
  entitiesB: Entity[],
): StructuredFinding[] {
  const findings: StructuredFinding[] = [];
  const keys = new Set([...entitiesA.map(groupKey), ...entitiesB.map(groupKey)]);

  for (const key of [...keys].sort()) {
    const listA = entitiesA.filter((e) => groupKey(e) === key);
    const listB = entitiesB.filter((e) => groupKey(e) === key);
    for (const [a, b] of pairEntities(listA, listB)) {
      const finding = comparePair(a, b);
      if (finding) {
        finding.entityA = a;
        finding.entityB = b;
        finding.blockA = blockA;
        finding.blockB = blockB;
        finding.confidence = Math.min(
          finding.confidence,
          Math.min(a?.confidence ?? 1, b?.confidence ?? 1),
        );
        findings.push(finding);
      }
    }
  }
  return findings;
}

function comparePair(a: Entity | null, b: Entity | null): StructuredFinding | null {
  if (!a && !b) return null;
  if (a && b && a.value === b.value && a.unit === b.unit) {
    // Same modality can still mean a changed obligation (frequency, negation), so
    // obligations fall through; everything else is genuinely unchanged.
    if (a.type !== "OBLIGATION") return null;
  }

  const type = (a ?? b)!.type;
  switch (type) {
    case "MONEY": return compareMoney(a, b);
    case "DATE": return compareDate(a, b);
    case "DURATION":
    case "PAYMENT_PERIOD":
    case "NOTICE_PERIOD": return compareDuration(a, b);
    case "PERCENT":
    case "INTEREST_RATE": return comparePercent(a, b);
    case "OBLIGATION": return compareObligation(a, b);
    default: return null;
  }
}

function base(
  category: Category,
  summary: string,
  oldValue: ChangeValue | null,
  newValue: ChangeValue | null,
  direction: string | null,
  delta: ChangeDelta = {},
  confidence = 1,
): StructuredFinding {
  return {
    category, summary, oldValue, newValue, delta, direction,
    entityA: null, entityB: null, blockA: null, blockB: null, confidence,
  };
}

/* -------------------------------------------------------------------- money */

function fmtAmount(value: number, currency: string | null): string {
  const glyph = currency ? (CURRENCY_GLYPH[currency] ?? "") : "";
  const body = value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (glyph) return `${glyph}${body}`;
  return currency ? `${body} ${currency}` : body;
}

function fmtMoney(e: Entity): string {
  return fmtAmount(Number(e.value), e.currency);
}

function moneyValue(e: Entity | null): ChangeValue | null {
  if (!e) return null;
  return { value: e.value, currency: e.currency, unit: e.currency, sourceText: e.sourceText };
}

function compareMoney(a: Entity | null, b: Entity | null): StructuredFinding | null {
  if (!a) {
    return base("PRICING", `New amount introduced: ${fmtMoney(b!)}.`, null, moneyValue(b), "added");
  }
  if (!b) {
    return base("PRICING", `Amount removed: ${fmtMoney(a)}.`, moneyValue(a), null, "removed");
  }
  const oldV = Number(a.value);
  const newV = Number(b.value);
  const absolute = Math.round((newV - oldV) * 100) / 100;
  const pct = oldV !== 0 ? Math.round((absolute / oldV) * 10000) / 100 : null;
  const word = absolute > 0 ? "increased" : "decreased";
  const pctText = pct !== null ? ` (${absolute > 0 ? "+" : "-"}${Math.abs(pct)}%)` : "";
  return base(
    "PRICING",
    `Amount ${word} from ${fmtMoney(a)} to ${fmtMoney(b)} — ` +
      `${absolute > 0 ? "+" : "-"}${fmtAmount(Math.abs(absolute), b.currency)}${pctText}.`,
    moneyValue(a),
    moneyValue(b),
    `amount_${word}`,
    { absolute, percentage: pct, unit: a.currency ?? b.currency },
  );
}

/* --------------------------------------------------------------------- date */

function dateValue(e: Entity | null): ChangeValue | null {
  if (!e) return null;
  return {
    value: e.value, unit: "date", sourceText: e.sourceText,
    kind: (e.attrs.kind as string) ?? null,
  };
}

function compareDate(a: Entity | null, b: Entity | null): StructuredFinding | null {
  const kind = String((b ?? a)!.attrs.kind ?? "general").replace(/_/g, " ");
  const label = kind === "general" ? "Date" : `${kind[0]?.toUpperCase()}${kind.slice(1)} date`;

  if (!a) return base("DATES", `${label} added: ${b!.sourceText}.`, null, dateValue(b), "added");
  if (!b) return base("DATES", `${label} removed: ${a.sourceText}.`, dateValue(a), null, "removed");

  const da = isoToDate(String(a.value));
  const db = isoToDate(String(b.value));
  let delta: ChangeDelta = {};
  let direction = "date_changed";
  let tail = "";
  if (da && db) {
    const days = Math.round((db.getTime() - da.getTime()) / 86_400_000);
    delta = { days };
    if (days !== 0) {
      direction = days > 0 ? "date_later" : "date_earlier";
      tail = ` — moved ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} ${days > 0 ? "later" : "earlier"}`;
    }
  }
  return base(
    "DATES",
    `${label} changed from ${a.sourceText} to ${b.sourceText}${tail}.`,
    dateValue(a), dateValue(b), direction, delta,
  );
}

/* ----------------------------------------------------------------- duration */

const DURATION_CATEGORY: Record<string, Category> = {
  PAYMENT_PERIOD: "PAYMENT_TERMS",
  NOTICE_PERIOD: "TERMINATION",
  DURATION: "DURATION",
};
const KIND_LABEL: Record<string, string> = {
  payment: "Payment period",
  notice: "Notice period",
  support: "Support period",
  warranty: "Warranty period",
  delivery: "Delivery period",
  renewal: "Renewal period",
  confidentiality: "Confidentiality period",
  term: "Term",
  cure: "Cure period",
  general: "Duration",
};

function durationValue(e: Entity | null): ChangeValue | null {
  if (!e) return null;
  return {
    value: e.value, unit: e.unit, sourceText: e.sourceText,
    kind: (e.attrs.kind as string) ?? null,
    daysEquivalent: (e.attrs.daysEquivalent as number) ?? null,
  };
}

function compareDuration(a: Entity | null, b: Entity | null): StructuredFinding | null {
  const ref = (b ?? a)!;
  const category = DURATION_CATEGORY[ref.type] ?? "DURATION";
  const label = KIND_LABEL[String(ref.attrs.kind ?? "general")] ?? "Duration";

  if (!a) return base(category, `${label} added: ${b!.sourceText}.`, null, durationValue(b), "added");
  if (!b) return base(category, `${label} removed: ${a.sourceText}.`, durationValue(a), null, "removed");

  const oldDays = a.attrs.daysEquivalent as number | null;
  const newDays = b.attrs.daysEquivalent as number | null;
  let delta: ChangeDelta = {};
  let direction = "duration_changed";
  let tail = "";
  if (oldDays && newDays) {
    const diff = Math.round((newDays - oldDays) * 100) / 100;
    const pct = oldDays !== 0 ? Math.round((diff / oldDays) * 10000) / 100 : null;
    delta = { days: diff, percentage: pct };
    if (diff !== 0) {
      const longer = diff > 0;
      direction = longer ? "duration_longer" : "duration_shorter";
      if (a.unit === b.unit) {
        const unitDiff = Math.abs(Math.round((Number(b.value) - Number(a.value)) * 100) / 100);
        tail = ` — ${unitDiff} ${a.unit} ${longer ? "longer" : "shorter"}`;
      } else {
        tail = ` — ${Math.abs(diff)} days ${longer ? "longer" : "shorter"}`;
      }
    }
  }
  return base(
    category,
    `${label} changed from ${a.sourceText} to ${b.sourceText}${tail}.`,
    durationValue(a), durationValue(b), direction, delta,
  );
}

/* ------------------------------------------------------------------ percent */

const PERCENT_CATEGORY: Record<string, Category> = {
  upfront: "PAYMENT_TERMS", deposit: "PAYMENT_TERMS", on_completion: "PAYMENT_TERMS",
  interest: "PAYMENT_TERMS", penalty: "PAYMENT_TERMS",
  discount: "PRICING", tax: "PRICING", commission: "PRICING",
};
const PERCENT_LABEL: Record<string, string> = {
  upfront: "Upfront payment share", deposit: "Deposit",
  on_completion: "Payment on completion", discount: "Discount", tax: "Tax rate",
  commission: "Commission", interest: "Interest rate", penalty: "Penalty rate",
  general: "Percentage",
};

function percentValue(e: Entity | null): ChangeValue | null {
  if (!e) return null;
  return {
    value: e.value, unit: "percent", sourceText: e.sourceText,
    context: (e.attrs.context as string) ?? null,
  };
}

function comparePercent(a: Entity | null, b: Entity | null): StructuredFinding | null {
  const ref = (b ?? a)!;
  const context = String(ref.attrs.context ?? "general");
  const category = PERCENT_CATEGORY[context] ?? "PRICING";
  const label = PERCENT_LABEL[context] ?? "Percentage";

  if (!a) return base(category, `${label} added: ${b!.sourceText}.`, null, percentValue(b), "added");
  if (!b) return base(category, `${label} removed: ${a.sourceText}.`, percentValue(a), null, "removed");

  const points = Math.round((Number(b.value) - Number(a.value)) * 100) / 100;
  const word = points > 0 ? "increased" : "decreased";
  return base(
    category,
    `${label} ${word} from ${a.value}% to ${b.value}% — ` +
      `${points > 0 ? "+" : "-"}${Math.abs(points)} percentage points.`,
    percentValue(a), percentValue(b), `percent_${word}`,
    { percentagePoints: points },
  );
}

/* --------------------------------------------------------------- obligation */

function obligationValue(e: Entity): ChangeValue {
  return {
    value: (e.attrs.modality as string) ?? null,
    unit: "modality",
    sourceText: e.sourceText,
    actor: (e.attrs.actor as string) ?? null,
    action: (e.attrs.action as string) ?? null,
    strength: (e.attrs.strength as number) ?? null,
    frequency: (e.attrs.frequency as string) ?? null,
  };
}

function strengthWord(s: number): string {
  return s >= 5 ? "mandatory" : s >= 3 ? "advisory" : "permissive";
}

function compareObligation(a: Entity | null, b: Entity | null): StructuredFinding | null {
  if (!a || !b) {
    const ref = (a ?? b)!;
    const added = a === null;
    const actor = String(ref.attrs.actor ?? "a party");
    const verb = added ? "added" : "removed";
    return base(
      "OBLIGATIONS",
      `Obligation ${verb}: ${titleCase(actor)} ${String(ref.attrs.modality)} ${String(ref.attrs.action)}.`,
      added ? null : obligationValue(ref),
      added ? obligationValue(ref) : null,
      `obligation_${verb}`,
    );
  }

  const sa = Number(a.attrs.strength ?? 3);
  const sb = Number(b.attrs.strength ?? 3);
  const freqA = a.attrs.frequency ?? null;
  const freqB = b.attrs.frequency ?? null;
  const negA = Boolean(a.attrs.negated);
  const negB = Boolean(b.attrs.negated);

  if (sa === sb && freqA === freqB && negA === negB) return null;

  const parts: string[] = [];
  let direction = "obligation_changed";
  if (sa !== sb) {
    direction = sb < sa ? "obligation_weakened" : "obligation_strengthened";
    parts.push(
      `Requirement language changed from "${String(a.attrs.modality)}" (${strengthWord(sa)}) ` +
        `to "${String(b.attrs.modality)}" (${strengthWord(sb)})`,
    );
  }
  if (freqA !== freqB) {
    parts.push(`frequency changed from ${String(freqA ?? "unstated")} to ${String(freqB ?? "unstated")}`);
  }
  if (negA !== negB) {
    parts.push(negB ? "the obligation was negated" : "a negation was removed");
  }

  return base(
    "OBLIGATIONS",
    `${titleCase(String(b.attrs.actor ?? "party"))}: ${parts.join("; ")}.`,
    obligationValue(a), obligationValue(b), direction,
    { strengthChange: sb - sa },
    0.9,
  );
}

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}
