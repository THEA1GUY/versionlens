"""Normalization used for matching only. Raw text is never destroyed (TRD §10)."""

from __future__ import annotations

import re
import unicodedata
from collections import Counter

_QUOTES = {
    "‘": "'", "’": "'", "‚": "'", "‛": "'",
    "“": '"', "”": '"', "„": '"', "«": '"', "»": '"',
}
_DASHES = {"‐": "-", "‑": "-", "‒": "-", "–": "-", "—": "-", "―": "-"}
_SPACES = {" ": " ", " ": " ", " ": " ", " ": " ", " ": " ", "​": ""}
_TRANSLATE = str.maketrans({**_QUOTES, **_DASHES, **_SPACES})

_LEADING_NUMBER = re.compile(r"^\s*(?:\d+(?:\.\d+)*|[a-z]|[ivxlc]+)[.)]\s+", re.IGNORECASE)
_HEADING_NUM = re.compile(r"^(\d+(?:\.\d+)*)[.)]?\s*")


def normalize_text(text: str) -> str:
    """Lowercased, punctuation-light form for similarity and diffing."""
    t = unicodedata.normalize("NFKC", text).translate(_TRANSLATE)
    t = re.sub(r"\s+", " ", t).strip().lower()
    return t


def normalize_heading(text: str) -> str:
    """'4.0 PAYMENT TERMS' -> 'payment terms' (TRD §13)."""
    t = unicodedata.normalize("NFKC", text).translate(_TRANSLATE).strip()
    t = _HEADING_NUM.sub("", t)
    t = re.sub(r"[^\w\s]", " ", t)
    t = re.sub(r"\s+", " ", t).strip().lower()
    return t


def heading_number(text: str) -> str | None:
    m = _HEADING_NUM.match(unicodedata.normalize("NFKC", text).strip())
    if not m or not m.group(1):
        return None
    num = m.group(1).rstrip(".")
    return num or None


def strip_list_marker(text: str) -> str:
    return _LEADING_NUMBER.sub("", text).strip()


def tokens(normalized: str) -> list[str]:
    return re.findall(r"[\w$£€₦%./-]+", normalized)


def strip_repeated_runners(blocks: list) -> list:
    """Drop running headers/footers: identical short lines appearing on most pages.

    Cheap and effective; an exact-text heuristic beats layout analysis here because
    repeated runners are byte-identical far more often than not.
    """
    pages = {b.page for b in blocks}
    if len(pages) < 3:
        return blocks
    short = [b for b in blocks if len(b.text) <= 90]
    counts = Counter(normalize_text(b.text) for b in short)
    threshold = max(3, int(len(pages) * 0.6))
    runners = {text for text, n in counts.items() if text and n >= threshold}
    if not runners:
        return blocks
    kept = []
    for b in blocks:
        if len(b.text) <= 90 and normalize_text(b.text) in runners:
            continue
        kept.append(b)
    # Re-index so block ids stay contiguous.
    for i, b in enumerate(kept):
        b.block_index = i
        b.id = f"p{b.page}-b{i}"
    return kept
