#!/usr/bin/env python3"""
"""Ebook PDF bridge — structured book spec (JSON) -> styled PDF via fpdf2.

Usage: python3 pdf_bridge.py <spec.json> <out.pdf>
Spec:  {title, subtitle, author, footer, chapters: [{heading, paragraphs: [str]}]}
Prints: {"pages": N, "engine": "fpdf2"} on stdout. Errors -> exit 1.

A5 pages, cover page, table of contents (two-pass so TOC page numbers are
real), one chapter per page start, page-number footer. Prefers DejaVu TTF
(Unicode) and falls back to core Helvetica with latin-1 sanitizing.
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


def sanitize(text: str, unicode_ok: bool) -> str:
    if unicode_ok:
        return text
    return text.encode("latin-1", "replace").decode("latin-1")


class Book(FPDF):
    def __init__(self, title: str, unicode_ok: bool):
        super().__init__(format="A5", unit="mm")
        self.book_title = title
        self.unicode_ok = unicode_ok
        self.on_cover = True
        self.set_auto_page_break(True, margin=18)
        self.set_margins(16, 18, 16)

    def footer(self):
        if self.on_cover:
            return
        self.set_y(-14)
        self.set_font(self.font_family, "", 8)
        self.set_text_color(120, 120, 120)
        self.cell(0, 8, f"- {self.page_no()} -", align="C")


def build(spec: dict, out_path: str, toc_pages: dict | None) -> dict:
    pair = _dejavu_pair()
    unicode_ok = pair is not None
    pdf = Book(spec.get("title", "Untitled"), unicode_ok)
    if unicode_ok:
        pdf.add_font("deja", "", pair[0])
        pdf.add_font("deja", "B", pair[1])
        fam = "deja"
    else:
        fam = "helvetica"
    pdf.font_family = fam
    S = lambda t: sanitize(str(t), unicode_ok)  # noqa: E731

    chapters = spec.get("chapters", [])

    # ---- Cover ----
    pdf.add_page()
    pdf.on_cover = True
    pdf.ln(48)
    pdf.set_font(fam, "B", 26)
    pdf.set_text_color(20, 20, 25)
    pdf.multi_cell(0, 12, S(spec.get("title", "Untitled")), align="C")
    sub = spec.get("subtitle", "")
    if sub:
        pdf.ln(4)
        pdf.set_font(fam, "", 13)
        pdf.set_text_color(90, 90, 100)
        pdf.multi_cell(0, 7, S(sub), align="C")
    author = spec.get("author", "")
    if author:
        pdf.ln(26)
        pdf.set_font(fam, "", 12)
        pdf.set_text_color(60, 60, 70)
        pdf.cell(0, 8, S(author), align="C")

    # ---- TOC ----
    pdf.add_page()
    pdf.on_cover = False
    pdf.set_font(fam, "B", 16)
    pdf.set_text_color(20, 20, 25)
    pdf.cell(0, 10, S("Contents"), new_x="LMARGIN", new_y="NEXT")
    pdf.ln(3)
    pdf.set_font(fam, "", 11.5)
    pdf.set_text_color(50, 50, 60)
    for i, ch in enumerate(chapters, 1):
        page = toc_pages.get(i) if toc_pages else None
        label = f"{i}.  {S(ch.get('heading', ''))}"
        if page:
            label = f"{label}   -   {page}"
        pdf.multi_cell(0, 7.5, label)
        pdf.ln(1)

    # ---- Chapters ----
    chapter_start = {}
    for i, ch in enumerate(chapters, 1):
        pdf.add_page()
        chapter_start[i] = pdf.page_no()
        pdf.set_font(fam, "B", 15)
        pdf.set_text_color(20, 20, 25)
        pdf.multi_cell(0, 8.5, S(ch.get("heading", "")))
        pdf.ln(2)
        pdf.set_font(fam, "", 11)
        pdf.set_text_color(35, 35, 40)
        for para in ch.get("paragraphs", []):
            text = S(para).strip()
            if not text:
                continue
            pdf.multi_cell(0, 6.4, text)
            pdf.ln(2.6)

    if toc_pages is None:
        # First pass only: report where chapters start; caller re-renders.
        return {"chapterPages": chapter_start, "pages": pdf.page_no()}

    pdf.output(out_path)
    return {"pages": pdf.page_no(), "engine": "fpdf2"}


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: pdf_bridge.py <spec.json> <out.pdf>", file=sys.stderr)
        return 1
    with open(sys.argv[1], encoding="utf-8") as fh:
        spec = json.load(fh)
    probe = build(spec, sys.argv[2], None)
    result = build(spec, sys.argv[2], probe["chapterPages"])
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    sys.exit(main())
