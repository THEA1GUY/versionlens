"""Confidence and review-priority scoring (TRD §29-30).

Confidence is mostly deterministic on purpose: a model's self-reported certainty is one
of four signals, never the whole score.
"""

from __future__ import annotations

from .changes import CATEGORY_WEIGHT, Category, Change, ChangeType, Importance

W_ALIGNMENT = 0.20
W_DIFF = 0.25
W_EXTRACTION = 0.30
W_SEMANTIC = 0.25


def confidence(
    alignment: float | None,
    diff: float | None,
    extraction: float | None,
    semantic: float | None,
) -> tuple[float, dict[str, float]]:
    """Weighted mean over the signals that actually fired, renormalised.

    A change found by structured extraction alone still scores well, because that
    detector is exact. A change supported only by a model's opinion cannot exceed the
    semantic weight on its own.
    """
    parts = [
        ("alignment", alignment, W_ALIGNMENT),
        ("diff", diff, W_DIFF),
        ("extraction", extraction, W_EXTRACTION),
        ("semantic", semantic, W_SEMANTIC),
    ]
    present = [(name, value, weight) for name, value, weight in parts if value is not None]
    signals = {name: round(value, 4) for name, value, _ in present}
    if not present:
        return 0.0, signals
    total_weight = sum(weight for _, _, weight in present)
    score = sum(value * weight for _, value, weight in present) / total_weight
    return round(max(0.0, min(1.0, score)), 4), signals


def confidence_label(score: float) -> str:
    """UI never shows fake precision (PDD §25)."""
    if score >= 0.80:
        return "High confidence"
    if score >= 0.55:
        return "Medium confidence"
    return "Low confidence"


# Magnitude thresholds that lift a change into the high-attention bucket.
_BIG_PERCENT = 10.0
_BIG_DAYS = 14.0


def importance(change: Change) -> tuple[Importance, float]:
    score = float(max((CATEGORY_WEIGHT.get(c, 1) for c in change.categories), default=1))

    if change.type in (ChangeType.SECTION_ADDED, ChangeType.SECTION_REMOVED):
        score += 2
    elif change.type in (ChangeType.ADDED, ChangeType.REMOVED):
        score += 1
    elif change.type is ChangeType.MEANING_CHANGED:
        score += 1
    elif change.type is ChangeType.MOVED:
        score -= 2
    elif change.type is ChangeType.SECTION_RENAMED:
        score = min(score, 1.0)  # a label change, not a term change

    delta = change.delta or {}
    pct = delta.get("percentage")
    if isinstance(pct, (int, float)) and abs(pct) >= _BIG_PERCENT:
        score += 1
    days = delta.get("days")
    if isinstance(days, (int, float)) and abs(days) >= _BIG_DAYS:
        score += 1
    points = delta.get("percentage_points")
    if isinstance(points, (int, float)) and abs(points) >= _BIG_PERCENT:
        score += 1
    strength = delta.get("strength_change")
    if isinstance(strength, (int, float)) and abs(strength) >= 2:
        score += 1

    if change.categories == [Category.FORMATTING]:
        score = 0.0
    elif change.categories == [Category.WORDING] and change.type is not ChangeType.MEANING_CHANGED:
        score = min(score, 1.0)

    if score >= 4:
        level = Importance.HIGH
    elif score >= 2:
        level = Importance.MEDIUM
    else:
        level = Importance.LOW
    return level, round(score, 2)
