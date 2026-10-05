"""Change reconciliation and citation binding (TRD §26-28).

Three detectors can see the same edit. This module makes them one change object with a
`detectors` list, rather than three alerts about the same sentence, and attaches
citations built from real block IDs.
"""

from __future__ import annotations

from itertools import count
from typing import Any, Iterable

from rapidfuzz import fuzz

from .align import BlockAlignment, SectionAlignment
from .changes import Category, Change, ChangeType, Importance, categorize_text
from .diff import changed_fragments, is_cosmetic, word_diff
from .entities import Entity, EntityType
from .model import Block, BlockType, Citation, Document
from .score import confidence, confidence_label, importance
from .segment import section_path
from .semantic import SemanticFinding
from .structured import StructuredFinding, compare_entities

# A modified passage is sent to the semantic layer only when it looks like it could be a
# meaning change the deterministic layers cannot settle on their own.
_MODALITY_HINTS = (
    "shall", "must", "may", "will", "should", "required", "obliged", "entitled",
    "permitted", "responsible", "agrees", "undertakes", "reasonable", "endeavour",
    "endeavor", "discretion", "sole", "where applicable", "if requested", "as needed",
    "subject to", "at its option", "best efforts", "not", "no longer", "exclusive",
)
_SEMANTIC_MIN_RATIO = 0.04
_SEMANTIC_MAX_CANDIDATES = 80

# Only exact values are safe to compare across a section's leftover blocks. Obligations
# need true clause alignment — pairing two unrelated clauses' modalities invents changes.
# Table rows are excluded too: a row's identity is its first cell, and row add/remove is
# already reported, so pairing a dropped row's price with a new row's price is nonsense.
_FALLBACK_TYPES = frozenset(
    {
        EntityType.MONEY,
        EntityType.DATE,
        EntityType.DURATION,
        EntityType.PERCENT,
        EntityType.PAYMENT_PERIOD,
        EntityType.NOTICE_PERIOD,
        EntityType.INTEREST_RATE,
    }
)


class ChangeBuilder:
    def __init__(self, doc_a: Document, doc_b: Document) -> None:
        self.doc_a = doc_a
        self.doc_b = doc_b
        self._ids = count(1)

    def _next_id(self) -> str:
        return f"chg_{next(self._ids):05d}"

    # ------------------------------------------------------------- citations

    def citation(
        self,
        block: Block | None,
        side: str,
        span: tuple[int, int] | None = None,
    ) -> Citation | None:
        """Built from the document model only — a model never supplies these."""
        if block is None:
            return None
        doc = self.doc_a if side == "A" else self.doc_b
        start, end = span if span else (0, len(block.text))
        start = max(0, min(start, len(block.text)))
        end = max(start, min(end, len(block.text)))
        return Citation(
            document_version=side,  # type: ignore[arg-type]
            block_id=block.id,
            page=block.page,
            section=section_path(doc, block.section_id),
            char_start=start,
            char_end=end,
            text=block.text[start:end] if span else block.text,
            bbox=block.bbox,
        )

    # ---------------------------------------------------------------- build

    def build(
        self,
        block_alignments: list[BlockAlignment],
        section_alignments: list[SectionAlignment],
        ents_a: dict[str, list[Entity]],
        ents_b: dict[str, list[Entity]],
        semantic: dict[str, SemanticFinding] | None = None,
    ) -> list[Change]:
        semantic = semantic or {}
        changes: list[Change] = []

        # A wholly added or removed section is reported once, by the section layer. Its
        # individual blocks must not also be listed, or one removed clause becomes three
        # alerts (TRD §27).
        suppressed = _blocks_in_whole_sections(section_alignments, self.doc_a, self.doc_b)

        unpaired_a: dict[str, list[Block]] = {}
        unpaired_b: dict[str, list[Block]] = {}

        for al in block_alignments:
            if al.status == "UNCHANGED":
                continue
            block = al.block_b or al.block_a
            if block and block.id in suppressed:
                continue
            if al.status == "MODIFIED":
                changes.extend(self._modified(al, ents_a, ents_b, semantic))
            elif al.status == "ADDED":
                changes.append(self._added_or_removed(al, ents_b, added=True))
                if al.section_alignment and al.section_alignment.status == "MATCHED":
                    unpaired_b.setdefault(_section_pair_key(al.section_alignment), []).append(
                        al.block_b
                    )
            elif al.status == "REMOVED":
                changes.append(self._added_or_removed(al, ents_a, added=False))
                if al.section_alignment and al.section_alignment.status == "MATCHED":
                    unpaired_a.setdefault(_section_pair_key(al.section_alignment), []).append(
                        al.block_a
                    )
            elif al.status == "MOVED":
                changes.extend(self._moved(al, ents_a, ents_b, semantic))

        changes.extend(
            self._section_structured_fallback(
                section_alignments, unpaired_a, unpaired_b, ents_a, ents_b
            )
        )
        changes.extend(self._section_level(section_alignments, block_alignments))
        for change in changes:
            change.importance, change.importance_score = importance(change)
        changes.sort(key=_sort_key)
        return changes

    # ------------------------------------------------------------- modified

    def _modified(
        self,
        al: BlockAlignment,
        ents_a: dict[str, list[Entity]],
        ents_b: dict[str, list[Entity]],
        semantic: dict[str, SemanticFinding],
    ) -> list[Change]:
        a, b = al.block_a, al.block_b
        assert a and b
        ops = word_diff(a.text, b.text)
        findings = compare_entities(a, b, ents_a.get(a.id, []), ents_b.get(b.id, []))
        sem = semantic.get(pair_id(al))
        align_conf = al.section_alignment.confidence if al.section_alignment else 0.8

        out: list[Change] = [
            self._from_structured(f, al, ops, align_conf, sem) for f in findings
        ]

        residual = _residual_fragments(ops, findings)
        cosmetic = is_cosmetic(a.text, b.text)
        meaning = bool(sem and sem.meaning_changed)

        if not residual and not meaning:
            if out:
                return out
            if cosmetic:
                return [self._cosmetic(al, ops, align_conf)]
            return out

        if cosmetic and not meaning:
            return out + [self._cosmetic(al, ops, align_conf)]

        before, after = changed_fragments(ops)
        categories = _categories(a.text, b.text, default=Category.WORDING)
        if meaning and sem and sem.category:
            categories = _merge_categories([sem.category], categories)

        summary = (
            sem.summary
            if meaning and sem and sem.summary
            else _rewrite_summary(before, after)
        )
        detectors = ["text_diff"] + (["semantic_analysis"] if sem else [])
        score, signals = confidence(
            alignment=align_conf,
            diff=min(1.0, 0.55 + al.similarity * 0.4),
            extraction=None,
            semantic=sem.confidence if sem else None,
        )
        change = Change(
            id=self._next_id(),
            type=ChangeType.MEANING_CHANGED if meaning else ChangeType.MODIFIED,
            category=categories[0],
            categories=categories,
            summary=summary,
            confidence=score,
            confidence_label=confidence_label(score),
            confidence_signals=signals,
            old_value={"value": before, "unit": "text"} if before else None,
            new_value={"value": after, "unit": "text"} if after else None,
            direction="meaning_changed" if meaning else "text_modified",
            citation_a=self.citation(a, "A"),
            citation_b=self.citation(b, "B"),
            text_a=a.text,
            text_b=b.text,
            word_diff=ops,
            detectors=detectors,
            section_a=self._section_label(self.doc_a, a),
            section_b=self._section_label(self.doc_b, b),
        )
        if meaning and sem:
            change.notes.append("Meaning change flagged by semantic analysis. Review recommended.")
        out.append(change)
        return out

    def _from_structured(
        self,
        finding: StructuredFinding,
        al: BlockAlignment,
        ops: list[dict[str, Any]],
        align_conf: float,
        sem: SemanticFinding | None,
    ) -> Change:
        a, b = al.block_a, al.block_b
        span_a = _entity_span(finding.entity_a)
        span_b = _entity_span(finding.entity_b)
        categories = _merge_categories(
            [finding.category],
            _categories(a.text if a else "", b.text if b else "", default=finding.category),
        )
        detectors = ["structured_extraction", "text_diff"]
        semantic_conf = None
        if sem and sem.meaning_changed:
            detectors.append("semantic_analysis")
            semantic_conf = sem.confidence

        score, signals = confidence(
            alignment=align_conf,
            diff=min(1.0, 0.6 + al.similarity * 0.4),
            extraction=finding.confidence,
            semantic=semantic_conf,
        )
        change_type = (
            ChangeType.ADDED
            if finding.old_value is None
            else ChangeType.REMOVED
            if finding.new_value is None
            else ChangeType.MODIFIED
        )
        return Change(
            id=self._next_id(),
            type=change_type,
            category=categories[0],
            categories=categories,
            summary=finding.summary,
            confidence=score,
            confidence_label=confidence_label(score),
            confidence_signals=signals,
            old_value=finding.old_value,
            new_value=finding.new_value,
            delta=finding.delta or None,
            direction=finding.direction,
            citation_a=self.citation(a, "A", span_a),
            citation_b=self.citation(b, "B", span_b),
            text_a=a.text if a else "",
            text_b=b.text if b else "",
            word_diff=ops,
            detectors=detectors,
            section_a=self._section_label(self.doc_a, a),
            section_b=self._section_label(self.doc_b, b),
        )

    def _cosmetic(
        self, al: BlockAlignment, ops: list[dict[str, Any]], align_conf: float
    ) -> Change:
        a, b = al.block_a, al.block_b
        score, signals = confidence(alignment=align_conf, diff=1.0, extraction=None, semantic=None)
        return Change(
            id=self._next_id(),
            type=ChangeType.MODIFIED,
            category=Category.FORMATTING,
            categories=[Category.FORMATTING],
            summary="Formatting or punctuation only — no wording change detected.",
            confidence=score,
            confidence_label=confidence_label(score),
            confidence_signals=signals,
            direction="formatting",
            citation_a=self.citation(a, "A"),
            citation_b=self.citation(b, "B"),
            text_a=a.text if a else "",
            text_b=b.text if b else "",
            word_diff=ops,
            detectors=["text_diff"],
            section_a=self._section_label(self.doc_a, a),
            section_b=self._section_label(self.doc_b, b),
        )

    # -------------------------------------------------------- added/removed

    def _added_or_removed(
        self, al: BlockAlignment, ents: dict[str, list[Entity]], added: bool
    ) -> Change:
        block = al.block_b if added else al.block_a
        assert block
        entities = ents.get(block.id, [])
        # The owning section heading says what the clause is about more reliably than the
        # clause's own words: "must provide weekly reports" under "Responsibilities" is a
        # responsibilities change, not a generic scope change. Subject matter leads
        # overall — a removed training clause is a scope change that happens to contain
        # an obligation, not an obligation change that mentions training.
        doc = self.doc_b if added else self.doc_a
        heading = (doc.section(block.section_id).heading if doc.section(block.section_id) else "")
        categories = _merge_categories(
            categorize_text(heading),
            _merge_categories(
                _categories(block.text, default=Category.SCOPE), _entity_categories(entities)
            ),
        )
        verb = "added" if added else "removed"
        align_conf = al.section_alignment.confidence if al.section_alignment else 0.7
        if block.block_type is BlockType.TABLE_ROW and block.cells:
            label = block.cells[0] or "(unnamed)"
            rest = ", ".join(c for c in block.cells[1:] if c)
            headline = f"Table row {verb}: {label}" + (f" ({rest})" if rest else "")
        else:
            headline = f"Content {verb}: {_shorten(block.text)}"
        score, signals = confidence(
            alignment=align_conf,
            diff=1.0,
            extraction=0.95 if entities else None,
            semantic=None,
        )
        value = {"value": block.text, "unit": "text"}
        return Change(
            id=self._next_id(),
            type=ChangeType.ADDED if added else ChangeType.REMOVED,
            category=categories[0],
            categories=categories,
            summary=headline,
            confidence=score,
            confidence_label=confidence_label(score),
            confidence_signals=signals,
            old_value=None if added else value,
            new_value=value if added else None,
            direction=f"content_{verb}",
            citation_a=None if added else self.citation(block, "A"),
            citation_b=self.citation(block, "B") if added else None,
            text_a="" if added else block.text,
            text_b=block.text if added else "",
            word_diff=word_diff("" if added else block.text, block.text if added else ""),
            detectors=["text_diff"] + (["structured_extraction"] if entities else []),
            section_a=None if added else self._section_label(self.doc_a, block),
            section_b=self._section_label(self.doc_b, block) if added else None,
        )

    # ----------------------------------------------------------------- moved

    def _moved(
        self,
        al: BlockAlignment,
        ents_a: dict[str, list[Entity]],
        ents_b: dict[str, list[Entity]],
        semantic: dict[str, SemanticFinding],
    ) -> list[Change]:
        a, b = al.block_a, al.block_b
        assert a and b
        ops = word_diff(a.text, b.text)
        score, signals = confidence(
            alignment=al.similarity, diff=al.similarity, extraction=None, semantic=None
        )
        categories = _categories(a.text, b.text, default=Category.SCOPE)
        moved = Change(
            id=self._next_id(),
            type=ChangeType.MOVED,
            category=categories[0],
            categories=categories,
            summary=f"Content moved from {self._section_label(self.doc_a, a)} (page {a.page}) "
                    f"to {self._section_label(self.doc_b, b)} (page {b.page})."
                    + ("" if al.similarity < 0.999 else " No wording change detected."),
            confidence=score,
            confidence_label=confidence_label(score),
            confidence_signals=signals,
            direction="moved",
            citation_a=self.citation(a, "A"),
            citation_b=self.citation(b, "B"),
            text_a=a.text,
            text_b=b.text,
            word_diff=ops,
            detectors=["text_diff"],
            section_a=self._section_label(self.doc_a, a),
            section_b=self._section_label(self.doc_b, b),
        )
        out = [moved]
        # A moved block can also have been edited; report that separately.
        if al.similarity < 0.999:
            out.extend(self._modified(al, ents_a, ents_b, semantic))
        return out

    # --------------------------------------------------------- section level

    def _section_structured_fallback(
        self,
        section_alignments: list[SectionAlignment],
        unpaired_a: dict[str, list[Block]],
        unpaired_b: dict[str, list[Block]],
        ents_a: dict[str, list[Entity]],
        ents_b: dict[str, list[Entity]],
    ) -> list[Change]:
        """Compare values across a section's *unpaired* blocks.

        When a clause is rewritten so heavily that paragraph pairing fails, the clause is
        reported as one removal plus one addition — correct, but it would lose the exact
        "30 days -> 60 days" delta. Running structured comparison at section scope over
        the leftovers recovers those deltas, which is what the ≥95% recall target on
        amounts, dates and durations depends on.
        """
        out: list[Change] = []
        by_key = {
            _section_pair_key(al): al for al in section_alignments if al.status == "MATCHED"
        }
        for key, al in by_key.items():
            blocks_a = unpaired_a.get(key, [])
            blocks_b = unpaired_b.get(key, [])
            if not blocks_a or not blocks_b:
                continue
            flat_a = [
                e for b in blocks_a if b.block_type is not BlockType.TABLE_ROW
                for e in ents_a.get(b.id, []) if e.type in _FALLBACK_TYPES
            ]
            flat_b = [
                e for b in blocks_b if b.block_type is not BlockType.TABLE_ROW
                for e in ents_b.get(b.id, []) if e.type in _FALLBACK_TYPES
            ]
            if not flat_a or not flat_b:
                continue
            for finding in compare_entities(blocks_a[0], blocks_b[0], flat_a, flat_b):
                # Only value-to-value changes are trustworthy at this scope; a lone
                # added/removed entity is already covered by the add/remove change.
                if finding.old_value is None or finding.new_value is None:
                    continue
                block_a = self.doc_a.block(finding.entity_a.block_id) if finding.entity_a else None
                block_b = self.doc_b.block(finding.entity_b.block_id) if finding.entity_b else None
                score, signals = confidence(
                    alignment=al.confidence,
                    diff=None,
                    extraction=finding.confidence * 0.85,
                    semantic=None,
                )
                categories = _merge_categories(
                    [finding.category],
                    _categories(
                        block_a.text if block_a else "",
                        block_b.text if block_b else "",
                        default=finding.category,
                    ),
                )
                change = Change(
                    id=self._next_id(),
                    type=ChangeType.MODIFIED,
                    category=categories[0],
                    categories=categories,
                    summary=finding.summary,
                    confidence=score,
                    confidence_label=confidence_label(score),
                    confidence_signals=signals,
                    old_value=finding.old_value,
                    new_value=finding.new_value,
                    delta=finding.delta or None,
                    direction=finding.direction,
                    citation_a=self.citation(block_a, "A", _entity_span(finding.entity_a)),
                    citation_b=self.citation(block_b, "B", _entity_span(finding.entity_b)),
                    text_a=block_a.text if block_a else "",
                    text_b=block_b.text if block_b else "",
                    detectors=["structured_extraction"],
                    section_a=self._section_label(self.doc_a, block_a),
                    section_b=self._section_label(self.doc_b, block_b),
                )
                change.notes.append(
                    "Detected by value comparison within the section; the surrounding "
                    "wording was rewritten too heavily to align paragraph by paragraph."
                )
                out.append(change)
        return out

    def _section_level(
        self,
        section_alignments: list[SectionAlignment],
        block_alignments: list[BlockAlignment],
    ) -> list[Change]:
        """One change per wholly added/removed section, instead of per block (PDD §18-19)."""
        out: list[Change] = []
        for al in section_alignments:
            if al.status == "MATCHED":
                renamed = self._renamed(al)
                if renamed:
                    out.append(renamed)
                continue
            added = al.status == "ADDED"
            section = al.section_b if added else al.section_a
            if not section:
                continue
            doc = self.doc_b if added else self.doc_a
            blocks = doc.blocks_of(section.id)
            if not blocks:
                continue
            body = " ".join(b.text for b in blocks)
            # The heading names the subject; body text mentions many topics in passing,
            # so it only decides the category when the heading says nothing.
            categories = _merge_categories(
                categorize_text(section.heading),
                _categories(body, default=Category.SCOPE),
            )
            score, signals = confidence(alignment=0.95, diff=1.0, extraction=None, semantic=None)
            verb = "added" if added else "removed"
            out.append(
                Change(
                    id=self._next_id(),
                    type=ChangeType.SECTION_ADDED if added else ChangeType.SECTION_REMOVED,
                    category=categories[0],
                    categories=categories,
                    summary=f"Section {verb}: {section.label} "
                            f"({len(blocks)} block{'s' if len(blocks) != 1 else ''}, "
                            f"page{'s' if section.start_page != section.end_page else ''} "
                            f"{section.start_page}"
                            f"{f'-{section.end_page}' if section.start_page != section.end_page else ''}).",
                    confidence=score,
                    confidence_label=confidence_label(score),
                    confidence_signals=signals,
                    old_value=None if added else {"value": section.label, "unit": "section"},
                    new_value={"value": section.label, "unit": "section"} if added else None,
                    direction=f"section_{verb}",
                    citation_a=None if added else self.citation(blocks[0], "A"),
                    citation_b=self.citation(blocks[0], "B") if added else None,
                    text_a="" if added else _shorten(body, 600),
                    text_b=_shorten(body, 600) if added else "",
                    detectors=["section_alignment"],
                    section_a=None if added else section_path(self.doc_a, section.id),
                    section_b=section_path(self.doc_b, section.id) if added else None,
                )
            )
        return out

    def _renamed(self, al: SectionAlignment) -> Change | None:
        """A renumbered or retitled section: one low-priority note, not a text edit."""
        sa, sb = al.section_a, al.section_b
        if not sa or not sb:
            return None
        heading_changed = sa.normalized_heading != sb.normalized_heading
        number_changed = (sa.section_number or "") != (sb.section_number or "")
        if not heading_changed and not number_changed:
            return None

        if heading_changed:
            summary = f"Section renamed: \"{sa.label}\" → \"{sb.label}\"."
        else:
            summary = f"Section renumbered: \"{sa.label}\" → \"{sb.label}\"."
        categories = _merge_categories(
            categorize_text(sb.heading, sa.heading), [Category.FORMATTING]
        )
        score, signals = confidence(
            alignment=al.confidence, diff=1.0, extraction=None, semantic=None
        )
        blocks_a = self.doc_a.blocks_of(sa.id)
        blocks_b = self.doc_b.blocks_of(sb.id)
        change = Change(
            id=self._next_id(),
            type=ChangeType.SECTION_RENAMED,
            category=Category.FORMATTING if not heading_changed else categories[0],
            categories=[Category.FORMATTING] if not heading_changed else categories,
            summary=summary,
            confidence=score,
            confidence_label=confidence_label(score),
            confidence_signals=signals,
            old_value={"value": sa.label, "unit": "section"},
            new_value={"value": sb.label, "unit": "section"},
            direction="section_renamed" if heading_changed else "section_renumbered",
            citation_a=self.citation(blocks_a[0], "A") if blocks_a else None,
            citation_b=self.citation(blocks_b[0], "B") if blocks_b else None,
            text_a=sa.label,
            text_b=sb.label,
            detectors=["section_alignment"],
            section_a=section_path(self.doc_a, sa.id),
            section_b=section_path(self.doc_b, sb.id),
        )
        change.notes.append(
            f"Matched with {al.confidence:.0%} alignment confidence — the sections' "
            f"content was compared as corresponding."
        )
        return change

    def _section_label(self, doc: Document, block: Block | None) -> str | None:
        if block is None:
            return None
        return section_path(doc, block.section_id)


# ------------------------------------------------------------------- helpers


def _section_pair_key(al: SectionAlignment) -> str:
    return f"{al.section_a.id if al.section_a else '-'}::{al.section_b.id if al.section_b else '-'}"


def _blocks_in_whole_sections(
    section_alignments: list[SectionAlignment], doc_a: Document, doc_b: Document
) -> set[str]:
    out: set[str] = set()
    for al in section_alignments:
        if al.status == "ADDED" and al.section_b:
            out.update(b.id for b in doc_b.blocks_of(al.section_b.id))
        elif al.status == "REMOVED" and al.section_a:
            out.update(b.id for b in doc_a.blocks_of(al.section_a.id))
    return out


def pair_id(al: BlockAlignment) -> str:
    a = al.block_a.id if al.block_a else "-"
    b = al.block_b.id if al.block_b else "-"
    return f"{a}::{b}"


def semantic_candidates(block_alignments: list[BlockAlignment]) -> list[dict[str, str]]:
    """Pick the modified passages where a model adds information (TRD §45 step 14)."""
    scored: list[tuple[float, dict[str, str]]] = []
    for al in block_alignments:
        if al.status not in ("MODIFIED", "MOVED") or not (al.block_a and al.block_b):
            continue
        a, b = al.block_a, al.block_b
        if is_cosmetic(a.text, b.text):
            continue
        ratio = 1.0 - fuzz.ratio(a.normalized, b.normalized) / 100.0
        if ratio < _SEMANTIC_MIN_RATIO:
            continue
        before, after = changed_fragments(word_diff(a.text, b.text))
        blob = f"{before} {after}".lower()
        modality = any(h in blob for h in _MODALITY_HINTS)
        if not modality and ratio < 0.18:
            continue
        priority = ratio + (0.5 if modality else 0.0)
        scored.append(
            (
                priority,
                {
                    "id": pair_id(al),
                    "text_a": a.text,
                    "text_b": b.text,
                    "hint": f"{before} -> {after}" if (before or after) else "",
                },
            )
        )
    scored.sort(key=lambda t: -t[0])
    return [payload for _, payload in scored[:_SEMANTIC_MAX_CANDIDATES]]


def _residual_fragments(
    ops: list[dict[str, Any]], findings: list[StructuredFinding]
) -> list[str]:
    """Changed text not already explained by a structured finding.

    Without this, a price edit would be reported twice: once as a pricing change and
    again as an unexplained wording change on the same sentence.
    """
    covered: list[str] = []
    for f in findings:
        for e in (f.entity_a, f.entity_b):
            if e:
                covered.append(e.source_text.lower())
    residual: list[str] = []
    for op in ops:
        if op["op"] == "equal":
            continue
        for fragment in (op["a"], op["b"]):
            frag = fragment.strip()
            if not frag or not any(c.isalnum() for c in frag):
                continue
            low = frag.lower()
            if any(low in c or c in low for c in covered):
                continue
            if any(fuzz.partial_ratio(low, c) >= 90 for c in covered):
                continue
            residual.append(frag)
    return residual


def _entity_span(entity: Entity | None) -> tuple[int, int] | None:
    if entity is None:
        return None
    return (entity.char_start, entity.char_end)


def _entity_categories(entities: Iterable[Entity]) -> list[Category]:
    mapping = {
        EntityType.MONEY: Category.PRICING,
        EntityType.PERCENT: Category.PRICING,
        EntityType.INTEREST_RATE: Category.PAYMENT_TERMS,
        EntityType.PAYMENT_PERIOD: Category.PAYMENT_TERMS,
        EntityType.NOTICE_PERIOD: Category.TERMINATION,
        EntityType.DATE: Category.DATES,
        EntityType.DURATION: Category.DURATION,
        EntityType.OBLIGATION: Category.OBLIGATIONS,
    }
    out: list[Category] = []
    for e in entities:
        cat = mapping.get(e.type)
        if cat and cat not in out:
            out.append(cat)
    return out


def _categories(*texts: str, default: Category = Category.WORDING) -> list[Category]:
    hits = categorize_text(*texts)
    return hits or [default]


def _merge_categories(primary: list[Category], extra: list[Category]) -> list[Category]:
    out = [c for c in primary if c]
    for c in extra:
        if c and c not in out:
            out.append(c)
    return out or [Category.WORDING]


def _rewrite_summary(before: str, after: str) -> str:
    if before and after:
        return f"Wording changed: \"{_shorten(before, 120)}\" → \"{_shorten(after, 120)}\"."
    if after:
        return f"Text added: \"{_shorten(after, 160)}\"."
    if before:
        return f"Text removed: \"{_shorten(before, 160)}\"."
    return "Text modified."


def _shorten(text: str, limit: int = 180) -> str:
    text = " ".join(text.split())
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


_IMPORTANCE_ORDER = {Importance.HIGH: 0, Importance.MEDIUM: 1, Importance.LOW: 2}


def _sort_key(change: Change) -> tuple:
    page = change.citation_b.page if change.citation_b else (
        change.citation_a.page if change.citation_a else 999
    )
    return (_IMPORTANCE_ORDER[change.importance], -change.importance_score, page, change.id)
