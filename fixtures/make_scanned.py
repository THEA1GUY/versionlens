"""Build a genuinely scanned PDF: a page image with no text layer.

Used to exercise the OCR path end to end — extraction must report it as a scan, and OCR
must recover the amounts a reviewer would compare.

  python -m fixtures.make_scanned
"""

from __future__ import annotations

import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont
from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas as pdfcanvas

OUT = Path(__file__).resolve().parent / "demo"

PAGE_LINES = [
    ("Acme Website Redesign Proposal", 34, True),
    ("", 10, False),
    ("Prepared for Acme Industries Limited", 20, False),
    ("Version 3 — 12 August 2026", 20, False),
    ("", 16, False),
    ("3. Pricing", 26, True),
    ("", 8, False),
    ("The total project price is NGN 5,000,000 exclusive of applicable taxes.", 20, False),
    ("The price includes design, development, testing and deployment.", 20, False),
    ("", 16, False),
    ("4. Delivery", 26, True),
    ("", 8, False),
    ("The Supplier shall complete the project within 45 days of the", 20, False),
    ("commencement date. The commencement date is 5 October 2026.", 20, False),
    ("", 16, False),
    ("6. Payment Terms", 26, True),
    ("", 8, False),
    ("The Client shall pay 50% of the total price upfront on signature.", 20, False),
    ("The Client shall pay invoices within 30 days of receipt.", 20, False),
]


def _font(size: int, bold: bool) -> ImageFont.FreeTypeFont:
    names = (
        ["georgiab.ttf", "timesbd.ttf", "arialbd.ttf"]
        if bold
        else ["georgia.ttf", "times.ttf", "arial.ttf"]
    )
    for name in names:
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default(size)


def render_page_image(width: int = 1240, height: int = 1754) -> Image.Image:
    """A4 at 150dpi, with the mild noise and skew a real scan has."""
    image = Image.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(image)

    y = 150
    for text, size, bold in PAGE_LINES:
        if text:
            draw.text((130, y), text, font=_font(size, bold), fill=(18, 18, 20))
        y += int(size * 1.9)

    # Scanner artefacts: slight blur, speckle, a faint off-white cast and a small skew.
    image = image.filter(ImageFilter.GaussianBlur(0.4))
    pixels = image.load()
    rng = random.Random(7)
    for _ in range(int(width * height * 0.004)):
        x = rng.randrange(width)
        y2 = rng.randrange(height)
        shade = rng.randint(180, 240)
        pixels[x, y2] = (shade, shade, shade)
    image = image.rotate(0.35, resample=Image.BICUBIC, fillcolor="white")
    return image


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    png = OUT / "scanned_page.png"
    pdf = OUT / "proposal_scanned.pdf"

    image = render_page_image()
    image.save(png)

    # Draw the image full-bleed and write no text, so the PDF has no text layer at all.
    c = pdfcanvas.Canvas(str(pdf), pagesize=A4)
    c.drawImage(ImageReader(png), 0, 0, width=A4[0], height=A4[1])
    c.showPage()
    c.save()

    print(f"wrote {png}")
    print(f"wrote {pdf}")


if __name__ == "__main__":
    main()
