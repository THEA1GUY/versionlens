"""Section and paragraph alignment (TRD §12-16).

Alignment runs before diffing so that a renumbered or renamed section is recognised
as the same section rather than reported as one big removal plus one big addition.
"""

from __future__ import annotations

import math
import re
from collections import Counter
from dataclasses import dataclass
from typing import Iterable

from rapidfuzz import fuzz

from .entities import Entity
from .model import Block, BlockType, Document, Section
from .normalize import strip_list_marker, tokens

# Weights from TRD §12. `content` stands in for the embedding signal.
# ponytail: lexical content-similarity instead of embeddings — no model dependency, and
# it already separates renamed-but-same-content sections. Swap in embeddings here if
# evaluation shows renamed-section recall is the bottleneck.
W_HEADING = 0.30
W_CONTENT = 0.30
W_ENTITY = 0.15
W_POSITION = 0.15
W_NUMBERING = 0.10

SECTION_MATCH_THRESHOLD = 0.42
BLOCK_MATCH_THRESHOLD = 0.50
MOVE_MATCH_THRESHOLD = 0.85

# Block similarity blends character similarity with rare-word overlap. Lexical
# similarity alone cannot tell a genuine rewrite from two different clauses that share
# a boilerplate opening — measured on real clauses, both score ~0.54. Rare-word overlap
# separates them cleanly, because the rewrite keeps its distinctive nouns.
W_LEXICAL = 0.45
W_CONTENT_IDF = 0.55

_STOPWORDS = frozenset(
    """a an and any are as at be been by for from in into is it its of on or per shall
    that the this to upon which will with within without all such other than then there
    these those have has had not no but if when where whereas hereby herein thereof
    may must should can each either both same more most less least only also"""
    .split()
)
_SUFFIXES = ("ies", "ing", "ed", "es", "s")

# Contract headings get renamed constantly; these families make the heading signal
# survive a rename instead of pushing all the weight onto body text.
HEADING_FAMILIES: list[set[str]] = [
    {"scope", "scope of work", "scope of services", "services", "services to be provided",
     "project scope", "deliverables", "work", "statement of work"},
    {"pricing", "price", "prices", "fees", "commercial terms", "charges", "costs",
     "consideration", "compensation", "remuneration"},
    {"payment", "payment terms", "payments", "invoicing", "invoices", "billing"},
    {"timeline", "delivery", "schedule", "timetable", "milestones", "term",
     "duration", "project timeline", "delivery schedule"},
    {"termination", "cancellation", "termination rights", "exit"},
    {"liability", "limitation of liability", "indemnity", "indemnification",
     "warranties", "warranty", "damages"},
    {"confidentiality", "non disclosure", "nda", "confidential information"},
    {"renewal", "extension", "auto renewal", "automatic renewal"},
    {"governing law", "jurisdiction", "dispute resolution", "disputes", "arbitration",
     "applicable law"},
    {"responsibilities", "obligations", "duties", "client responsibilities",
     "supplier responsibilities", "roles and responsibilities"},
    {"support", "maintenance", "support and maintenance", "service levels", "sla"},
    {"intellectual property", "ip", "ownership", "data ownership", "rights"},
    {"data protection", "privacy", "gdpr", "personal data"},
    {"insurance", "cover", "coverage"},
    {"exclusivity", "non compete", "exclusive rights"},
    {"training", "onboarding", "knowledge transfer"},
]


@dataclass
class SectionAlignment:
    section_a: Section | None
    section_b: Section | None
    confidence: float
    signals: dict[str, float]

    @property
    def status(self) -> str:
        if self.section_a is None:
            return "ADDED"
        if self.section_b is None:
            return "REMOVED"
        return "MATCHED"


@dataclass
class BlockAlignment:
    block_a: Block | None
    block_b: Block | None
    similarity: float
    status: str  # UNCHANGED | MODIFIED | ADDED | REMOVED | MOVED
    section_alignment: SectionAlignment | None = None


# ------------------------------------------------------------------ section level


def align_sections(
    doc_a: Document,
    doc_b: Document,
    ents_a: dict[str, list[Entity]],
    ents_b: dict[str, list[Entity]],
) -> list[SectionAlignment]:
    from .segment import leaf_sections

    secs_a = leaf_sections(doc_a)
    secs_b = leaf_sections(doc_b)

    scored: list[tuple[float, dict[str, float], Section, Section]] = []
    for sa in secs_a:
        text_a = _section_text(doc_a, sa)
        ent_a = _section_entity_keys(doc_a, sa, ents_a)
        for sb in secs_b:
            signals = {
                "heading": _heading_similarity(sa.normalized_heading, sb.normalized_heading),
                "content": _text_similarity(text_a, _section_text(doc_b, sb)),
                "entity": _jaccard(ent_a, _section_entity_keys(doc_b, sb, ents_b)),
                "position": _position_similarity(sa, sb, len(secs_a), len(secs_b)),
                "numbering": _numbering_similarity(sa.section_number, sb.section_number),
            }
            score = (
                signals["heading"] * W_HEADING
                + signals["content"] * W_CONTENT
                + signals["entity"] * W_ENTITY
                + signals["position"] * W_POSITION
                + signals["numbering"] * W_NUMBERING
            )
            scored.append((score, signals, sa, sb))

    # ponytail: greedy best-first assignment, not Hungarian. O(n*m log) and stable in
    # practice because section scores are well separated. Revisit if evaluation shows
    # mis-pairings on documents with many near-identical headings.
    scored.sort(key=lambda t: -t[0])
    used_a: set[str] = set()
    used_b: set[str] = set()
    alignments: list[SectionAlignment] = []
    for score, signals, sa, sb in scored:
        if score < SECTION_MATCH_THRESHOLD or sa.id in used_a or sb.id in used_b:
            continue
        used_a.add(sa.id)
        used_b.add(sb.id)
        alignments.append(SectionAlignment(sa, sb, round(score, 4), signals))

    for sa in secs_a:
        if sa.id not in used_a:
            alignments.append(SectionAlignment(sa, None, 1.0, {}))
    for sb in secs_b:
        if sb.id not in used_b:
            alignments.append(SectionAlignment(None, sb, 1.0, {}))

    alignments.sort(key=lambda al: (
        al.section_a.order_index if al.section_a else (al.section_b.order_index if al.section_b else 0),
        0 if al.section_a else 1,
    ))
    return alignments


def _section_text(doc: Document, section: Section) -> str:
    return " ".join(b.normalized for b in doc.blocks_of(section.id))


def _section_entity_keys(
    doc: Document, section: Section, ents: dict[str, list[Entity]]
) -> set[str]:
    keys: set[str] = set()
    for b in doc.blocks_of(section.id):
        for e in ents.get(b.id, ()):
            keys.add(f"{e.type.value}:{e.value}")
    return keys


def _heading_similarity(a: str, b: str) -> float:
    if not a and not b:
        return 0.5
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0
    lexical = fuzz.token_set_ratio(a, b) / 100.0
    family = 1.0 if _same_family(a, b) else 0.0
    return max(lexical, family * 0.9)


def _same_family(a: str, b: str) -> bool:
    for family in HEADING_FAMILIES:
        if _in_family(a, family) and _in_family(b, family):
            return True
    return False


def _in_family(heading: str, family: set[str]) -> bool:
    if heading in family:
        return True
    return any(term in heading for term in family if len(term) > 4)


def _text_similarity(a: str, b: str) -> float:
    if not a or not b:
        return 0.0
    return fuzz.token_set_ratio(a, b) / 100.0


def _jaccard(a: set[str], b: set[str]) -> float:
    if not a and not b:
        return 0.0
    union = a | b
    return len(a & b) / len(union) if union else 0.0


def _position_similarity(sa: Section, sb: Section, n_a: int, n_b: int) -> float:
    pa = sa.order_index / max(1, n_a)
    pb = sb.order_index / max(1, n_b)
    return max(0.0, 1.0 - abs(pa - pb) * 2.0)


def _numbering_similarity(na: str | None, nb: str | None) -> float:
    if not na or not nb:
        return 0.0
    if na == nb:
        return 1.0
    pa, pb = na.split("."), nb.split(".")
    if len(pa) != len(pb):
        return 0.1
    if len(pa) > 1 and pa[1:] == pb[1:]:
        return 0.7  # same sub-number, parent renumbered
    return 0.2


# -------------------------------------------------------------------- block level


class TermWeights:
    """Document-level inverse document frequency over block text.

    "supplier", "client" and "provide" appear in most blocks of a contract and carry no
    pairing signal; "insurance" or "exclusivity" appear once or twice and carry most of
    it. Weighting the overlap by rarity is what makes a heavy rewrite pair correctly
    while two unrelated clauses sharing an opening phrase do not.
    """

    def __init__(self, blocks: Iterable[Block]) -> None:
        docs = 0
        seen: Counter[str] = Counter()
        for block in blocks:
            terms = content_terms(block.normalized)
            if not terms:
                continue
            docs += 1
            seen.update(set(terms))
        self.total = max(1, docs)
        self._df = seen

    def weight(self, term: str) -> float:
        df = self._df.get(term, 0)
        return math.log((self.total + 1) / (df + 1)) + 0.1

    def overlap(self, terms_a: list[str], terms_b: list[str]) -> float:
        set_a, set_b = set(terms_a), set(terms_b)
        if not set_a or not set_b:
            return 0.0
        shared = sum(self.weight(t) for t in set_a & set_b)
        mass_a = sum(self.weight(t) for t in set_a)
        mass_b = sum(self.weight(t) for t in set_b)
        floor = min(mass_a, mass_b)
        return shared / floor if floor else 0.0


_TERM_RE = re.compile(r"[a-z][a-z-]{1,}")


def content_terms(normalized: str) -> list[str]:
    """Stemmed, stopword-free terms. Numbers are excluded deliberately — a changed
    amount must not make two clauses look unrelated."""
    out = []
    for raw in _TERM_RE.findall(normalized):
        word = raw.strip("-")
        if len(word) < 3 or word in _STOPWORDS:
            continue
        out.append(_stem(word))
    return out


def _stem(word: str) -> str:
    for suffix in _SUFFIXES:
        if len(word) > len(suffix) + 2 and word.endswith(suffix):
            return word[: -len(suffix)]
    return word


def align_blocks(
    doc_a: Document,
    doc_b: Document,
    alignments: Iterable[SectionAlignment],
    weights: TermWeights | None = None,
) -> list[BlockAlignment]:
    """Align blocks inside each aligned section, then rescue cross-section moves."""
    if weights is None:
        weights = TermWeights(list(doc_a.blocks) + list(doc_b.blocks))
    pairs: list[BlockAlignment] = []
    orphan_a: list[tuple[Block, SectionAlignment]] = []
    orphan_b: list[tuple[Block, SectionAlignment]] = []

    for al in alignments:
        blocks_a = _comparable(doc_a.blocks_of(al.section_a.id)) if al.section_a else []
        blocks_b = _comparable(doc_b.blocks_of(al.section_b.id)) if al.section_b else []

        if not blocks_a:
            orphan_b.extend((b, al) for b in blocks_b)
            continue
        if not blocks_b:
            orphan_a.extend((b, al) for b in blocks_a)
            continue

        matched_a, matched_b, local = _pair_within_section(blocks_a, blocks_b, al, weights)
        pairs.extend(local)
        orphan_a.extend((b, al) for b in blocks_a if b.id not in matched_a)
        orphan_b.extend((b, al) for b in blocks_b if b.id not in matched_b)

    pairs.extend(_detect_moves(orphan_a, orphan_b, weights))
    return pairs


def _comparable(blocks: list[Block]) -> list[Block]:
    """Headings are excluded: a renamed section is reported once by the section layer,
    not as a removed heading plus an added heading."""
    skip = {BlockType.HEADER, BlockType.FOOTER, BlockType.TABLE, BlockType.HEADING}
    return [b for b in blocks if b.block_type not in skip and b.normalized]


def _pair_within_section(
    blocks_a: list[Block],
    blocks_b: list[Block],
    al: SectionAlignment,
    weights: TermWeights,
) -> tuple[set[str], set[str], list[BlockAlignment]]:
    """Exact-text anchors first (cheap, unambiguous), then fuzzy pairing of the gaps."""
    out: list[BlockAlignment] = []
    matched_a: set[str] = set()
    matched_b: set[str] = set()

    by_text: dict[str, list[Block]] = {}
    for b in blocks_b:
        by_text.setdefault(_match_key(b), []).append(b)
    for a in blocks_a:
        candidates = by_text.get(_match_key(a))
        if not candidates:
            continue
        b = candidates.pop(0)
        matched_a.add(a.id)
        matched_b.add(b.id)
        out.append(BlockAlignment(a, b, 1.0, "UNCHANGED", al))

    rest_a = [b for b in blocks_a if b.id not in matched_a]
    rest_b = [b for b in blocks_b if b.id not in matched_b]

    scored = []
    for a in rest_a:
        for b in rest_b:
            if a.block_type is BlockType.TABLE_ROW or b.block_type is BlockType.TABLE_ROW:
                sim = _row_similarity(a, b, weights)
            else:
                sim = _block_similarity(a, b, weights)
            if sim >= BLOCK_MATCH_THRESHOLD:
                scored.append((sim, a, b))
    scored.sort(key=lambda t: -t[0])
    for sim, a, b in scored:
        if a.id in matched_a or b.id in matched_b:
            continue
        matched_a.add(a.id)
        matched_b.add(b.id)
        out.append(BlockAlignment(a, b, round(sim, 4), "MODIFIED", al))

    return matched_a, matched_b, out


def _match_key(block: Block) -> str:
    """Numbering churn alone must not look like a text change."""
    return strip_list_marker(block.normalized)


def _block_similarity(a: Block, b: Block, weights: TermWeights) -> float:
    key_a, key_b = _match_key(a), _match_key(b)
    ratio = fuzz.ratio(key_a, key_b) / 100.0
    token = fuzz.token_sort_ratio(key_a, key_b) / 100.0
    lexical = max(ratio, token * 0.95)

    # A long shared opening inflates character similarity for clauses that are actually
    # unrelated ("The Supplier shall provide ..."). The distinctive tail decides.
    ta, tb = tokens(key_a), tokens(key_b)
    prefix = 0
    while prefix < min(len(ta), len(tb)) and ta[prefix] == tb[prefix]:
        prefix += 1
    if prefix >= 3 and prefix < min(len(ta), len(tb)):
        tail = fuzz.ratio(" ".join(ta[prefix:]), " ".join(tb[prefix:])) / 100.0
        lexical = min(lexical, tail)

    content = weights.overlap(content_terms(a.normalized), content_terms(b.normalized))
    return min(1.0, W_LEXICAL * lexical + W_CONTENT_IDF * content)


def _row_similarity(a: Block, b: Block, weights: TermWeights) -> float:
    """Table rows match on their first cell — that is the row's identity (TRD §32)."""
    if a.block_type is not b.block_type:
        return 0.0
    if a.row_key and b.row_key:
        key_sim = fuzz.ratio(a.row_key, b.row_key) / 100.0
        if key_sim >= 0.85:
            return max(0.9, key_sim)
        return key_sim * 0.5
    return _block_similarity(a, b, weights)


def _detect_moves(
    orphan_a: list[tuple[Block, SectionAlignment]],
    orphan_b: list[tuple[Block, SectionAlignment]],
    weights: TermWeights,
) -> list[BlockAlignment]:
    """Near-identical text in a different section is a move, not a delete + add (§20)."""
    out: list[BlockAlignment] = []
    scored = []
    for a, al_a in orphan_a:
        for b, al_b in orphan_b:
            if a.block_type is not b.block_type:
                continue
            sim = _block_similarity(a, b, weights)
            if sim >= MOVE_MATCH_THRESHOLD:
                scored.append((sim, a, b, al_a, al_b))
    scored.sort(key=lambda t: -t[0])
    used_a: set[str] = set()
    used_b: set[str] = set()
    for sim, a, b, al_a, al_b in scored:
        if a.id in used_a or b.id in used_b:
            continue
        used_a.add(a.id)
        used_b.add(b.id)
        out.append(BlockAlignment(a, b, round(sim, 4), "MOVED", al_a))

    for a, al in orphan_a:
        if a.id not in used_a:
            out.append(BlockAlignment(a, None, 0.0, "REMOVED", al))
    for b, al in orphan_b:
        if b.id not in used_b:
            out.append(BlockAlignment(None, b, 0.0, "ADDED", al))
    return out
