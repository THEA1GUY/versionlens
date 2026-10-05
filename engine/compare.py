"""Comparison orchestrator — the pipeline in TRD §45, with progress reporting."""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any, Callable

from .align import align_blocks, align_sections
from .changes import Category, Change, ChangeType, Importance
from .entities import entities_for
from .extract import extract
from .model import ENGINE_VERSION, EXTRACTION_VERSION, Document, ExtractionStatus
from .reconcile import ChangeBuilder, semantic_candidates
from .segment import leaf_sections, section_path, segment
from .semantic import SemanticAnalyzer

DISCLAIMER = (
    "VersionLens helps users identify differences between document versions. Its output "
    "is intended as a review aid and does not constitute legal advice. Important contracts "
    "and legal documents should be reviewed by a qualified professional."
)


class Stage(str, Enum):
    UPLOADED = "UPLOADED"
    EXTRACTING = "EXTRACTING"
    SEGMENTING = "SEGMENTING"
    ALIGNING = "ALIGNING"
    DIFFING = "DIFFING"
    ANALYZING = "ANALYZING"
    GENERATING_RESULTS = "GENERATING_RESULTS"
    COMPLETED = "COMPLETED"
    PARTIAL = "PARTIAL"
    FAILED = "FAILED"


ProgressFn = Callable[[Stage, str], None]


@dataclass
class ComparisonResult:
    status: Stage
    changes: list[Change]
    summary: dict[str, Any]
    section_map: list[dict[str, Any]]
    documents: dict[str, Any]
    warnings: list[str]
    audit: dict[str, Any]
    disclaimer: str = DISCLAIMER
    error: str | None = None
    doc_a: Document | None = field(default=None, repr=False)
    doc_b: Document | None = field(default=None, repr=False)

    def to_dict(self) -> dict[str, Any]:
        return {
            "status": self.status.value,
            "disclaimer": self.disclaimer,
            "summary": self.summary,
            "section_map": self.section_map,
            "documents": self.documents,
            "warnings": self.warnings,
            "audit": self.audit,
            "error": self.error,
            "changes": [c.to_dict() for c in self.changes],
        }


def compare_documents(
    path_a: str | Path,
    path_b: str | Path,
    *,
    label_a: str = "Version A",
    label_b: str = "Version B",
    analyzer: SemanticAnalyzer | None = None,
    use_semantic: bool = True,
    locale: str = "DMY",
    uploaded_by: str | None = None,
    progress: ProgressFn | None = None,
) -> ComparisonResult:
    started = datetime.now(timezone.utc)
    analyzer = analyzer if analyzer is not None else SemanticAnalyzer()

    def report(stage: Stage, message: str) -> None:
        if progress:
            progress(stage, message)

    try:
        report(Stage.EXTRACTING, f"Reading {label_a}")
        doc_a = extract(path_a, "A")
        report(Stage.EXTRACTING, f"Reading {label_b}")
        doc_b = extract(path_b, "B")

        report(Stage.SEGMENTING, "Identifying sections")
        segment(doc_a)
        segment(doc_b)

        ents_a = entities_for(doc_a.blocks, locale)
        ents_b = entities_for(doc_b.blocks, locale)

        report(Stage.ALIGNING, "Aligning corresponding sections")
        section_alignments = align_sections(doc_a, doc_b, ents_a, ents_b)

        report(Stage.DIFFING, "Comparing terms and values")
        block_alignments = align_blocks(doc_a, doc_b, section_alignments)

        semantic_results = {}
        semantic_note: str | None = None
        if use_semantic and analyzer.available:
            candidates = semantic_candidates(block_alignments)
            if candidates:
                report(Stage.ANALYZING, f"Reviewing meaning changes ({len(candidates)} passages)")
                semantic_results = analyzer.analyze(candidates)
                if analyzer.last_error and not semantic_results:
                    semantic_note = (
                        "Semantic analysis was unavailable; results are based on "
                        "deterministic comparison only."
                    )
        elif use_semantic:
            semantic_note = (
                "No analysis model configured; meaning-change detection is limited to "
                "deterministic signals."
            )

        report(Stage.GENERATING_RESULTS, "Building report")
        builder = ChangeBuilder(doc_a, doc_b)
        changes = builder.build(
            block_alignments, section_alignments, ents_a, ents_b, semantic_results
        )

        warnings = list(doc_a.warnings) + list(doc_b.warnings)
        if semantic_note:
            warnings.append(semantic_note)

        finished = datetime.now(timezone.utc)
        status = Stage.PARTIAL if _has_blocking_warning(doc_a, doc_b) else Stage.COMPLETED
        result = ComparisonResult(
            status=status,
            changes=changes,
            summary=build_summary(changes, doc_a, doc_b, label_a, label_b),
            section_map=build_section_map(doc_a, doc_b, section_alignments, changes),
            documents={
                "a": _doc_meta(doc_a, label_a),
                "b": _doc_meta(doc_b, label_b),
            },
            warnings=warnings,
            audit={
                "engine_version": ENGINE_VERSION,
                "extraction_version": EXTRACTION_VERSION,
                "analysis_model_version": analyzer.model_version if use_semantic else "disabled",
                "semantic_calls": analyzer.calls,
                "semantic_tokens_in": analyzer.tokens_in,
                "semantic_tokens_out": analyzer.tokens_out,
                "semantic_error": analyzer.last_error,
                "started_at": started.isoformat(),
                "completed_at": finished.isoformat(),
                "duration_seconds": round((finished - started).total_seconds(), 3),
                "uploaded_by": uploaded_by,
                "locale": locale,
            },
            doc_a=doc_a,
            doc_b=doc_b,
        )
        report(status, "Comparison complete")
        return result
    except Exception as exc:  # noqa: BLE001 - surfaced to the caller as FAILED, not swallowed
        report(Stage.FAILED, str(exc))
        return ComparisonResult(
            status=Stage.FAILED,
            changes=[],
            summary={},
            section_map=[],
            documents={},
            warnings=[],
            audit={
                "engine_version": ENGINE_VERSION,
                "extraction_version": EXTRACTION_VERSION,
                "started_at": started.isoformat(),
            },
            error=f"{type(exc).__name__}: {exc}",
        )


def _has_blocking_warning(doc_a: Document, doc_b: Document) -> bool:
    return any(
        p.status in (ExtractionStatus.SCANNED, ExtractionStatus.UNREADABLE)
        for doc in (doc_a, doc_b)
        for p in doc.pages
    )


def _doc_meta(doc: Document, label: str) -> dict[str, Any]:
    return {
        "label": label,
        "filename": doc.filename,
        "sha256": doc.sha256,
        "page_count": doc.page_count,
        "section_count": len(leaf_sections(doc)),
        "block_count": len(doc.blocks),
        "extraction_version": doc.extraction_version,
        "pages": [
            {
                "page_number": p.page_number,
                "status": p.status.value,
                "extraction_confidence": p.extraction_confidence,
                "note": p.note,
            }
            for p in doc.pages
        ],
    }


# --------------------------------------------------------------------- summary

_MINOR = {Category.FORMATTING, Category.WORDING}


def build_summary(
    changes: list[Change],
    doc_a: Document,
    doc_b: Document,
    label_a: str,
    label_b: str,
) -> dict[str, Any]:
    by_category = Counter()
    for c in changes:
        for cat in c.categories:
            by_category[cat.value] += 1
    by_importance = Counter(c.importance.value for c in changes)
    by_type = Counter(c.type.value for c in changes)

    material = [c for c in changes if not _is_minor(c)]
    minor = [c for c in changes if _is_minor(c)]

    key_changes = [
        {
            "change_id": c.id,
            "category": c.category.value,
            "summary": c.summary,
            "importance": c.importance.value,
            "citation_a": c.citation_a.to_dict() if c.citation_a else None,
            "citation_b": c.citation_b.to_dict() if c.citation_b else None,
        }
        for c in changes
        if c.importance is Importance.HIGH
    ][:12]

    return {
        "headline": _headline(len(changes), len(material), label_a, label_b),
        "total_changes": len(changes),
        "material_changes": len(material),
        "minor_changes": len(minor),
        "high_attention": by_importance.get("HIGH", 0),
        "medium_attention": by_importance.get("MEDIUM", 0),
        "low_attention": by_importance.get("LOW", 0),
        "by_category": dict(by_category),
        "by_type": dict(by_type),
        "key_changes": key_changes,
        "review_progress": {
            "total": len(changes),
            "reviewed": 0,
            "confirmed": 0,
            "false_alerts": 0,
            "needs_discussion": 0,
            "unreviewed": len(changes),
        },
        "identical": _deterministically_identical(doc_a, doc_b),
    }


def _headline(total: int, material: int, label_a: str, label_b: str) -> str:
    if total == 0:
        return f"No differences detected between {label_a} and {label_b}."
    if material == 0:
        return (
            f"No material changes detected. {total} minor formatting or wording "
            f"difference{'s' if total != 1 else ''} found."
        )
    return (
        f"{label_b} contains {total} detected change{'s' if total != 1 else ''} "
        f"compared with {label_a}."
    )


def _is_minor(change: Change) -> bool:
    if change.type is ChangeType.MEANING_CHANGED:
        return False
    if change.type in (ChangeType.SECTION_RENAMED, ChangeType.MOVED):
        return True
    return change.importance is Importance.LOW and set(change.categories) <= _MINOR


def _deterministically_identical(doc_a: Document, doc_b: Document) -> bool:
    """PDD §27 — only claim 'identical' when it is actually provable."""
    if doc_a.sha256 == doc_b.sha256:
        return True
    return [b.normalized for b in doc_a.blocks] == [b.normalized for b in doc_b.blocks]


# ------------------------------------------------------------------ section map


def build_section_map(
    doc_a: Document,
    doc_b: Document,
    section_alignments: list,
    changes: list[Change],
) -> list[dict[str, Any]]:
    """PDD §17 — where the changes are concentrated."""
    counts: Counter[str] = Counter()
    for c in changes:
        for label in (c.section_b, c.section_a):
            if label:
                counts[label] += 1
                break

    rows: list[dict[str, Any]] = []
    for al in section_alignments:
        label_a = section_path(doc_a, al.section_a.id) if al.section_a else None
        label_b = section_path(doc_b, al.section_b.id) if al.section_b else None
        key = label_b or label_a or ""
        rows.append(
            {
                "status": al.status,
                "section_a": label_a,
                "section_b": label_b,
                "page_a": al.section_a.start_page if al.section_a else None,
                "page_b": al.section_b.start_page if al.section_b else None,
                "alignment_confidence": al.confidence,
                "alignment_signals": {k: round(v, 3) for k, v in (al.signals or {}).items()},
                "change_count": counts.get(key, 0),
            }
        )
    return rows
