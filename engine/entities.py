"""Deterministic structured extraction (TRD §18-23).

This layer is what gives VersionLens high recall on amounts, dates, durations and
percentages without asking a model to find them. Every entity keeps its source span
so a change can cite the exact characters that produced it.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date
from enum import Enum
from typing import Any

from .model import Block


class EntityType(str, Enum):
    MONEY = "MONEY"
    DATE = "DATE"
    DURATION = "DURATION"
    PERCENT = "PERCENT"
    QUANTITY = "QUANTITY"
    NOTICE_PERIOD = "NOTICE_PERIOD"
    PAYMENT_PERIOD = "PAYMENT_PERIOD"
    INTEREST_RATE = "INTEREST_RATE"
    OBLIGATION = "OBLIGATION"
    ORGANIZATION = "ORGANIZATION"
    ROLE = "ROLE"


@dataclass
class Entity:
    type: EntityType
    source_text: str
    char_start: int
    char_end: int
    block_id: str
    value: Any = None
    unit: str | None = None
    currency: str | None = None
    confidence: float = 1.0
    attrs: dict[str, Any] = field(default_factory=dict)

    @property
    def key(self) -> str:
        """Identity used when pairing entities across versions."""
        if self.type is EntityType.MONEY:
            return f"MONEY:{self.currency}"
        if self.type is EntityType.OBLIGATION:
            return f"OBLIGATION:{self.attrs.get('actor', '')}:{self.attrs.get('action', '')}"
        return self.type.value

    def to_dict(self) -> dict[str, Any]:
        return {
            "type": self.type.value,
            "source_text": self.source_text,
            "value": self.value,
            "unit": self.unit,
            "currency": self.currency,
            "confidence": self.confidence,
            "block_id": self.block_id,
            "char_start": self.char_start,
            "char_end": self.char_end,
            "attrs": self.attrs,
        }


# ------------------------------------------------------------------- number words

_UNITS = {
    "zero": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6,
    "seven": 7, "eight": 8, "nine": 9, "ten": 10, "eleven": 11, "twelve": 12,
    "thirteen": 13, "fourteen": 14, "fifteen": 15, "sixteen": 16, "seventeen": 17,
    "eighteen": 18, "nineteen": 19,
}
_TENS = {
    "twenty": 20, "thirty": 30, "forty": 40, "fourty": 40, "fifty": 50,
    "sixty": 60, "seventy": 70, "eighty": 80, "ninety": 90,
}
_SCALES = {"hundred": 100, "thousand": 1_000, "million": 1_000_000, "billion": 1_000_000_000}
_NUMBER_WORD = set(_UNITS) | set(_TENS) | set(_SCALES) | {"and", "a"}

_WORD_NUMBER_RE = re.compile(
    r"\b((?:" + "|".join(sorted(_NUMBER_WORD, key=len, reverse=True)) + r")(?:[\s-]+(?:"
    + "|".join(sorted(_NUMBER_WORD, key=len, reverse=True)) + r"))*)\b",
    re.IGNORECASE,
)


def words_to_number(phrase: str) -> int | None:
    """'ninety' -> 90, 'three hundred and fifty' -> 350. Returns None if not a number."""
    parts = re.split(r"[\s-]+", phrase.strip().lower())
    parts = [p for p in parts if p and p != "and"]
    if not parts:
        return None
    total = 0
    current = 0
    saw_number = False
    for part in parts:
        if part == "a":
            current = max(current, 1)
            continue
        if part in _UNITS:
            current += _UNITS[part]
            saw_number = True
        elif part in _TENS:
            current += _TENS[part]
            saw_number = True
        elif part in _SCALES:
            scale = _SCALES[part]
            if current == 0:
                current = 1
            if scale >= 1000:
                total += current * scale
                current = 0
            else:
                current *= scale
            saw_number = True
        else:
            return None
    return total + current if saw_number else None


def parse_number(text: str) -> float | None:
    """Digits with separators, or number words."""
    cleaned = text.strip().replace(",", "").replace(" ", "")
    try:
        return float(cleaned)
    except ValueError:
        pass
    return words_to_number(text)


# ------------------------------------------------------------------------- money

_CURRENCY_SYMBOLS = {"₦": "NGN", "$": "USD", "£": "GBP", "€": "EUR", "¥": "JPY"}
_CURRENCY_CODES = {
    "ngn": "NGN", "naira": "NGN", "usd": "USD", "dollars": "USD", "dollar": "USD",
    "gbp": "GBP", "pounds": "GBP", "eur": "EUR", "euros": "EUR", "euro": "EUR",
    "kes": "KES", "zar": "ZAR", "ghs": "GHS",
}
_MULTIPLIER_WORDS = {"k": 1_000, "thousand": 1_000, "m": 1_000_000, "mn": 1_000_000,
                     "million": 1_000_000, "bn": 1_000_000_000, "billion": 1_000_000_000}

_MONEY_RE = re.compile(
    r"""
    # Leading symbol or code. The bare-N shorthand (N3,500,000) must be an uppercase N
    # that starts a word and runs straight into the digits, or every "within 45 days"
    # becomes a currency amount.
    (?P<pre>₦|\$|£|€|¥|(?<![A-Za-z])(?-i:N)(?=\d)|\bNGN|\bUSD|\bGBP|\bEUR|\bKES|\bZAR|\bGHS)?
    \s*
    (?P<amount>\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)
    \s*
    (?P<mult>k|m|mn|bn|thousand|million|billion)?\b
    \s*
    (?P<post>naira|dollars?|pounds?|euros?|NGN|USD|GBP|EUR|KES|ZAR|GHS)?
    """,
    re.IGNORECASE | re.VERBOSE,
)

_WORD_MONEY_RE = re.compile(
    r"(?P<pre>₦|\$|£|€|NGN|USD|GBP|EUR)?\s*"
    r"(?P<words>(?:" + "|".join(sorted(_NUMBER_WORD, key=len, reverse=True)) + r")"
    r"(?:[\s-]+(?:" + "|".join(sorted(_NUMBER_WORD, key=len, reverse=True)) + r"))*)"
    r"\s*(?P<post>naira|dollars?|pounds?|euros?)",
    re.IGNORECASE,
)


def extract_money(text: str, block_id: str) -> list[Entity]:
    out: list[Entity] = []
    taken: list[tuple[int, int]] = []

    for m in _MONEY_RE.finditer(text):
        pre, post = m.group("pre"), m.group("post")
        if not pre and not post:
            continue  # a bare number is not money
        amount = parse_number(m.group("amount"))
        if amount is None:
            continue
        mult = (m.group("mult") or "").lower()
        if mult:
            amount *= _MULTIPLIER_WORDS[mult]
        code = _currency_code(pre) or _currency_code(post)
        span = (m.start(), m.end())
        taken.append(span)
        out.append(
            Entity(
                type=EntityType.MONEY,
                source_text=m.group(0).strip(),
                char_start=span[0],
                char_end=span[1],
                block_id=block_id,
                value=round(amount, 2),
                currency=code,
                unit=code,
                confidence=1.0 if code else 0.6,
            )
        )

    for m in _WORD_MONEY_RE.finditer(text):
        if any(s <= m.start() < e for s, e in taken):
            continue
        amount = words_to_number(m.group("words"))
        if amount is None:
            continue
        code = _currency_code(m.group("pre")) or _currency_code(m.group("post"))
        out.append(
            Entity(
                type=EntityType.MONEY,
                source_text=m.group(0).strip(),
                char_start=m.start(),
                char_end=m.end(),
                block_id=block_id,
                value=float(amount),
                currency=code,
                unit=code,
                confidence=0.85,
            )
        )
    return out


def _currency_code(token: str | None) -> str | None:
    if not token:
        return None
    token = token.strip()
    if token in _CURRENCY_SYMBOLS:
        return _CURRENCY_SYMBOLS[token]
    low = token.lower()
    if low == "n":
        return "NGN"
    return _CURRENCY_CODES.get(low)


# ------------------------------------------------------------------------ percent

_PERCENT_RE = re.compile(
    r"(?P<amount>\d+(?:\.\d+)?|(?:" + "|".join(sorted(_NUMBER_WORD, key=len, reverse=True)) + r")"
    r"(?:[\s-]+(?:" + "|".join(sorted(_NUMBER_WORD, key=len, reverse=True)) + r"))*)"
    r"\s*(?:%|per\s?cent(?:age)?)",
    re.IGNORECASE,
)
_RATE_CONTEXT = re.compile(r"\b(interest|late\s+payment|per\s+annum|p\.a\.|apr)\b", re.IGNORECASE)


def extract_percent(text: str, block_id: str) -> list[Entity]:
    out = []
    for m in _PERCENT_RE.finditer(text):
        value = parse_number(m.group("amount"))
        if value is None:
            continue
        window = text[max(0, m.start() - 60) : m.end() + 60]
        etype = EntityType.INTEREST_RATE if _RATE_CONTEXT.search(window) else EntityType.PERCENT
        out.append(
            Entity(
                type=etype,
                source_text=m.group(0).strip(),
                char_start=m.start(),
                char_end=m.end(),
                block_id=block_id,
                value=float(value),
                unit="percent",
                attrs={"context": _percent_context(window)},
            )
        )
    return out


def _percent_context(window: str) -> str:
    low = window.lower()
    for kw, label in (
        ("upfront", "upfront"), ("up front", "upfront"), ("in advance", "upfront"),
        ("deposit", "deposit"), ("on completion", "on_completion"),
        ("discount", "discount"), ("vat", "tax"), ("tax", "tax"),
        ("commission", "commission"), ("interest", "interest"), ("penalt", "penalty"),
    ):
        if kw in low:
            return label
    return "general"


# -------------------------------------------------------------------------- dates

_MONTHS = {
    "january": 1, "jan": 1, "february": 2, "feb": 2, "march": 3, "mar": 3,
    "april": 4, "apr": 4, "may": 5, "june": 6, "jun": 6, "july": 7, "jul": 7,
    "august": 8, "aug": 8, "september": 9, "sep": 9, "sept": 9, "october": 10, "oct": 10,
    "november": 11, "nov": 11, "december": 12, "dec": 12,
}
_MONTH_ALT = "|".join(sorted(_MONTHS, key=len, reverse=True))

_DATE_DMY = re.compile(
    rf"\b(?P<day>\d{{1,2}})(?:st|nd|rd|th)?\s+(?:of\s+)?(?P<month>{_MONTH_ALT})\.?"
    rf"(?:,?\s+(?P<year>\d{{4}}))?\b",
    re.IGNORECASE,
)
_DATE_MDY = re.compile(
    rf"\b(?P<month>{_MONTH_ALT})\.?\s+(?P<day>\d{{1,2}})(?:st|nd|rd|th)?"
    rf"(?:,?\s+(?P<year>\d{{4}}))?\b",
    re.IGNORECASE,
)
_DATE_NUMERIC = re.compile(r"\b(?P<a>\d{1,4})[/.-](?P<b>\d{1,2})[/.-](?P<c>\d{2,4})\b")


def extract_dates(text: str, block_id: str, default_locale: str = "DMY") -> list[Entity]:
    out: list[Entity] = []
    taken: list[tuple[int, int]] = []

    def add(span, src, y, mo, d, conf, note=None):
        if any(s < span[1] and span[0] < e for s, e in taken):
            return
        taken.append(span)
        attrs = {"kind": _date_kind(text, span[0])}
        if note:
            attrs["note"] = note
        out.append(
            Entity(
                type=EntityType.DATE,
                source_text=src,
                char_start=span[0],
                char_end=span[1],
                block_id=block_id,
                value=f"{y:04d}-{mo:02d}-{d:02d}" if y else f"--{mo:02d}-{d:02d}",
                unit="date",
                confidence=conf,
                attrs=attrs,
            )
        )

    for rx in (_DATE_DMY, _DATE_MDY):
        for m in rx.finditer(text):
            month = _MONTHS[m.group("month").lower().rstrip(".")]
            day = int(m.group("day"))
            if not 1 <= day <= 31:
                continue
            year = int(m.group("year")) if m.group("year") else 0
            add((m.start(), m.end()), m.group(0).strip(), year, month, day,
                1.0 if year else 0.6, None if year else "year not stated")

    for m in _DATE_NUMERIC.finditer(text):
        a, b, c = int(m.group("a")), int(m.group("b")), int(m.group("c"))
        if len(m.group("a")) == 4:  # ISO
            y, mo, d, conf, note = a, b, c, 1.0, None
        else:
            y = c + 2000 if c < 100 else c
            if default_locale == "DMY":
                d, mo = a, b
            else:
                mo, d = a, b
            ambiguous = a <= 12 and b <= 12 and a != b
            conf, note = (0.55, "ambiguous day/month order") if ambiguous else (0.9, None)
        if not (1 <= mo <= 12 and 1 <= d <= 31):
            continue
        add((m.start(), m.end()), m.group(0).strip(), y, mo, d, conf, note)

    out.sort(key=lambda e: e.char_start)
    return out


_DATE_KIND_WORDS = (
    ("commenc", "start"), ("start", "start"), ("effective", "start"), ("begin", "start"),
    ("expir", "end"), ("end", "end"), ("terminat", "end"),
    ("deliver", "delivery"), ("complet", "delivery"), ("go-live", "delivery"),
    ("renew", "renewal"), ("milestone", "milestone"), ("due", "due"),
)


def _date_kind(text: str, at: int) -> str:
    window = text[max(0, at - 90) : at + 40].lower()
    for kw, label in _DATE_KIND_WORDS:
        if kw in window:
            return label
    return "general"


def iso_to_date(value: str) -> date | None:
    try:
        y, m, d = (int(p) for p in value.split("-"))
        return date(y, m, d)
    except (ValueError, TypeError):
        return None


# ----------------------------------------------------------------------- duration

_DURATION_UNITS = {
    "day": "days", "days": "days", "business day": "days", "business days": "days",
    "week": "weeks", "weeks": "weeks", "month": "months", "months": "months",
    "year": "years", "years": "years", "hour": "hours", "hours": "hours",
    "calendar day": "days", "calendar days": "days", "working day": "days",
    "working days": "days",
}
_UNIT_ALT = "|".join(sorted(_DURATION_UNITS, key=len, reverse=True))
_NUM_ALT = "|".join(sorted(_NUMBER_WORD, key=len, reverse=True))

_DURATION_RE = re.compile(
    rf"\b(?P<amount>\d+(?:\.\d+)?|(?:{_NUM_ALT})(?:[\s-]+(?:{_NUM_ALT}))*)"
    rf"[\s-]+(?P<unit>{_UNIT_ALT})\b",
    re.IGNORECASE,
)

_PAYMENT_CONTEXT = re.compile(
    r"\b(invoice|invoices|payment|paid|pay|payable|remit|settle|settlement)\b", re.IGNORECASE
)
_NOTICE_CONTEXT = re.compile(
    r"\b(notice|notify|terminat|cancel)\w*\b", re.IGNORECASE
)
_DURATION_KIND_WORDS = (
    ("support", "support"), ("maintenance", "support"), ("warrant", "warranty"),
    ("deliver", "delivery"), ("complet", "delivery"), ("implement", "delivery"),
    ("renew", "renewal"), ("confidential", "confidentiality"), ("term of", "term"),
    ("cure", "cure"), ("remedy", "cure"),
)


def extract_durations(text: str, block_id: str) -> list[Entity]:
    out = []
    for m in _DURATION_RE.finditer(text):
        amount = parse_number(m.group("amount"))
        if amount is None:
            continue
        unit = _DURATION_UNITS[m.group("unit").lower()]
        window = text[max(0, m.start() - 110) : m.end() + 60]
        if _PAYMENT_CONTEXT.search(window):
            etype, kind = EntityType.PAYMENT_PERIOD, "payment"
        elif _NOTICE_CONTEXT.search(window):
            etype, kind = EntityType.NOTICE_PERIOD, "notice"
        else:
            etype, kind = EntityType.DURATION, _duration_kind(window)
        out.append(
            Entity(
                type=etype,
                source_text=m.group(0).strip(),
                char_start=m.start(),
                char_end=m.end(),
                block_id=block_id,
                value=float(amount),
                unit=unit,
                attrs={"kind": kind, "days_equivalent": to_days(amount, unit)},
            )
        )
    return out


def _duration_kind(window: str) -> str:
    low = window.lower()
    for kw, label in _DURATION_KIND_WORDS:
        if kw in low:
            return label
    return "general"


_DAYS_PER = {"hours": 1 / 24, "days": 1.0, "weeks": 7.0, "months": 30.0, "years": 365.0}


def to_days(amount: float, unit: str) -> float | None:
    """Rough comparison helper only. Never used to compute calendar dates (TRD §21)."""
    factor = _DAYS_PER.get(unit)
    return round(amount * factor, 2) if factor else None


# --------------------------------------------------------------------- obligation

MODALITY_STRENGTH = {
    "must": 7, "shall": 6, "is required to": 6, "are required to": 6, "required": 6,
    "agrees to": 5, "undertakes to": 5, "will": 4, "is responsible for": 4,
    "are responsible for": 4, "should": 3, "may": 2, "is permitted to": 2,
    "are permitted to": 2, "is entitled to": 2, "are entitled to": 2, "can": 2,
    "at its discretion": 1, "optional": 1, "recommended": 2, "endeavour": 2,
    "endeavor": 2, "reasonable efforts": 2,
}
_MODAL_ALT = "|".join(sorted(MODALITY_STRENGTH, key=len, reverse=True))

_ROLE_WORDS = (
    "supplier", "vendor", "client", "customer", "contractor", "consultant",
    "provider", "service provider", "company", "partner", "licensee", "licensor",
    "buyer", "seller", "purchaser", "employer", "employee", "tenant", "landlord",
    "lessee", "lessor", "agency", "developer", "either party", "each party",
    "both parties", "parties", "party",
)
_ROLE_ALT = "|".join(sorted(_ROLE_WORDS, key=len, reverse=True))

_OBLIGATION_RE = re.compile(
    rf"\b(?P<actor>(?:the\s+)?(?:{_ROLE_ALT})|[A-Z][\w&.'-]*(?:\s+[A-Z][\w&.'-]*){{0,3}})"
    rf"\s+(?P<modality>{_MODAL_ALT})\s+(?P<rest>.{{0,220}})",
    re.IGNORECASE,
)
_FREQUENCY_RE = re.compile(
    r"\b(hourly|daily|weekly|fortnightly|bi-weekly|monthly|quarterly|"
    r"semi-annually|annually|yearly|per\s+(?:day|week|month|quarter|year))\b",
    re.IGNORECASE,
)
_NEGATION_RE = re.compile(r"\b(not|never|no longer|refrain from)\b", re.IGNORECASE)


def extract_obligations(text: str, block_id: str) -> list[Entity]:
    out = []
    for m in _OBLIGATION_RE.finditer(text):
        modality = m.group("modality").lower()
        rest = m.group("rest").strip()
        action_m = re.match(r"(not\s+)?([a-z]+(?:\s+[a-z]+)?)", rest, re.IGNORECASE)
        action = (action_m.group(0).strip().lower() if action_m else "")
        actor = re.sub(r"^the\s+", "", m.group("actor").strip(), flags=re.IGNORECASE)
        freq = _FREQUENCY_RE.search(rest)
        out.append(
            Entity(
                type=EntityType.OBLIGATION,
                source_text=m.group(0).strip(),
                char_start=m.start(),
                char_end=m.end(),
                block_id=block_id,
                value=modality,
                unit="modality",
                confidence=0.9,
                attrs={
                    "actor": actor.lower(),
                    "modality": modality,
                    "strength": MODALITY_STRENGTH.get(modality, 3),
                    "action": action,
                    "object": rest[:160],
                    "frequency": freq.group(0).lower() if freq else None,
                    "negated": bool(_NEGATION_RE.match(rest)),
                },
            )
        )
    return _dedupe_overlaps(out)


def _dedupe_overlaps(entities: list[Entity]) -> list[Entity]:
    """Keep the longest match per overlapping span — regex alternatives can double-fire."""
    kept: list[Entity] = []
    for e in sorted(entities, key=lambda x: (x.char_start, -(x.char_end - x.char_start))):
        if any(k.char_start < e.char_end and e.char_start < k.char_end for k in kept):
            continue
        kept.append(e)
    return kept


# ------------------------------------------------------------------------ top API


def extract_entities(block: Block, locale: str = "DMY") -> list[Entity]:
    text = block.text
    bid = block.id
    found = (
        extract_money(text, bid)
        + extract_percent(text, bid)
        + extract_dates(text, bid, locale)
        + extract_durations(text, bid)
        + extract_obligations(text, bid)
    )
    found.sort(key=lambda e: (e.char_start, e.type.value))
    return found


def entities_for(blocks: list[Block], locale: str = "DMY") -> dict[str, list[Entity]]:
    return {b.id: extract_entities(b, locale) for b in blocks}
