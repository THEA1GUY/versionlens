"""Canonical change object (TRD §28) plus category/importance vocabulary."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any

from .model import Citation


class ChangeType(str, Enum):
    ADDED = "ADDED"
    REMOVED = "REMOVED"
    MODIFIED = "MODIFIED"
    MEANING_CHANGED = "MEANING_CHANGED"
    MOVED = "MOVED"
    SECTION_ADDED = "SECTION_ADDED"
    SECTION_REMOVED = "SECTION_REMOVED"
    SECTION_RENAMED = "SECTION_RENAMED"


class Category(str, Enum):
    PRICING = "PRICING"
    PAYMENT_TERMS = "PAYMENT_TERMS"
    SCOPE = "SCOPE"
    DATES = "DATES"
    DURATION = "DURATION"
    OBLIGATIONS = "OBLIGATIONS"
    RIGHTS = "RIGHTS"
    RESPONSIBILITIES = "RESPONSIBILITIES"
    TERMINATION = "TERMINATION"
    LIABILITY = "LIABILITY"
    RENEWAL = "RENEWAL"
    CONFIDENTIALITY = "CONFIDENTIALITY"
    GOVERNING_TERMS = "GOVERNING_TERMS"
    WORDING = "WORDING"
    FORMATTING = "FORMATTING"


class Importance(str, Enum):
    HIGH = "HIGH"
    MEDIUM = "MEDIUM"
    LOW = "LOW"


class ReviewStatus(str, Enum):
    UNREVIEWED = "unreviewed"
    CONFIRMED = "confirmed"
    FALSE_ALERT = "false_alert"
    NEEDS_DISCUSSION = "needs_discussion"
    RESOLVED = "resolved"


# TRD §30 — rule-based importance scoring, surfaced to users as "review priority".
CATEGORY_WEIGHT: dict[Category, int] = {
    Category.PRICING: 4,
    Category.PAYMENT_TERMS: 4,
    Category.TERMINATION: 4,
    Category.LIABILITY: 4,
    Category.SCOPE: 3,
    Category.DATES: 3,
    Category.DURATION: 3,
    Category.OBLIGATIONS: 3,
    Category.RESPONSIBILITIES: 3,
    Category.RIGHTS: 3,
    Category.RENEWAL: 3,
    Category.CONFIDENTIALITY: 3,
    Category.GOVERNING_TERMS: 3,
    Category.WORDING: 1,
    Category.FORMATTING: 0,
}

# Keywords used to tag a change by the subject matter of its surrounding text.
CATEGORY_KEYWORDS: list[tuple[Category, tuple[str, ...]]] = [
    (Category.PRICING, ("price", "pricing", "fee", "fees", "cost", "charge", "rate card",
                        "discount", "commission", "deposit", "tax", "vat", "penalty",
                        "total contract value", "consideration")),
    (Category.PAYMENT_TERMS, ("payment", "invoice", "invoices", "payable", "paid",
                              "upfront", "instalment", "installment", "milestone payment",
                              "remit", "interest on late")),
    (Category.TERMINATION, ("terminate", "termination", "cancel", "cancellation",
                            "notice period", "breach", "wind down", "exit")),
    (Category.LIABILITY, ("liability", "liable", "indemnif", "damages", "warrant",
                          "guarantee", "force majeure", "cap on")),
    (Category.CONFIDENTIALITY, ("confidential", "non-disclosure", "nda",
                                "proprietary information", "data protection",
                                "personal data", "gdpr", "privacy", "data processing")),
    (Category.RENEWAL, ("renew", "renewal", "extension", "auto-renew", "evergreen")),
    (Category.GOVERNING_TERMS, ("governing law", "jurisdiction", "arbitration",
                                "dispute resolution", "venue", "applicable law")),
    (Category.SCOPE, ("scope", "deliverable", "deliverables", "service", "services",
                      "training", "support", "maintenance", "exclusion", "excluded",
                      "included", "workshop", "report", "reporting", "sla")),
    (Category.DATES, ("date", "deadline", "commence", "effective", "expiry", "expire",
                      "go-live", "milestone", "schedule")),
    (Category.RESPONSIBILITIES, ("responsible", "responsibilit", "accountable", "owner",
                                 "assign", "delegate", "duties", "point of contact")),
]


@dataclass
class Change:
    id: str
    type: ChangeType
    category: Category
    categories: list[Category]
    summary: str
    importance: Importance = Importance.LOW
    importance_score: float = 0.0
    confidence: float = 0.0
    confidence_label: str = "Low confidence"
    old_value: dict[str, Any] | None = None
    new_value: dict[str, Any] | None = None
    delta: dict[str, Any] | None = None
    direction: str | None = None
    citation_a: Citation | None = None
    citation_b: Citation | None = None
    text_a: str = ""
    text_b: str = ""
    word_diff: list[dict[str, Any]] = field(default_factory=list)
    detectors: list[str] = field(default_factory=list)
    section_a: str | None = None
    section_b: str | None = None
    notes: list[str] = field(default_factory=list)
    review_status: ReviewStatus = ReviewStatus.UNREVIEWED
    confidence_signals: dict[str, float] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "type": self.type.value,
            "category": self.category.value,
            "categories": [c.value for c in self.categories],
            "summary": self.summary,
            "importance": self.importance.value,
            "importance_score": self.importance_score,
            "confidence": self.confidence,
            "confidence_label": self.confidence_label,
            "confidence_signals": self.confidence_signals,
            "old_value": self.old_value,
            "new_value": self.new_value,
            "delta": self.delta,
            "direction": self.direction,
            "citation_a": self.citation_a.to_dict() if self.citation_a else None,
            "citation_b": self.citation_b.to_dict() if self.citation_b else None,
            "text_a": self.text_a,
            "text_b": self.text_b,
            "word_diff": self.word_diff,
            "detectors": self.detectors,
            "section_a": self.section_a,
            "section_b": self.section_b,
            "notes": self.notes,
            "review_status": self.review_status.value,
        }


def categorize_text(*texts: str) -> list[Category]:
    """Tag by subject matter. Returns [] when nothing matches so callers can fall back."""
    blob = " ".join(t.lower() for t in texts if t)
    hits: list[Category] = []
    for category, keywords in CATEGORY_KEYWORDS:
        if any(kw in blob for kw in keywords):
            hits.append(category)
    return hits
