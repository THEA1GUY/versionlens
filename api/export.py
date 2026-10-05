"""Comparison report exports (PRD §20, PDD §24).

Every format carries the disclaimer, both citations per change, and reviewer notes.
"""

from __future__ import annotations

import csv
import io
from datetime import datetime
from typing import Any

from engine.compare import DISCLAIMER

TABLE_HEADERS = [
    "Change ID",
    "Review priority",
    "Category",
    "Change type",
    "Summary",
    "Version A value",
    "Version B value",
    "Change",
    "A reference",
    "B reference",
    "Confidence",
    "Detected by",
    "Review status",
    "Reviewer notes",
]


def _citation_label(citation: dict[str, Any] | None) -> str:
    if not citation:
        return "—"
    section = citation.get("section") or "(unsectioned)"
    return f"{section} · page {citation.get('page')}"


def _value_label(value: dict[str, Any] | None) -> str:
    if not value:
        return "—"
    source = value.get("source_text")
    if source:
        return str(source)
    raw = value.get("value")
    unit = value.get("unit")
    if raw is None:
        return "—"
    if unit in (None, "text", "section", "modality", "date"):
        return str(raw)
    return f"{raw} {unit}"


def _delta_label(change: dict[str, Any]) -> str:
    delta = change.get("delta") or {}
    bits: list[str] = []
    if "absolute" in delta and delta["absolute"] is not None:
        bits.append(f"{delta['absolute']:+,.2f}".rstrip("0").rstrip("."))
    if delta.get("percentage") is not None:
        bits.append(f"{delta['percentage']:+g}%")
    if delta.get("percentage_points") is not None:
        bits.append(f"{delta['percentage_points']:+g} pp")
    if delta.get("days") is not None:
        bits.append(f"{delta['days']:+g} days")
    if delta.get("strength_change") is not None:
        bits.append(f"obligation strength {delta['strength_change']:+g}")
    if bits:
        return " · ".join(bits)
    old, new = _value_label(change.get("old_value")), _value_label(change.get("new_value"))
    if old != "—" and new != "—":
        return f"{old} → {new}"
    return change.get("direction") or "—"


def _notes_label(change: dict[str, Any]) -> str:
    notes = list(change.get("notes") or [])
    for note in change.get("reviewer_notes") or []:
        author = note.get("author") or "Reviewer"
        notes.append(f"{author}: {note.get('body', '')}")
    return " | ".join(n for n in notes if n)


def _rows(changes: list[dict[str, Any]]) -> list[list[str]]:
    out = []
    for c in changes:
        out.append(
            [
                c.get("id", ""),
                c.get("importance", ""),
                c.get("category", ""),
                c.get("type", ""),
                c.get("summary", ""),
                _value_label(c.get("old_value")),
                _value_label(c.get("new_value")),
                _delta_label(c),
                _citation_label(c.get("citation_a")),
                _citation_label(c.get("citation_b")),
                c.get("confidence_label", ""),
                ", ".join(c.get("detectors") or []),
                c.get("review_status", ""),
                _notes_label(c),
            ]
        )
    return out


# ----------------------------------------------------------------------- CSV/XLSX


def to_csv(payload: dict[str, Any]) -> bytes:
    buffer = io.StringIO(newline="")
    writer = csv.writer(buffer)
    writer.writerow(TABLE_HEADERS)
    writer.writerows(_rows(payload.get("changes") or []))
    # utf-8-sig so Excel opens ₦ and → correctly without an import step.
    return buffer.getvalue().encode("utf-8-sig")


def to_xlsx(payload: dict[str, Any]) -> bytes:
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.utils import get_column_letter

    wb = Workbook()
    ws = wb.active
    ws.title = "Changes"

    ws.append(TABLE_HEADERS)
    header_fill = PatternFill("solid", start_color="FFF1F5F9")
    for col, _ in enumerate(TABLE_HEADERS, start=1):
        cell = ws.cell(row=1, column=col)
        cell.font = Font(bold=True)
        cell.fill = header_fill
        cell.alignment = Alignment(vertical="top")

    for row in _rows(payload.get("changes") or []):
        ws.append(row)

    widths = [12, 14, 17, 16, 60, 24, 24, 26, 34, 34, 18, 32, 16, 40]
    for idx, width in enumerate(widths, start=1):
        ws.column_dimensions[get_column_letter(idx)].width = width
    for row in ws.iter_rows(min_row=2):
        for cell in row:
            cell.alignment = Alignment(vertical="top", wrap_text=True)
    ws.freeze_panes = "A2"
    ws.auto_filter.ref = ws.dimensions

    summary = wb.create_sheet("Summary")
    meta = payload.get("meta") or {}
    s = payload.get("summary") or {}
    for label, value in (
        ("Comparison", meta.get("name") or "Untitled comparison"),
        ("Version A", meta.get("version_a")),
        ("Version B", meta.get("version_b")),
        ("Generated", meta.get("generated_at")),
        ("Status", meta.get("status")),
        ("", ""),
        ("Total changes", s.get("total_changes")),
        ("High attention", s.get("high_attention")),
        ("Medium attention", s.get("medium_attention")),
        ("Minor", s.get("low_attention")),
        ("", ""),
        ("Disclaimer", DISCLAIMER),
    ):
        summary.append([label, value])
    summary.column_dimensions["A"].width = 20
    summary.column_dimensions["B"].width = 90
    summary["B12"].alignment = Alignment(wrap_text=True, vertical="top")

    buffer = io.BytesIO()
    wb.save(buffer)
    return buffer.getvalue()


# ---------------------------------------------------------------------------- PDF


def to_pdf(payload: dict[str, Any]) -> bytes:
    from reportlab.lib import colors
    from reportlab.lib.enums import TA_LEFT
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.platypus import (
        HRFlowable,
        PageBreak,
        Paragraph,
        SimpleDocTemplate,
        Spacer,
        Table,
        TableStyle,
    )

    meta = payload.get("meta") or {}
    summary = payload.get("summary") or {}
    changes = payload.get("changes") or []

    base = getSampleStyleSheet()
    styles = {
        "title": ParagraphStyle("vl_title", parent=base["Title"], fontSize=19, leading=23,
                                alignment=TA_LEFT, spaceAfter=2),
        "sub": ParagraphStyle("vl_sub", parent=base["Normal"], fontSize=9.5, leading=14,
                              textColor=colors.HexColor("#64748b")),
        "h2": ParagraphStyle("vl_h2", parent=base["Heading2"], fontSize=12.5, leading=16,
                             spaceBefore=16, spaceAfter=6,
                             textColor=colors.HexColor("#0f172a")),
        "body": ParagraphStyle("vl_body", parent=base["Normal"], fontSize=9.5, leading=14),
        "small": ParagraphStyle("vl_small", parent=base["Normal"], fontSize=8, leading=11,
                                textColor=colors.HexColor("#64748b")),
        "quote": ParagraphStyle("vl_quote", parent=base["Normal"], fontSize=9, leading=13,
                                leftIndent=8, textColor=colors.HexColor("#1e293b")),
        "disclaimer": ParagraphStyle("vl_disc", parent=base["Normal"], fontSize=8.5, leading=12,
                                     textColor=colors.HexColor("#475569")),
    }

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=16 * mm,
        bottomMargin=16 * mm,
        title=f"Document comparison — {meta.get('name') or 'VersionLens'}",
        author="VersionLens",
    )

    flow: list[Any] = [
        Paragraph("Document comparison report", styles["title"]),
        Paragraph(_esc(meta.get("name") or "Untitled comparison"), styles["sub"]),
        Spacer(1, 8),
        Paragraph(
            f"<b>Version A</b> {_esc(meta.get('version_a') or '—')}<br/>"
            f"<b>Version B</b> {_esc(meta.get('version_b') or '—')}<br/>"
            f"<b>Generated</b> {_esc(meta.get('generated_at') or datetime.now().isoformat())}",
            styles["body"],
        ),
        Spacer(1, 10),
        HRFlowable(width="100%", color=colors.HexColor("#e2e8f0")),
        Spacer(1, 8),
        Paragraph(f"<b>Disclaimer.</b> {DISCLAIMER}", styles["disclaimer"]),
        Paragraph("Executive summary", styles["h2"]),
        Paragraph(_esc(summary.get("headline") or ""), styles["body"]),
        Spacer(1, 6),
    ]

    counts = Table(
        [
            ["High attention", "Medium attention", "Minor", "Total"],
            [
                str(summary.get("high_attention", 0)),
                str(summary.get("medium_attention", 0)),
                str(summary.get("low_attention", 0)),
                str(summary.get("total_changes", 0)),
            ],
        ],
        colWidths=[42 * mm] * 4,
    )
    counts.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f1f5f9")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.HexColor("#475569")),
                ("FONTSIZE", (0, 0), (-1, 0), 8),
                ("FONTSIZE", (0, 1), (-1, 1), 14),
                ("FONTNAME", (0, 1), (-1, 1), "Helvetica-Bold"),
                ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#e2e8f0")),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ]
        )
    )
    flow.append(counts)

    for warning in payload.get("warnings") or []:
        flow.append(Spacer(1, 6))
        flow.append(Paragraph(f"<b>Extraction warning.</b> {_esc(warning)}", styles["small"]))

    key_changes = summary.get("key_changes") or []
    if key_changes:
        flow.append(Paragraph("Key changes", styles["h2"]))
        for i, item in enumerate(key_changes, start=1):
            flow.append(
                Paragraph(
                    f"{i}. <b>{_esc(item.get('category', ''))}</b> — "
                    f"{_esc(item.get('summary', ''))}",
                    styles["body"],
                )
            )
            flow.append(Spacer(1, 3))

    flow.append(PageBreak())
    flow.append(Paragraph("Detailed changes", styles["h2"]))

    for change in changes:
        flow.extend(_pdf_change(change, styles, colors, mm, Paragraph, Spacer, Table, TableStyle,
                                HRFlowable))

    if not changes:
        flow.append(Paragraph("No changes were recorded for this comparison.", styles["body"]))

    audit = payload.get("audit") or {}
    if audit:
        flow.append(PageBreak())
        flow.append(Paragraph("Audit record", styles["h2"]))
        rows = [[_esc(str(k).replace("_", " ")), _esc(str(v))] for k, v in audit.items()
                if v not in (None, "", [])]
        table = Table([["Field", "Value"]] + rows, colWidths=[55 * mm, 115 * mm])
        table.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f1f5f9")),
                    ("FONTSIZE", (0, 0), (-1, -1), 7.5),
                    ("GRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#e2e8f0")),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ]
            )
        )
        flow.append(table)

    doc.build(flow, onLaterPages=_footer, onFirstPage=_footer)
    return buffer.getvalue()


def _pdf_change(change, styles, colors, mm, Paragraph, Spacer, Table, TableStyle, HRFlowable):
    tint = {
        "HIGH": colors.HexColor("#b91c1c"),
        "MEDIUM": colors.HexColor("#b45309"),
        "LOW": colors.HexColor("#64748b"),
    }.get(change.get("importance", "LOW"), colors.HexColor("#64748b"))

    out = [
        Spacer(1, 10),
        Paragraph(
            f"<font color='#{tint.hexval()[2:]}'><b>"
            f"{_esc(change.get('importance', ''))} · {_esc(change.get('category', ''))}"
            f"</b></font>  <font size='7' color='#94a3b8'>{_esc(change.get('id', ''))}</font>",
            styles["small"],
        ),
        Paragraph(_esc(change.get("summary", "")), styles["body"]),
        Spacer(1, 4),
    ]

    delta = _delta_label(change)
    if delta and delta != "—":
        out.append(Paragraph(f"<b>Change</b>  {_esc(delta)}", styles["body"]))
        out.append(Spacer(1, 4))

    cells = []
    for side, key in (("Version A", "citation_a"), ("Version B", "citation_b")):
        citation = change.get(key)
        text_key = "text_a" if key == "citation_a" else "text_b"
        if citation:
            header = f"<b>{side}</b><br/><font size='7.5' color='#64748b'>" \
                     f"{_esc(_citation_label(citation))}</font>"
            quote = _esc(citation.get("text") or change.get(text_key) or "")
        else:
            header = f"<b>{side}</b><br/><font size='7.5' color='#64748b'>" \
                     f"No corresponding content</font>"
            quote = "—"
        cells.append(
            [Paragraph(header, styles["small"]),
             Paragraph(f"“{_shorten(quote, 700)}”" if quote != "—" else "—", styles["quote"])]
        )

    table = Table(
        [[cells[0][0], cells[1][0]], [cells[0][1], cells[1][1]]],
        colWidths=[85 * mm, 85 * mm],
    )
    table.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f8fafc")),
                ("BOX", (0, 0), (-1, -1), 0.4, colors.HexColor("#e2e8f0")),
                ("INNERGRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#e2e8f0")),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    out.append(table)

    meta_bits = [
        f"{_esc(change.get('confidence_label', ''))}",
        f"detected by {_esc(', '.join(change.get('detectors') or []))}",
        f"review: {_esc(change.get('review_status', 'unreviewed'))}",
    ]
    out.append(Spacer(1, 3))
    out.append(Paragraph(" · ".join(b for b in meta_bits if b), styles["small"]))

    notes = _notes_label(change)
    if notes:
        out.append(Paragraph(f"<b>Notes.</b> {_esc(notes)}", styles["small"]))

    out.append(Spacer(1, 4))
    out.append(HRFlowable(width="100%", color=colors.HexColor("#eef2f6")))
    return out


def _footer(canvas, doc) -> None:
    canvas.saveState()
    canvas.setFont("Helvetica", 7.5)
    canvas.setFillGray(0.45)
    canvas.drawString(18 * 2.8346, 10 * 2.8346,
                      "VersionLens — review aid, not legal advice")
    canvas.drawRightString(doc.pagesize[0] - 18 * 2.8346, 10 * 2.8346, f"Page {doc.page}")
    canvas.restoreState()


# --------------------------------------------------------------------------- DOCX


def to_docx(payload: dict[str, Any]) -> bytes:
    import docx
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from docx.shared import Pt, RGBColor

    meta = payload.get("meta") or {}
    summary = payload.get("summary") or {}
    changes = payload.get("changes") or []

    document = docx.Document()
    document.add_heading("Document comparison report", level=0)
    document.add_paragraph(meta.get("name") or "Untitled comparison")

    info = document.add_paragraph()
    info.add_run("Version A: ").bold = True
    info.add_run(f"{meta.get('version_a') or '—'}\n")
    info.add_run("Version B: ").bold = True
    info.add_run(f"{meta.get('version_b') or '—'}\n")
    info.add_run("Generated: ").bold = True
    info.add_run(str(meta.get("generated_at") or datetime.now().isoformat()))

    disclaimer = document.add_paragraph()
    run = disclaimer.add_run(f"Disclaimer. {DISCLAIMER}")
    run.italic = True
    run.font.size = Pt(8.5)
    run.font.color.rgb = RGBColor(0x47, 0x55, 0x69)

    document.add_heading("Executive summary", level=1)
    document.add_paragraph(summary.get("headline") or "")
    document.add_paragraph(
        f"{summary.get('high_attention', 0)} high attention · "
        f"{summary.get('medium_attention', 0)} medium attention · "
        f"{summary.get('low_attention', 0)} minor · "
        f"{summary.get('total_changes', 0)} total"
    )

    for warning in payload.get("warnings") or []:
        p = document.add_paragraph()
        wr = p.add_run(f"Extraction warning: {warning}")
        wr.font.size = Pt(8.5)
        wr.bold = True

    key_changes = summary.get("key_changes") or []
    if key_changes:
        document.add_heading("Key changes", level=1)
        for item in key_changes:
            document.add_paragraph(
                f"{item.get('category', '')} — {item.get('summary', '')}", style="List Number"
            )

    document.add_heading("Detailed changes", level=1)
    for change in changes:
        heading = document.add_paragraph()
        hr = heading.add_run(
            f"{change.get('importance', '')} · {change.get('category', '')} · "
            f"{change.get('id', '')}"
        )
        hr.bold = True
        hr.font.size = Pt(9)
        document.add_paragraph(change.get("summary", ""))

        delta = _delta_label(change)
        if delta and delta != "—":
            d = document.add_paragraph()
            d.add_run("Change: ").bold = True
            d.add_run(delta)

        table = document.add_table(rows=2, cols=2)
        table.style = "Table Grid"
        for col, (side, key) in enumerate((("Version A", "citation_a"), ("Version B", "citation_b"))):
            citation = change.get(key)
            head = table.cell(0, col).paragraphs[0]
            head.add_run(f"{side}\n").bold = True
            head.add_run(_citation_label(citation)).font.size = Pt(8)
            body = table.cell(1, col).paragraphs[0]
            text_key = "text_a" if key == "citation_a" else "text_b"
            quote = (citation or {}).get("text") or change.get(text_key) or ""
            body_run = body.add_run(f"“{_shorten(quote, 700)}”" if quote else "No corresponding content")
            body_run.font.size = Pt(9)

        footer = document.add_paragraph()
        fr = footer.add_run(
            f"{change.get('confidence_label', '')} · detected by "
            f"{', '.join(change.get('detectors') or [])} · review: "
            f"{change.get('review_status', 'unreviewed')}"
        )
        fr.font.size = Pt(8)
        fr.font.color.rgb = RGBColor(0x64, 0x74, 0x8B)

        notes = _notes_label(change)
        if notes:
            np = document.add_paragraph()
            np.add_run("Notes: ").bold = True
            np.add_run(notes).font.size = Pt(8.5)

        document.add_paragraph("").alignment = WD_ALIGN_PARAGRAPH.LEFT

    if not changes:
        document.add_paragraph("No changes were recorded for this comparison.")

    audit = payload.get("audit") or {}
    if audit:
        document.add_heading("Audit record", level=1)
        table = document.add_table(rows=1, cols=2)
        table.style = "Table Grid"
        table.rows[0].cells[0].paragraphs[0].add_run("Field").bold = True
        table.rows[0].cells[1].paragraphs[0].add_run("Value").bold = True
        for key, value in audit.items():
            if value in (None, "", []):
                continue
            row = table.add_row()
            row.cells[0].text = str(key).replace("_", " ")
            row.cells[1].text = str(value)

    buffer = io.BytesIO()
    document.save(buffer)
    return buffer.getvalue()


# ------------------------------------------------------------------------ helpers


def _esc(text: Any) -> str:
    return (
        str(text)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


def _shorten(text: str, limit: int) -> str:
    text = " ".join(str(text).split())
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


EXPORTERS = {
    "pdf": (to_pdf, "application/pdf", "pdf"),
    "docx": (
        to_docx,
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "docx",
    ),
    "csv": (to_csv, "text/csv; charset=utf-8", "csv"),
    "xlsx": (
        to_xlsx,
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "xlsx",
    ),
}
