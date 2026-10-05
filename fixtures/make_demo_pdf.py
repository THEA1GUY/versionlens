"""Render the demo pair as real PDFs so the PDF path is exercised too.

  python -m fixtures.make_demo_pdf
"""

from __future__ import annotations

from pathlib import Path

from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from .make_demo import TABLE_A, TABLE_B, VERSION_A, VERSION_B

OUT = Path(__file__).resolve().parent / "demo"


def _pdf_safe(text: str) -> str:
    """The PDF base-14 fonts have no ₦ glyph, so reportlab would draw a letter and the
    extractor would faithfully read that letter back. Use the text currency code instead,
    which is an equally real-world way to write it and keeps this fixture honest about
    what the PDF actually contains."""
    return text.replace("&", "&amp;").replace("₦", "NGN ")


def build(sections, table, path: Path) -> None:
    base = getSampleStyleSheet()
    heading = ParagraphStyle("vl_h", parent=base["Heading2"], fontSize=12, leading=15,
                             spaceBefore=12, spaceAfter=5)
    body = ParagraphStyle("vl_b", parent=base["Normal"], fontSize=10, leading=15, spaceAfter=5)

    flow = []
    for index, (head, paragraphs) in enumerate(sections):
        if head:
            flow.append(Paragraph(head, heading))
        for text in paragraphs:
            flow.append(Paragraph(_pdf_safe(text), body))
        if head.endswith(("Pricing", "Commercial Terms")):
            flow.append(Paragraph("Rate card:", body))
            t = Table(table, colWidths=[70 * mm, 40 * mm])
            t.setStyle(
                TableStyle(
                    [
                        ("GRID", (0, 0), (-1, -1), 0.5, "#999999"),
                        ("FONTSIZE", (0, 0), (-1, -1), 9),
                        ("BACKGROUND", (0, 0), (-1, 0), "#eeeeee"),
                        ("ALIGN", (1, 0), (1, -1), "RIGHT"),
                    ]
                )
            )
            flow.append(t)
            flow.append(Spacer(1, 6))
        if index == len(sections) // 2:
            flow.append(PageBreak())

    SimpleDocTemplate(
        str(path), pagesize=A4, leftMargin=22 * mm, rightMargin=22 * mm,
        topMargin=20 * mm, bottomMargin=20 * mm, title=path.stem,
    ).build(flow)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    build(VERSION_A, TABLE_A, OUT / "proposal_v3.pdf")
    build(VERSION_B, TABLE_B, OUT / "proposal_v4.pdf")
    print(f"wrote {OUT / 'proposal_v3.pdf'}")
    print(f"wrote {OUT / 'proposal_v4.pdf'}")


if __name__ == "__main__":
    main()
