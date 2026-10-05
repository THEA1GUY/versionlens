"""Blocks -> nested section tree, every block assigned to exactly one section."""

from __future__ import annotations

from .model import Block, BlockType, Document, Section
from .normalize import heading_number, normalize_heading


def segment(doc: Document) -> Document:
    sections: list[Section] = []
    stack: list[Section] = []
    order = 0

    preamble = Section(
        id=f"{doc.side}-s0",
        side=doc.side,
        section_number=None,
        heading="(preamble)",
        normalized_heading="",
        order_index=0,
        start_page=doc.pages[0].page_number if doc.pages else 1,
        end_page=doc.pages[0].page_number if doc.pages else 1,
        level=0,
    )
    current = preamble
    sections.append(preamble)

    for block in doc.blocks:
        if block.block_type is BlockType.HEADING:
            order += 1
            number = heading_number(block.text)
            level = len(number.split(".")) if number else _implicit_level(stack)
            heading = _heading_body(block.text, number)

            while stack and stack[-1].level >= level:
                stack.pop()
            parent = stack[-1] if stack else None

            sec = Section(
                id=f"{doc.side}-s{order}",
                side=doc.side,
                section_number=number,
                heading=heading,
                normalized_heading=normalize_heading(block.text),
                order_index=order,
                start_page=block.page,
                end_page=block.page,
                parent_id=parent.id if parent else None,
                level=level,
            )
            sections.append(sec)
            stack.append(sec)
            current = sec
            # The heading line itself belongs to its own section.
            block.section_id = sec.id
            sec.block_ids.append(block.id)
            continue

        block.section_id = current.id
        current.block_ids.append(block.id)
        current.end_page = max(current.end_page, block.page)
        for anc in stack:
            anc.end_page = max(anc.end_page, block.page)

    if not preamble.block_ids:
        sections.remove(preamble)

    doc.sections = sections
    doc.reindex()
    return doc


def _heading_body(text: str, number: str | None) -> str:
    body = text.strip()
    if number:
        body = body[len(number) :].lstrip(".) \t")
    return body.strip() or "(untitled)"


def _implicit_level(stack: list[Section]) -> int:
    """Unnumbered headings sit at the level of the nearest numbered ancestor + 1."""
    return (stack[-1].level + 1) if stack else 1


def section_path(doc: Document, section_id: str | None) -> str:
    """'5 Payment > 5.2 Late Payment' — used for readable citations."""
    sec = doc.section(section_id)
    if not sec:
        return "(unsectioned)"
    parts = [sec.label]
    seen = {sec.id}
    while sec and sec.parent_id and sec.parent_id not in seen:
        sec = doc.section(sec.parent_id)
        if not sec:
            break
        seen.add(sec.id)
        parts.append(sec.label)
    return " > ".join(reversed(parts))


def leaf_sections(doc: Document) -> list[Section]:
    """Sections that directly own blocks — the unit we align on."""
    return [s for s in doc.sections if s.block_ids]
