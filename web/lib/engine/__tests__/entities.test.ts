import { describe, expect, it } from "vitest";
import {
  extractDates,
  extractDurations,
  extractMoney,
  extractObligations,
  extractPercent,
  parseNumber,
  toDays,
  wordsToNumber,
} from "../entities";

describe("number words", () => {
  it.each([
    ["thirty", 30],
    ["sixty", 60],
    ["ninety", 90],
    ["three", 3],
    ["twelve", 12],
    ["three hundred and fifty", 350],
    ["three million", 3_000_000],
    ["twenty-one", 21],
  ])("reads %s as %i", (phrase, expected) => {
    expect(wordsToNumber(phrase)).toBe(expected);
  });

  it("rejects non-numbers", () => {
    expect(wordsToNumber("banana")).toBeNull();
    expect(parseNumber("banana")).toBeNull();
  });

  it("reads digits with separators", () => {
    expect(parseNumber("3,500,000")).toBe(3_500_000);
    expect(parseNumber("12.5")).toBe(12.5);
  });
});

describe("money", () => {
  it.each([
    ["₦3,500,000", "NGN", 3_500_000],
    ["NGN 3.5 million", "NGN", 3_500_000],
    ["N3,500,000", "NGN", 3_500_000],
    ["$20,000", "USD", 20_000],
    ["USD 20,000", "USD", 20_000],
    ["£5,000", "GBP", 5_000],
    ["€1,250.50", "EUR", 1_250.5],
    ["5,000,000 naira", "NGN", 5_000_000],
    ["twenty thousand dollars", "USD", 20_000],
  ])("reads %s", (text, currency, value) => {
    const found = extractMoney(text, "b1");
    expect(found.length).toBeGreaterThan(0);
    expect(found[0]?.currency).toBe(currency);
    expect(found[0]?.value).toBe(value);
  });

  it.each([
    "The Supplier shall complete the project within 45 days.",
    "Version 3 — 12 August 2026",
    "Support requests shall be acknowledged within 8 hours.",
    "Either party may terminate by giving 14 days written notice.",
    "Section 7 applies to all 12 deliverables.",
  ])("does not read a bare number as money: %s", (text) => {
    // Regression: a lowercase "n" before digits (withi-n 45) was read as the naira
    // shorthand, inventing a pricing change out of a duration.
    expect(extractMoney(text, "b1")).toEqual([]);
  });

  it("keeps the source text alongside the parsed value", () => {
    const [e] = extractMoney("The fee is ₦5,000,000 exclusive of tax.", "b1");
    expect(e?.sourceText).toContain("5,000,000");
    expect(e?.charStart).toBeGreaterThan(0);
  });
});

describe("dates", () => {
  it.each([
    ["October 15, 2026", "2026-10-15"],
    ["15 October 2026", "2026-10-15"],
    ["15/10/2026", "2026-10-15"],
    ["2026-10-15", "2026-10-15"],
    ["1st of March 2027", "2027-03-01"],
  ])("normalises %s", (text, iso) => {
    const found = extractDates(text, "b1");
    expect(found[0]?.value).toBe(iso);
    expect(found[0]?.sourceText).toBeTruthy();
  });

  it("flags an ambiguous numeric date", () => {
    const [e] = extractDates("04/05/2026", "b1");
    expect(e?.confidence).toBeLessThan(0.7);
    expect(String(e?.attrs.note)).toContain("ambiguous");
  });

  it("honours the locale", () => {
    expect(extractDates("04/05/2026", "b1", "DMY")[0]?.value).toBe("2026-05-04");
    expect(extractDates("04/05/2026", "b1", "MDY")[0]?.value).toBe("2026-04-05");
  });

  it("classifies a commencement date", () => {
    const [e] = extractDates("The commencement date is 5 October 2026.", "b1");
    expect(e?.attrs.kind).toBe("start");
  });
});

describe("durations", () => {
  it.each([
    ["three months", 3, "months"],
    ["90 days", 90, "days"],
    ["twelve weeks", 12, "weeks"],
    ["sixty days", 60, "days"],
  ])("normalises %s", (text, value, unit) => {
    const [e] = extractDurations(text, "b1");
    expect(e?.value).toBe(value);
    expect(e?.unit).toBe(unit);
  });

  it("types payment and notice periods from context", () => {
    const pay = extractDurations("Invoices shall be paid within 30 days of receipt.", "b1");
    expect(pay.some((e) => e.type === "PAYMENT_PERIOD")).toBe(true);

    const notice = extractDurations("Either party may terminate on 14 days written notice.", "b1");
    expect(notice.some((e) => e.type === "NOTICE_PERIOD")).toBe(true);
  });

  it("converts to days for comparison only", () => {
    expect(toDays(3, "months")).toBe(90);
    expect(toDays(2, "weeks")).toBe(14);
    expect(toDays(1, "fortnight")).toBeNull();
  });
});

describe("percent", () => {
  it("reads an upfront share with its context", () => {
    const [e] = extractPercent("The Client shall pay 50% of the price upfront.", "b1");
    expect(e?.value).toBe(50);
    expect(e?.attrs.context).toBe("upfront");
  });

  it("types an interest rate separately", () => {
    const [e] = extractPercent("Late payment shall attract interest at 2% per month.", "b1");
    expect(e?.type).toBe("INTEREST_RATE");
  });
});

describe("obligations", () => {
  it("extracts actor, modality, action and frequency", () => {
    const [e] = extractObligations("Supplier shall provide monthly reports to Client.", "b1");
    expect(e?.attrs.actor).toBe("supplier");
    expect(e?.attrs.modality).toBe("shall");
    expect(String(e?.attrs.action)).toContain("provide");
    expect(e?.attrs.frequency).toBe("monthly");
  });

  it("ranks mandatory wording above permissive", () => {
    const must = extractObligations("Supplier must deliver.", "b1")[0];
    const may = extractObligations("Supplier may deliver.", "b1")[0];
    expect(Number(must?.attrs.strength)).toBeGreaterThan(Number(may?.attrs.strength));
  });

  it("detects negation", () => {
    const [e] = extractObligations(
      "The Supplier shall not provide services to a competitor.",
      "b1",
    );
    expect(e?.attrs.negated).toBe(true);
  });

  it("does not emit overlapping duplicates", () => {
    const found = extractObligations(
      "The Service Provider shall provide support and the Client shall pay promptly.",
      "b1",
    );
    for (let i = 0; i < found.length; i++) {
      for (let j = i + 1; j < found.length; j++) {
        const a = found[i]!;
        const b = found[j]!;
        expect(a.charStart < b.charEnd && b.charStart < a.charEnd).toBe(false);
      }
    }
  });
});
