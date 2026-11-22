#!/usr/bin/env python3
"""Digital docs bridge — structured spec (JSON) -> DOCX / PPTX / EPUB / XLSX.

Usage: python3 docs_bridge.py <docx|pptx|epub|xlsx> <spec.json> <out>
Prints a JSON result object on stdout (last line). Errors -> exit 1.

Engines (all pure-python, no system libs):
  docx -> python-docx, pptx -> python-pptx, epub -> EbookLib,
  xlsx -> openpyxl.
Deploy: pip install python-docx python-pptx EbookLib openpyxl.

Honest limits, kept in the doc too:
  - Interactive PDF forms are NOT built here (fpdf2 has no AcroForm
    support); this bridge covers office/ebook/spreadsheet files only.
  - PPTX/EPUB/XLSX content comes from the caller as structured data —
    the bridge renders it faithfully; it does not invent content.
"""
import json
import sys


def _fail(msg: str):
    print(f"docs_bridge: {msg}", file=sys.stderr)
    return 1


def _bottom_border(paragraph, color="E4572E", size="12"):
    """Premium touch: a thin accent rule under a paragraph (DOCX)."""
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn

    pPr = paragraph._p.get_or_add_pPr()
    pBdr = OxmlElement("w:pBdr")
    bottom = OxmlElement("w:bottom")
    bottom.set(qn("w:val"), "single")
    bottom.set(qn("w:sz"), size)
    bottom.set(qn("w:space"), "4")
    bottom.set(qn("w:color"), color)
    pBdr.append(bottom)
    pPr.append(pBdr)


def build_docx(spec: dict, out_path: str) -> dict:
    from docx import Document
    from docx.shared import Pt, RGBColor

    doc = Document()
    title = str(spec.get("title", "Untitled")).strip() or "Untitled"
    title_para = doc.add_heading(title, level=0)
    if title_para.runs:
        title_para.runs[0].font.size = Pt(28)
        title_para.runs[0].font.bold = True
        title_para.runs[0].font.color.rgb = RGBColor(0x1C, 0x1C, 0x22)
    subtitle = str(spec.get("subtitle", "")).strip()
    if subtitle:
        p = doc.add_paragraph(subtitle)
        if p.runs:
            p.runs[0].font.size = Pt(13)
            p.runs[0].font.italic = True
            p.runs[0].font.color.rgb = RGBColor(0x5C, 0x5C, 0x66)
    author = str(spec.get("author", "")).strip()
    if author:
        p = doc.add_paragraph(author)
        if p.runs:
            p.runs[0].font.size = Pt(10)
            p.runs[0].font.color.rgb = RGBColor(0x8A, 0x8A, 0x8A)
    _bottom_border(doc.add_paragraph(""))
    sections = spec.get("sections", []) or []
    for sec in sections:
        heading = str(sec.get("heading", "")).strip()
        if heading:
            h = doc.add_heading(heading, level=1)
            if h.runs:
                h.runs[0].font.color.rgb = RGBColor(0xB4, 0x55, 0x1F)
        for para in sec.get("paragraphs", []) or []:
            text = str(para).strip()
            if text:
                doc.add_paragraph(text)
        for bullet in sec.get("bullets", []) or []:
            text = str(bullet).strip()
            if text:
                doc.add_paragraph(text, style="List Bullet")
    doc.save(out_path)
    return {"engine": "python-docx", "sections": len(sections)}


def build_pptx(spec: dict, out_path: str) -> dict:
    from pptx import Presentation
    from pptx.dml.color import RGBColor
    from pptx.enum.shapes import MSO_SHAPE
    from pptx.util import Inches, Pt

    ACCENT = RGBColor(0xFF, 0x6B, 0x35)
    GREY = RGBColor(0x8A, 0x8A, 0x8A)

    def accent_bar(slide):
        bar = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0), Inches(0), Inches(13.33), Inches(0.06))
        bar.fill.solid()
        bar.fill.fore_color.rgb = ACCENT
        bar.line.fill.background()

    def footer(slide, text):
        box = slide.shapes.add_textbox(Inches(0.7), Inches(7.05), Inches(11.9), Inches(0.35))
        tf = box.text_frame
        tf.word_wrap = True
        p = tf.paragraphs[0]
        p.text = text
        p.font.size = Pt(10)
        p.font.color.rgb = GREY

    prs = Presentation()
    prs.slide_width = Inches(13.33)
    prs.slide_height = Inches(7.5)
    title = str(spec.get("title", "Untitled")).strip() or "Untitled"
    subtitle = str(spec.get("subtitle", "")).strip()

    title_layout = prs.slide_layouts[0]
    slide = prs.slides.add_slide(title_layout)
    slide.shapes.title.text = title
    if len(slide.placeholders) > 1:
        slide.placeholders[1].text = subtitle
    accent_bar(slide)

    slides = spec.get("slides", []) or []
    content_layout = prs.slide_layouts[1]
    for idx, item in enumerate(slides, 2):
        s = prs.slides.add_slide(content_layout)
        s.shapes.title.text = str(item.get("title", "")).strip() or "Slide"
        bullets = item.get("bullets", []) or []
        if bullets and len(s.placeholders) > 1:
            tf = s.placeholders[1].text_frame
            tf.word_wrap = True
            tf.text = str(bullets[0]).strip()
            for b in bullets[1:]:
                p = tf.add_paragraph()
                p.text = str(b).strip()
                p.level = 0
        notes = str(item.get("notes", "")).strip()
        if notes:
            s.notes_slide.placeholders[1].text = notes
        accent_bar(s)
        footer(s, f"{title}  •  {idx}")
    prs.save(out_path)
    return {"engine": "python-pptx", "slides": len(slides) + 1}


def build_epub(spec: dict, out_path: str) -> dict:
    from ebooklib import epub

    title = str(spec.get("title", "Untitled")).strip() or "Untitled"
    author = str(spec.get("author", "")).strip()
    book = epub.EpubBook()
    book.set_identifier(f"digital-{abs(hash(title)) % 10**10}")
    book.set_title(title)
    book.set_language(str(spec.get("language", "en") or "en"))
    if author:
        book.add_author(author)

    chapters = spec.get("chapters", []) or []
    items = []
    for i, ch in enumerate(chapters, 1):
        heading = str(ch.get("heading", "")).strip() or f"Chapter {i}"
        paras = "".join(
            f"<p>{_escape_html(str(p))}</p>"
            for p in (ch.get("paragraphs", []) or [])
            if str(p).strip()
        )
        c = epub.EpubHtml(title=heading, file_name=f"chap-{i}.xhtml", lang="en")
        c.content = f"<h1>{_escape_html(heading)}</h1>{paras}"
        book.add_item(c)
        items.append(c)

    book.toc = tuple(items)
    book.add_item(epub.EpubNcx())
    book.add_item(epub.EpubNav())
    book.spine = ["nav"] + items
    epub.write_epub(out_path, book)
    return {"engine": "EbookLib", "chapters": len(items)}


def _escape_html(text: str) -> str:
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def build_xlsx(spec: dict, out_path: str) -> dict:
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill

    HEADER_FILL = PatternFill(start_color="1C1C22", end_color="1C1C22", fill_type="solid")
    BAND_FILL = PatternFill(start_color="F5F2EC", end_color="F5F2EC", fill_type="solid")
    title = str(spec.get("title", "Sheet")).strip() or "Sheet"
    wb = Workbook()
    wb.remove(wb.active)
    sheets = spec.get("sheets", []) or []
    total_rows = 0
    for idx, sh in enumerate(sheets):
        name = str(sh.get("name", f"Sheet{idx + 1}") or f"Sheet{idx + 1}")[:31]
        ws = wb.create_sheet(title=name)
        headers = sh.get("headers", []) or []
        rows = sh.get("rows", []) or []
        # Title row (merged across the header width, or 1 col).
        width = max(1, len(headers))
        ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=width)
        ws.cell(row=1, column=1, value=title).font = Font(bold=True, size=14)
        if headers:
            for j, h in enumerate(headers, 1):
                cell = ws.cell(row=2, column=j, value=str(h))
                cell.font = Font(bold=True, color="FFFFFF")
                cell.fill = HEADER_FILL
            ws.freeze_panes = "A3"
            start_row = 3
        else:
            start_row = 2
        for i, row in enumerate(rows):
            for j, value in enumerate(row, 1):
                # JSON numbers stay numeric, strings stay strings — the
                # bridge never coerces a value, so sums/formulas keep working.
                cell = ws.cell(row=start_row + i, column=j, value=value)
                if i % 2 == 1:
                    cell.fill = BAND_FILL
            total_rows += 1
        # Column widths from the longest cell, capped so one long cell
        # does not blow the sheet out. (Row 1 is merged for the title,
        # so its cells are MergedCell — use get_column_letter, not the
        # cell object, to address the column.)
        from openpyxl.utils import get_column_letter

        for j in range(1, width + 1):
            longest = 0
            for r in range(1, ws.max_row + 1):
                v = ws.cell(row=r, column=j).value
                if v is not None:
                    longest = max(longest, len(str(v)))
            ws.column_dimensions[get_column_letter(j)].width = min(48, max(12, longest + 2))
    if not sheets:
        ws = wb.create_sheet(title="Sheet1")
        ws.cell(row=1, column=1, value=title).font = Font(bold=True, size=14)
    wb.save(out_path)
    return {"engine": "openpyxl", "sheets": len(sheets), "rows": total_rows}


BUILDERS = {
    "docx": build_docx,
    "pptx": build_pptx,
    "epub": build_epub,
    "xlsx": build_xlsx,
}


def main() -> int:
    if len(sys.argv) != 4 or sys.argv[1] not in BUILDERS:
        print(
            "usage: docs_bridge.py <docx|pptx|epub|xlsx> <spec.json> <out>",
            file=sys.stderr,
        )
        return 1
    with open(sys.argv[2], encoding="utf-8") as fh:
        spec = json.load(fh)
    if not isinstance(spec, dict):
        return _fail("spec must be a JSON object")
    result = BUILDERS[sys.argv[1]](spec, sys.argv[3])
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    sys.exit(main())
