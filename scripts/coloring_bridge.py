#!/usr/bin/env python3
"""Coloring-book PDF bridge — book spec (JSON) -> styled PDF via fpdf2.

Usage: python3 coloring_bridge.py <spec.json> <out.pdf>
Spec:  {title, author, coverImage: <rel path>|null, pages: [<rel image path>]}
Prints: {"pages": N, "engine": "fpdf2"} on stdout. Errors -> exit 1.

8.5x11in pages (KDP coloring trim). Cover page: title as real text +
colourful cover image (never AI-rendered text — it misspells). Then one
design per page + a BLANK page behind each design (KDP spec). Page
images are fitted to the page width, aspect preserved.
Deploy: pip install fpdf2 (pure python, no system libs).
"""
import json
import os
import sys

from fpdf import FPDF

# (regular, bold) candidate pairs, first existing pair wins.
# Alpine (font-dejavu package) first, then Debian/Ubuntu layout.
DEJAVU_PAIRS = [
    ("/usr/share/fonts/dejavu/DejaVuSans.ttf",
     "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf"),
    ("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
     "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
]


def _dejavu_pair():
    for regular, bold in DEJAVU_PAIRS:
        if os.path.exists(regular) and os.path.exists(bold):
            return (regular, bold)
    return None

# 8.5 x 11 inches in mm.
PAGE_W, PAGE_H = 215.9, 279.4
MARGIN = 16


def sanitize(text: str, unicode_ok: bool) -> str:
    if unicode_ok:
        return text
    return text.encode("latin-1", "replace").decode("latin-1")


class ColoringBook(FPDF):
    def __init__(self, title: str, unicode_ok: bool):
        super().__init__(format=(PAGE_W, PAGE_H), unit="mm")
        self.book_title = title
        self.unicode_ok = unicode_ok
        self.on_cover = True
        self.set_auto_page_break(False)
        self.set_margins(MARGIN, MARGIN, MARGIN)

    def footer(self):
        if self.on_cover:
            return
        self.set_y(-14)
        self.set_font(self.font_family, "", 8)
        self.set_text_color(120, 120, 120)
        self.cell(0, 8, f"- {self.page_no()} -", align="C")


def build(spec: dict, spec_dir: str, out_path: str) -> dict:
    pair = _dejavu_pair()
    unicode_ok = pair is not None
    pdf = ColoringBook(spec.get("title", "Untitled"), unicode_ok)
    if unicode_ok:
        pdf.add_font("deja", "", pair[0])
        pdf.add_font("deja", "B", pair[1])
        fam = "deja"
    else:
        fam = "helvetica"
    pdf.font_family = fam
    S = lambda t: sanitize(str(t), unicode_ok)  # noqa: E731

    pages = spec.get("pages", [])
    cover = spec.get("coverImage")

    # ---- Cover ----
    pdf.add_page()
    pdf.on_cover = True
    pdf.ln(30)
    pdf.set_font(fam, "B", 28)
    pdf.set_text_color(20, 20, 25)
    pdf.multi_cell(0, 13, S(spec.get("title", "Untitled")), align="C")
    author = spec.get("author", "")
    if author:
        pdf.ln(6)
        pdf.set_font(fam, "", 13)
        pdf.set_text_color(90, 90, 100)
        pdf.cell(0, 8, S(author), align="C")
    if cover:
        cover_path = os.path.join(spec_dir, cover)
        if os.path.exists(cover_path):
            pdf.ln(10)
            pdf.image(cover_path, x=MARGIN, y=pdf.get_y(), w=PAGE_W - 2 * MARGIN)

    # ---- Design pages + blank backs ----
    pdf.on_cover = False
    for rel in pages:
        path = os.path.join(spec_dir, rel)
        if not os.path.exists(path):
            continue
        pdf.add_page()
        pdf.image(path, x=MARGIN, y=MARGIN + 4, w=PAGE_W - 2 * MARGIN)
        # Blank page behind each design (KDP spec).
        pdf.add_page()

    pdf.output(out_path)
    return {"pages": pdf.page_no(), "engine": "fpdf2"}


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: coloring_bridge.py <spec.json> <out.pdf>", file=sys.stderr)
        return 1
    with open(sys.argv[1], encoding="utf-8") as fh:
        spec = json.load(fh)
    spec_dir = os.path.dirname(os.path.abspath(sys.argv[1]))
    result = build(spec, spec_dir, sys.argv[2])
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    sys.exit(main())
