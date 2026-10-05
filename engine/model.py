"""Core document model. Every piece of text keeps its origin so citations never need guessing."""

from __future__ import annotations

from dataclasses import dataclass, field, asdict
from enum import Enum
from typing import Any, Literal

ENGINE_VERSION = "1.0.0"
EXTRACTION_VERSION = "1.0.0"

Side = Literal["A", "B"]


class BlockType(str, Enum):
    HEADING = "heading"
    PARAGRAPH = "paragraph"
    LIST_ITEM = "list_item"
    TABLE = "table"
    TABLE_ROW = "table_row"
    HEADER = "header"
    FOOTER = "footer"


class ExtractionStatus(str, Enum):
    OK = "extraction_successful"
    LOW_CONFIDENCE = "low_extraction_confidence"
    SCANNED = "scanned_document"
    UNREADABLE = "unreadable_page"
    UNSUPPORTED = "unsupported_content"


@dataclass
class Block:
    """Smallest citable unit. `text` is raw (for display/quoting), `normalized` for matching."""

    id: str
    side: Side
    page: int
    block_index: int
    block_type: BlockType
    text: str
    normalized: str = ""
    section_id: str | None = None
    bbox: tuple[float, float, float, float] | None = None
    # table_row blocks carry their cells so table diffing can be structural, not textual
    cells: list[str] | None = None
    row_key: str | None = None

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["block_type"] = self.block_type.value
        return d


@dataclass
class Page:
    page_number: int
    raw_text: str
    status: ExtractionStatus = ExtractionStatus.OK
    extraction_confidence: float = 1.0
    note: str | None = None


@dataclass
class Section:
    id: str
    side: Side
    section_number: str | None
    heading: str
    normalized_heading: str
    order_index: int
    start_page: int
    end_page: int
    parent_id: str | None = None
    level: int = 1
    block_ids: list[str] = field(default_factory=list)

    @property
    def label(self) -> str:
        """Human citation label, e.g. '7.1 Payment'."""
        if self.section_number:
            return f"{self.section_number} {self.heading}".strip()
        return self.heading or "(untitled)"


@dataclass
class Document:
    side: Side
    filename: str
    sha256: str
    pages: list[Page]
    blocks: list[Block]
    sections: list[Section]
    extraction_version: str = EXTRACTION_VERSION
    warnings: list[str] = field(default_factory=list)

    @property
    def page_count(self) -> int:
        return len(self.pages)

    def block(self, block_id: str) -> Block | None:
        return self._block_index.get(block_id)

    def section(self, section_id: str | None) -> Section | None:
        if section_id is None:
            return None
        return self._section_index.get(section_id)

    def __post_init__(self) -> None:
        self._block_index = {b.id: b for b in self.blocks}
        self._section_index = {s.id: s for s in self.sections}

    def reindex(self) -> None:
        self.__post_init__()

    def blocks_of(self, section_id: str) -> list[Block]:
        sec = self.section(section_id)
        if not sec:
            return []
        return [b for bid in sec.block_ids if (b := self.block(bid))]

    def problem_pages(self) -> list[Page]:
        return [p for p in self.pages if p.status is not ExtractionStatus.OK]


@dataclass
class Citation:
    """Built only by the engine from real block IDs — never by a language model."""

    document_version: Side
    block_id: str
    page: int
    section: str
    char_start: int = 0
    char_end: int = 0
    text: str = ""
    bbox: tuple[float, float, float, float] | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)
