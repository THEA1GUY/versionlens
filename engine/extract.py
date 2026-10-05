"""PDF/DOCX -> pages + blocks, with page and bbox provenance retained.

Scanned/unreadable pages are reported, never silently dropped (PRD §23).
"""

from __future__ import annotations

import hashlib
import re
from pathlib import Path

from .model import (
    Block,
    BlockType,
    Document,
    ExtractionStatus,
    Page,
    Side,
)
from .normalize import normalize_text, strip_repeated_runners

# A page with text this short, in a PDF that has drawn images, is almost certainly a scan.
_SCAN_TEXT_THRESHOLD = 40
# DOCX has no page concept until rendered; approximate when no explicit breaks exist.
_DOCX_CHARS_PER_PAGE = 2600


def sha256_file(path: str | Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def extract(path: str | Path, side: Side) -> Document:
    path = Path(path)
    suffix = path.suffix.lower()
    if suffix == ".pdf":
        pages, blocks = _extract_pdf(path, side)
    elif suffix == ".docx":
        pages, blocks = _extract_docx(path, side)
    elif suffix in (".txt", ".md"):
        pages, blocks = _extract_text(path, side)
    else:
        raise ValueError(f"Unsupported file type: {suffix} (supported: .pdf, .docx, .txt)")

    blocks = strip_repeated_runners(blocks)
    for b in blocks:
        b.normalized = normalize_text(b.text)

    warnings = [
        f"Page {p.page_number} could not be reliably extracted ({p.status.value}). "
        f"Changes on this page may be incomplete."
        for p in pages
        if p.status in (ExtractionStatus.SCANNED, ExtractionStatus.UNREADABLE)
    ]
    doc = Document(
        side=side,
        filename=path.name,
        sha256=sha256_file(path),
        pages=pages,
        blocks=blocks,
        sections=[],
        warnings=warnings,
    )
    return doc


# --------------------------------------------------------------------------- PDF


def _extract_pdf(path: Path, side: Side) -> tuple[list[Page], list[Block]]:
    import pdfplumber

    pages: list[Page] = []
    blocks: list[Block] = []
    with pdfplumber.open(str(path)) as pdf:
        for pno, page in enumerate(pdf.pages, start=1):
            try:
                words = page.extract_words(use_text_flow=False, keep_blank_chars=False)
                raw = page.extract_text() or ""
            except Exception as exc:  # noqa: BLE001 - a bad page must not kill the run
                pages.append(
                    Page(pno, "", ExtractionStatus.UNREADABLE, 0.0, f"parser error: {exc}")
                )
                continue

            has_images = bool(page.images)
            if len(raw.strip()) < _SCAN_TEXT_THRESHOLD and has_images:
                pages.append(
                    Page(pno, raw, ExtractionStatus.SCANNED, 0.1, "image-only page, no text layer")
                )
                continue
            if not raw.strip():
                pages.append(Page(pno, raw, ExtractionStatus.UNREADABLE, 0.0, "no extractable text"))
                continue

            confidence = 1.0 if len(raw.strip()) >= _SCAN_TEXT_THRESHOLD else 0.5
            status = ExtractionStatus.OK if confidence == 1.0 else ExtractionStatus.LOW_CONFIDENCE
            pages.append(Page(pno, raw, status, confidence))

            table_bboxes = []
            try:
                for table in page.find_tables():
                    table_bboxes.append(table.bbox)
                    blocks.extend(_table_blocks(table, side, pno, len(blocks)))
            except Exception:  # noqa: BLE001 - tables are best-effort
                pass

            for line_text, bbox in _group_words_into_lines(words, table_bboxes):
                blocks.append(
                    Block(
                        id=_bid(side, pno, len(blocks)),
                        side=side,
                        page=pno,
                        block_index=len(blocks),
                        block_type=_guess_block_type(line_text),
                        text=line_text,
                        bbox=bbox,
                    )
                )

    blocks = _merge_paragraph_lines(blocks, side)
    return pages, blocks


def _group_words_into_lines(
    words: list[dict], exclude: list[tuple[float, float, float, float]]
) -> list[tuple[str, tuple[float, float, float, float]]]:
    """Cluster words into visual lines by their vertical midpoint."""
    rows: dict[int, list[dict]] = {}
    for w in words:
        if any(_inside(w, bb) for bb in exclude):
            continue
        key = int(round((w["top"] + w["bottom"]) / 2 / 3.0))  # 3pt buckets
        rows.setdefault(key, []).append(w)

    lines = []
    for key in sorted(rows):
        ws = sorted(rows[key], key=lambda w: w["x0"])
        text = " ".join(w["text"] for w in ws).strip()
        if not text:
            continue
        bbox = (
            min(w["x0"] for w in ws),
            min(w["top"] for w in ws),
            max(w["x1"] for w in ws),
            max(w["bottom"] for w in ws),
        )
        lines.append((text, bbox))
    return lines


def _inside(word: dict, bbox: tuple[float, float, float, float]) -> bool:
    x0, top, x1, bottom = bbox
    cx = (word["x0"] + word["x1"]) / 2
    cy = (word["top"] + word["bottom"]) / 2
    return x0 <= cx <= x1 and top <= cy <= bottom


def _table_blocks(table, side: Side, pno: int, start_index: int) -> list[Block]:
    """Tables become one TABLE block plus one TABLE_ROW per row (TRD §32)."""
    rows = [[(c or "").strip() for c in row] for row in table.extract()]
    rows = [r for r in rows if any(r)]
    if not rows:
        return []
    out: list[Block] = []
    idx = start_index
    out.append(
        Block(
            id=_bid(side, pno, idx),
            side=side,
            page=pno,
            block_index=idx,
            block_type=BlockType.TABLE,
            text=" | ".join(rows[0]),
            bbox=tuple(table.bbox),
        )
    )
    idx += 1
    for row in rows[1:]:
        out.append(
            Block(
                id=_bid(side, pno, idx),
                side=side,
                page=pno,
                block_index=idx,
                block_type=BlockType.TABLE_ROW,
                text=" | ".join(row),
                cells=row,
                row_key=normalize_text(row[0]) if row else "",
                bbox=tuple(table.bbox),
            )
        )
        idx += 1
    return out


def _merge_paragraph_lines(blocks: list[Block], side: Side) -> list[Block]:
    """PDF lines are layout artifacts; merge consecutive body lines back into paragraphs."""
    merged: list[Block] = []
    for b in blocks:
        prev = merged[-1] if merged else None
        joinable = (
            prev is not None
            and prev.block_type is BlockType.PARAGRAPH
            and b.block_type is BlockType.PARAGRAPH
            and prev.page == b.page
            and not _sentence_ended(prev.text)
        )
        if joinable:
            prev.text = _join_hyphenated(prev.text, b.text)
            if prev.bbox and b.bbox:
                prev.bbox = (
                    min(prev.bbox[0], b.bbox[0]),
                    min(prev.bbox[1], b.bbox[1]),
                    max(prev.bbox[2], b.bbox[2]),
                    max(prev.bbox[3], b.bbox[3]),
                )
            continue
        merged.append(b)

    for i, b in enumerate(merged):
        b.block_index = i
        b.id = _bid(side, b.page, i)
    return merged


def _sentence_ended(text: str) -> bool:
    return bool(re.search(r"[.:;!?]\s*$", text.strip()))


def _join_hyphenated(left: str, right: str) -> str:
    if left.rstrip().endswith("-"):
        return left.rstrip()[:-1] + right.lstrip()
    return f"{left.rstrip()} {right.lstrip()}"


# -------------------------------------------------------------------------- DOCX


def _extract_docx(path: Path, side: Side) -> tuple[list[Page], list[Block]]:
    import docx
    from docx.table import Table
    from docx.text.paragraph import Paragraph

    document = docx.Document(str(path))
    blocks: list[Block] = []
    page = 1
    chars_on_page = 0
    page_text: dict[int, list[str]] = {1: []}

    def new_page() -> None:
        nonlocal page, chars_on_page
        page += 1
        chars_on_page = 0
        page_text.setdefault(page, [])

    for item in _iter_docx_body(document, Paragraph, Table):
        if isinstance(item, Paragraph):
            text = item.text.strip()
            if _has_page_break(item):
                new_page()
            if not text:
                continue
            style = (item.style.name or "").lower()
            btype = (
                BlockType.HEADING
                if style.startswith("heading") or style == "title"
                else BlockType.LIST_ITEM
                if "list" in style
                else _guess_block_type(text)
            )
            blocks.append(
                Block(
                    id=_bid(side, page, len(blocks)),
                    side=side,
                    page=page,
                    block_index=len(blocks),
                    block_type=btype,
                    text=text,
                )
            )
            page_text[page].append(text)
            chars_on_page += len(text)
            if chars_on_page > _DOCX_CHARS_PER_PAGE:
                new_page()
        else:
            rows = [[c.text.strip() for c in r.cells] for r in item.rows]
            rows = [r for r in rows if any(r)]
            if not rows:
                continue
            blocks.append(
                Block(
                    id=_bid(side, page, len(blocks)),
                    side=side,
                    page=page,
                    block_index=len(blocks),
                    block_type=BlockType.TABLE,
                    text=" | ".join(rows[0]),
                )
            )
            for row in rows[1:]:
                blocks.append(
                    Block(
                        id=_bid(side, page, len(blocks)),
                        side=side,
                        page=page,
                        block_index=len(blocks),
                        block_type=BlockType.TABLE_ROW,
                        text=" | ".join(row),
                        cells=row,
                        row_key=normalize_text(row[0]) if row else "",
                    )
                )
            page_text[page].append(" ".join(" ".join(r) for r in rows))
            chars_on_page += sum(len(c) for r in rows for c in r)

    pages = [
        Page(pno, "\n".join(texts), ExtractionStatus.OK if texts else ExtractionStatus.UNREADABLE,
             1.0 if texts else 0.0)
        for pno, texts in sorted(page_text.items())
    ]
    return pages, blocks


def _iter_docx_body(document, Paragraph, Table):
    """Walk paragraphs and tables in true document order."""
    body = document.element.body
    for child in body.iterchildren():
        tag = child.tag.split("}")[-1]
        if tag == "p":
            yield Paragraph(child, document)
        elif tag == "tbl":
            yield Table(child, document)


def _has_page_break(paragraph) -> bool:
    xml = paragraph._p.xml
    return 'w:type="page"' in xml or 'type="page"' in xml


# -------------------------------------------------------------------------- text


def _extract_text(path: Path, side: Side) -> tuple[list[Page], list[Block]]:
    raw = path.read_text(encoding="utf-8", errors="replace")
    chunks = raw.split("\f") if "\f" in raw else [raw]
    pages: list[Page] = []
    blocks: list[Block] = []
    for pno, chunk in enumerate(chunks, start=1):
        pages.append(Page(pno, chunk, ExtractionStatus.OK, 1.0))
        for para in re.split(r"\n\s*\n", chunk):
            text = " ".join(para.split())
            if not text:
                continue
            blocks.append(
                Block(
                    id=_bid(side, pno, len(blocks)),
                    side=side,
                    page=pno,
                    block_index=len(blocks),
                    block_type=_guess_block_type(text),
                    text=text,
                )
            )
    return pages, blocks


# ------------------------------------------------------------------------ shared

_HEADING_NUM = re.compile(r"^(\d+(?:\.\d+)*)\.?\s+(.{0,90})$")
_LIST_MARK = re.compile(r"^([-•·*]|\(?[a-z]\)|\(?[ivx]+\))\s+", re.IGNORECASE)


def _guess_block_type(text: str) -> BlockType:
    stripped = text.strip()
    if _LIST_MARK.match(stripped):
        return BlockType.LIST_ITEM
    m = _HEADING_NUM.match(stripped)
    if m and not _sentence_ended(stripped) and len(m.group(2).split()) <= 12:
        return BlockType.HEADING
    words = stripped.split()
    if 0 < len(words) <= 10 and stripped == stripped.upper() and any(c.isalpha() for c in stripped):
        return BlockType.HEADING
    if 0 < len(words) <= 9 and not _sentence_ended(stripped) and stripped[0:1].isupper():
        # Title Case short line with no terminal punctuation
        capitalised = sum(1 for w in words if w[:1].isupper())
        if capitalised / len(words) >= 0.6:
            return BlockType.HEADING
    return BlockType.PARAGRAPH


def _bid(side: Side, page: int, index: int) -> str:
    return f"{side}-p{page}-b{index}"
