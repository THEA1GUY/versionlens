"""Structured value comparison (TRD §24).

Entities are compared independently of the text diff. That redundancy is deliberate:
if the wording was rewritten so heavily that the diff is unreadable, the amount or
date change is still caught here with an exact numeric delta.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from .changes import Category
from .entities import Entity, EntityType, iso_to_date
from .model import Block

_CURRENCY_GLYPH = {"NGN": "₦", "USD": "$", "GBP": "£", "EUR": "€", "JPY": "¥"}


@dataclass
class StructuredFinding:
    category: Category
    summary: str
    old_value: dict[str, Any] | None
    new_value: dict[str, Any] | None
    delta: dict[str, Any] = field(default_factory=dict)
    direction: str | None = None
    entity_a: Entity | None = None
    entity_b: Entity | None = None
    block_a: Block | None = None
    block_b: Block | None = None
    confidence: float = 1.0


def compare_entities(
    block_a: Block | None,
    block_b: Block | None,
    ents_a: list[Entity],
    ents_b: list[Entity],
) -> list[StructuredFinding]:
    """Pair entities of the same kind in order of appearance, then compare values."""
    findings: list[StructuredFinding] = []
    groups = _group_keys(ents_a) | _group_keys(ents_b)
    for key in sorted(groups):
        list_a = [e for e in ents_a if _group_key(e) == key]
        list_b = [e for e in ents_b if _group_key(e) == key]
        for ea, eb in _zip_longest_pairs(list_a, list_b):
            finding = _compare_pair(ea, eb, block_a, block_b)
            if finding:
                findings.append(finding)
    return findings


def _group_keys(entities: list[Entity]) -> set[str]:
    return {_group_key(e) for e in entities}


def _group_key(e: Entity) -> str:
    """Entities only compare against the same sort of thing in the same role."""
    if e.type is EntityType.MONEY:
        return f"MONEY|{e.currency or '?'}"
    if e.type is EntityType.OBLIGATION:
        return f"OBLIGATION|{e.attrs.get('actor', '')}"
    if e.type in (EntityType.DURATION, EntityType.DATE):
        return f"{e.type.value}|{e.attrs.get('kind', 'general')}"
    if e.type is EntityType.PERCENT:
        return f"PERCENT|{e.attrs.get('context', 'general')}"
    return e.type.value


def _zip_longest_pairs(
    list_a: list[Entity], list_b: list[Entity]
) -> list[tuple[Entity | None, Entity | None]]:
    """Positional pairing, but values that are already equal are matched first so a
    single edit among several amounts does not cascade into spurious differences."""
    remaining_a = list(list_a)
    remaining_b = list(list_b)
    pairs: list[tuple[Entity | None, Entity | None]] = []

    for a in list(remaining_a):
        match = next((b for b in remaining_b if b.value == a.value), None)
        if match is not None:
            remaining_a.remove(a)
            remaining_b.remove(match)
            pairs.append((a, match))

    while remaining_a or remaining_b:
        a = remaining_a.pop(0) if remaining_a else None
        b = remaining_b.pop(0) if remaining_b else None
        pairs.append((a, b))
    return pairs


def _compare_pair(
    ea: Entity | None,
    eb: Entity | None,
    block_a: Block | None,
    block_b: Block | None,
) -> StructuredFinding | None:
    if ea is None and eb is None:
        return None
    if ea and eb and ea.value == eb.value and ea.unit == eb.unit:
        # Same modality can still mean a changed obligation (frequency, negation), so
        # obligations fall through; everything else is genuinely unchanged.
        if ea.type is not EntityType.OBLIGATION:
            return None

    etype = (ea or eb).type
    confidence = min(ea.confidence if ea else 1.0, eb.confidence if eb else 1.0)

    if etype is EntityType.MONEY:
        finding = _compare_money(ea, eb)
    elif etype is EntityType.DATE:
        finding = _compare_date(ea, eb)
    elif etype in (EntityType.DURATION, EntityType.PAYMENT_PERIOD, EntityType.NOTICE_PERIOD):
        finding = _compare_duration(ea, eb)
    elif etype in (EntityType.PERCENT, EntityType.INTEREST_RATE):
        finding = _compare_percent(ea, eb)
    elif etype is EntityType.OBLIGATION:
        finding = _compare_obligation(ea, eb, block_a, block_b)
    else:
        finding = None

    if finding:
        finding.entity_a, finding.entity_b = ea, eb
        finding.block_a, finding.block_b = block_a, block_b
        finding.confidence = min(finding.confidence, confidence)
    return finding


# -------------------------------------------------------------------------- money


def _compare_money(ea: Entity | None, eb: Entity | None) -> StructuredFinding | None:
    if ea is None:
        return StructuredFinding(
            Category.PRICING,
            f"New amount introduced: {_fmt_money(eb)}.",
            None,
            _money_value(eb),
            direction="added",
        )
    if eb is None:
        return StructuredFinding(
            Category.PRICING,
            f"Amount removed: {_fmt_money(ea)}.",
            _money_value(ea),
            None,
            direction="removed",
        )

    old, new = float(ea.value), float(eb.value)
    absolute = round(new - old, 2)
    pct = round((absolute / old) * 100, 2) if old else None
    word = "increased" if absolute > 0 else "decreased"
    delta_text = f"{_fmt_amount(abs(absolute), eb.currency)}"
    pct_text = f" ({'+' if absolute > 0 else '-'}{abs(pct):g}%)" if pct is not None else ""
    return StructuredFinding(
        category=Category.PRICING,
        summary=f"Amount {word} from {_fmt_money(ea)} to {_fmt_money(eb)} — "
                f"{'+' if absolute > 0 else '-'}{delta_text}{pct_text}.",
        old_value=_money_value(ea),
        new_value=_money_value(eb),
        delta={"absolute": absolute, "percentage": pct, "unit": ea.currency or eb.currency},
        direction=f"amount_{word}",
    )


def _money_value(e: Entity | None) -> dict[str, Any] | None:
    if e is None:
        return None
    return {"value": e.value, "currency": e.currency, "unit": e.currency, "source_text": e.source_text}


def _fmt_money(e: Entity) -> str:
    return _fmt_amount(float(e.value), e.currency)


def _fmt_amount(value: float, currency: str | None) -> str:
    glyph = _CURRENCY_GLYPH.get(currency or "", "")
    body = f"{value:,.2f}".rstrip("0").rstrip(".") if value % 1 else f"{value:,.0f}"
    if glyph:
        return f"{glyph}{body}"
    return f"{body} {currency}".strip() if currency else body


# --------------------------------------------------------------------------- date


def _compare_date(ea: Entity | None, eb: Entity | None) -> StructuredFinding | None:
    kind = ((eb or ea).attrs.get("kind") or "general").replace("_", " ")
    label = "Date" if kind == "general" else f"{kind.capitalize()} date"
    if ea is None:
        return StructuredFinding(Category.DATES, f"{label} added: {eb.source_text}.",
                                 None, _date_value(eb), direction="added")
    if eb is None:
        return StructuredFinding(Category.DATES, f"{label} removed: {ea.source_text}.",
                                 _date_value(ea), None, direction="removed")

    da, db = iso_to_date(str(ea.value)), iso_to_date(str(eb.value))
    delta: dict[str, Any] = {}
    direction = "date_changed"
    tail = ""
    if da and db:
        days = (db - da).days
        delta = {"days": days}
        if days:
            direction = "date_later" if days > 0 else "date_earlier"
            tail = f" — moved {abs(days)} day{'s' if abs(days) != 1 else ''} " \
                   f"{'later' if days > 0 else 'earlier'}"
    return StructuredFinding(
        category=Category.DATES,
        summary=f"{label} changed from {ea.source_text} to {eb.source_text}{tail}.",
        old_value=_date_value(ea),
        new_value=_date_value(eb),
        delta=delta,
        direction=direction,
    )


def _date_value(e: Entity | None) -> dict[str, Any] | None:
    if e is None:
        return None
    return {"value": e.value, "unit": "date", "source_text": e.source_text,
            "kind": e.attrs.get("kind")}


# ----------------------------------------------------------------------- duration


_DURATION_CATEGORY = {
    EntityType.PAYMENT_PERIOD: Category.PAYMENT_TERMS,
    EntityType.NOTICE_PERIOD: Category.TERMINATION,
    EntityType.DURATION: Category.DURATION,
}
_KIND_LABEL = {
    "payment": "Payment period",
    "notice": "Notice period",
    "support": "Support period",
    "warranty": "Warranty period",
    "delivery": "Delivery period",
    "renewal": "Renewal period",
    "confidentiality": "Confidentiality period",
    "term": "Term",
    "cure": "Cure period",
    "general": "Duration",
}


def _compare_duration(ea: Entity | None, eb: Entity | None) -> StructuredFinding | None:
    ref = eb or ea
    category = _DURATION_CATEGORY.get(ref.type, Category.DURATION)
    label = _KIND_LABEL.get(ref.attrs.get("kind", "general"), "Duration")

    if ea is None:
        return StructuredFinding(category, f"{label} added: {eb.source_text}.",
                                 None, _duration_value(eb), direction="added")
    if eb is None:
        return StructuredFinding(category, f"{label} removed: {ea.source_text}.",
                                 _duration_value(ea), None, direction="removed")

    old_days = ea.attrs.get("days_equivalent")
    new_days = eb.attrs.get("days_equivalent")
    delta: dict[str, Any] = {}
    direction = "duration_changed"
    tail = ""
    if old_days and new_days:
        diff = round(new_days - old_days, 2)
        pct = round((diff / old_days) * 100, 2) if old_days else None
        delta = {"days": diff, "percentage": pct}
        if diff:
            longer = diff > 0
            direction = "duration_longer" if longer else "duration_shorter"
            if ea.unit == eb.unit:
                unit_diff = abs(round(float(eb.value) - float(ea.value), 2))
                tail = f" — {unit_diff:g} {ea.unit} {'longer' if longer else 'shorter'}"
            else:
                tail = f" — {abs(diff):g} days {'longer' if longer else 'shorter'}"
    return StructuredFinding(
        category=category,
        summary=f"{label} changed from {ea.source_text} to {eb.source_text}{tail}.",
        old_value=_duration_value(ea),
        new_value=_duration_value(eb),
        delta=delta,
        direction=direction,
    )


def _duration_value(e: Entity | None) -> dict[str, Any] | None:
    if e is None:
        return None
    return {"value": e.value, "unit": e.unit, "source_text": e.source_text,
            "kind": e.attrs.get("kind"), "days_equivalent": e.attrs.get("days_equivalent")}


# ------------------------------------------------------------------------ percent

_PERCENT_CATEGORY = {
    "upfront": Category.PAYMENT_TERMS,
    "deposit": Category.PAYMENT_TERMS,
    "on_completion": Category.PAYMENT_TERMS,
    "interest": Category.PAYMENT_TERMS,
    "penalty": Category.PAYMENT_TERMS,
    "discount": Category.PRICING,
    "tax": Category.PRICING,
    "commission": Category.PRICING,
}
_PERCENT_LABEL = {
    "upfront": "Upfront payment share",
    "deposit": "Deposit",
    "on_completion": "Payment on completion",
    "discount": "Discount",
    "tax": "Tax rate",
    "commission": "Commission",
    "interest": "Interest rate",
    "penalty": "Penalty rate",
    "general": "Percentage",
}


def _compare_percent(ea: Entity | None, eb: Entity | None) -> StructuredFinding | None:
    ref = eb or ea
    context = ref.attrs.get("context", "general")
    category = _PERCENT_CATEGORY.get(context, Category.PRICING)
    label = _PERCENT_LABEL.get(context, "Percentage")

    if ea is None:
        return StructuredFinding(category, f"{label} added: {eb.source_text}.",
                                 None, _percent_value(eb), direction="added")
    if eb is None:
        return StructuredFinding(category, f"{label} removed: {ea.source_text}.",
                                 _percent_value(ea), None, direction="removed")

    points = round(float(eb.value) - float(ea.value), 2)
    word = "increased" if points > 0 else "decreased"
    return StructuredFinding(
        category=category,
        summary=f"{label} {word} from {ea.value:g}% to {eb.value:g}% — "
                f"{'+' if points > 0 else '-'}{abs(points):g} percentage points.",
        old_value=_percent_value(ea),
        new_value=_percent_value(eb),
        delta={"percentage_points": points},
        direction=f"percent_{word}",
    )


def _percent_value(e: Entity | None) -> dict[str, Any] | None:
    if e is None:
        return None
    return {"value": e.value, "unit": "percent", "source_text": e.source_text,
            "context": e.attrs.get("context")}


# ---------------------------------------------------------------------- obligation


def _compare_obligation(
    ea: Entity | None, eb: Entity | None, block_a: Block | None, block_b: Block | None
) -> StructuredFinding | None:
    if ea is None or eb is None:
        ref = ea or eb
        added = ea is None
        actor = (ref.attrs.get("actor") or "a party").title()
        verb = "added" if added else "removed"
        return StructuredFinding(
            category=Category.OBLIGATIONS,
            summary=f"Obligation {verb}: {actor} {ref.attrs.get('modality')} "
                    f"{ref.attrs.get('action')}.",
            old_value=None if added else _obligation_value(ref),
            new_value=_obligation_value(ref) if added else None,
            direction=f"obligation_{verb}",
        )

    sa, sb = ea.attrs.get("strength", 3), eb.attrs.get("strength", 3)
    freq_a, freq_b = ea.attrs.get("frequency"), eb.attrs.get("frequency")
    neg_a, neg_b = ea.attrs.get("negated"), eb.attrs.get("negated")

    if sa == sb and freq_a == freq_b and neg_a == neg_b:
        return None

    parts: list[str] = []
    direction = "obligation_changed"
    if sa != sb:
        weaker = sb < sa
        direction = "obligation_weakened" if weaker else "obligation_strengthened"
        kind = "mandatory" if sa >= 5 else "advisory" if sa >= 3 else "permissive"
        kind_b = "mandatory" if sb >= 5 else "advisory" if sb >= 3 else "permissive"
        parts.append(
            f"Requirement language changed from \"{ea.attrs.get('modality')}\" ({kind}) "
            f"to \"{eb.attrs.get('modality')}\" ({kind_b})"
        )
    if freq_a != freq_b:
        parts.append(f"frequency changed from {freq_a or 'unstated'} to {freq_b or 'unstated'}")
    if neg_a != neg_b:
        parts.append("the obligation was negated" if neg_b else "a negation was removed")

    actor = (eb.attrs.get("actor") or "party").title()
    return StructuredFinding(
        category=Category.OBLIGATIONS,
        summary=f"{actor}: " + "; ".join(parts) + ".",
        old_value=_obligation_value(ea),
        new_value=_obligation_value(eb),
        delta={"strength_change": sb - sa},
        direction=direction,
        confidence=0.9,
    )


def _obligation_value(e: Entity) -> dict[str, Any]:
    return {
        "value": e.attrs.get("modality"),
        "unit": "modality",
        "source_text": e.source_text,
        "actor": e.attrs.get("actor"),
        "action": e.attrs.get("action"),
        "strength": e.attrs.get("strength"),
        "frequency": e.attrs.get("frequency"),
    }
