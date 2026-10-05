"""Word-level deterministic diff over already-aligned blocks (TRD §17).

Running this only after alignment is what keeps highlighting tight: the UI gets
"$20,000 -> $28,000" rather than a whole sentence painted as changed (PRD §14).
"""

from __future__ import annotations

import re
from difflib import SequenceMatcher
from typing import Any

_TOKEN_RE = re.compile(r"\s+|[^\s]+")
_WORD_RE = re.compile(r"[^\W_]|[$£€₦%]")


def split_tokens(text: str) -> list[str]:
    return _TOKEN_RE.findall(text)


def word_diff(text_a: str, text_b: str) -> list[dict[str, Any]]:
    """Token-level opcodes: [{op, a, b}] with op in equal|insert|delete|replace."""
    a, b = split_tokens(text_a), split_tokens(text_b)
    key_a = [t.lower() for t in a]
    key_b = [t.lower() for t in b]
    matcher = SequenceMatcher(None, key_a, key_b, autojunk=False)
    out: list[dict[str, Any]] = []
    for op, i1, i2, j1, j2 in matcher.get_opcodes():
        seg_a = "".join(a[i1:i2])
        seg_b = "".join(b[j1:j2])
        if op == "equal":
            out.append({"op": "equal", "a": seg_a, "b": seg_b})
        elif op == "insert":
            out.append({"op": "insert", "a": "", "b": seg_b})
        elif op == "delete":
            out.append({"op": "delete", "a": seg_a, "b": ""})
        else:
            out.append({"op": "replace", "a": seg_a, "b": seg_b})
    return _merge_adjacent(out)


def _merge_adjacent(ops: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Collapse delete+insert and whitespace-only equals into readable spans."""
    merged: list[dict[str, Any]] = []
    for op in ops:
        if not merged:
            merged.append(dict(op))
            continue
        prev = merged[-1]
        if prev["op"] == "delete" and op["op"] == "insert":
            prev["op"] = "replace"
            prev["b"] = op["b"]
            continue
        if prev["op"] == op["op"] and prev["op"] != "equal":
            prev["a"] += op["a"]
            prev["b"] += op["b"]
            continue
        if (
            prev["op"] == "equal"
            and not prev["a"].strip()
            and len(merged) >= 2
            and merged[-2]["op"] == op["op"] != "equal"
        ):
            merged[-2]["a"] += prev["a"] + op["a"]
            merged[-2]["b"] += prev["b"] + op["b"]
            merged.pop()
            continue
        merged.append(dict(op))
    return merged


def changed_fragments(ops: list[dict[str, Any]]) -> tuple[str, str]:
    """Just the changed parts, for a compact 'X -> Y' summary."""
    before = " ".join(o["a"].strip() for o in ops if o["op"] in ("delete", "replace") and o["a"].strip())
    after = " ".join(o["b"].strip() for o in ops if o["op"] in ("insert", "replace") and o["b"].strip())
    return before.strip(), after.strip()


def is_cosmetic(text_a: str, text_b: str) -> bool:
    """True when the only differences are whitespace, case, punctuation or list markers."""
    return _cosmetic_key(text_a) == _cosmetic_key(text_b)


def _cosmetic_key(text: str) -> str:
    return "".join(c.lower() for c in text if _WORD_RE.match(c))


def change_ratio(text_a: str, text_b: str) -> float:
    """0.0 = identical, 1.0 = nothing in common. Drives wording-vs-substantive triage."""
    if not text_a and not text_b:
        return 0.0
    return 1.0 - SequenceMatcher(None, text_a.lower(), text_b.lower(), autojunk=False).ratio()
