#!/usr/bin/env python3
"""
pdf_stamp.py — piracy deterrent: stamp every page of a PDF with a buyer
license footer ("Licensed to <email> — do not share").

Technique: fpdf2 renders a 1-page stamp PDF at the exact page size, then
pypdf merges it onto every page of the input. Pure-Python, no system deps.

Usage:
    python3 pdf_stamp.py <input.pdf> <buyer-email> <output.pdf>

Prints a JSON result line to stdout.
"""
import json
import sys
import tempfile
import os


def main() -> int:
    if len(sys.argv) != 4:
        print(json.dumps({"ok": False, "error": "usage: pdf_stamp.py <input.pdf> <buyer-email> <output.pdf>"}))
        return 2
    in_pdf, email, out_pdf = sys.argv[1], sys.argv[2].strip(), sys.argv[3]
    if "@" not in email or len(email) > 254:
        print(json.dumps({"ok": False, "error": "invalid buyer email"}))
        return 1
    try:
        from pypdf import PdfReader, PdfWriter
        from fpdf import FPDF
    except ImportError as e:
        print(json.dumps({"ok": False, "error": f"missing dependency: {e.name}"}))
        return 1

    try:
        reader = PdfReader(in_pdf)
        if not reader.pages:
            print(json.dumps({"ok": False, "error": "input PDF has no pages"}))
            return 1
        box = reader.pages[0].mediabox
        w_pt, h_pt = float(box.width), float(box.height)

        # 1-page stamp at the exact page size (fpdf2, unit=pt).
        stamp = FPDF(unit="pt", format=(w_pt, h_pt))
        stamp.set_auto_page_break(False)
        stamp.add_page()
        stamp.set_font("Helvetica", "I", 7)
        stamp.set_text_color(130, 130, 130)
        label = f"Licensed to {email} - do not share or forward"
        stamp.set_xy(0, h_pt - 28)
        stamp.cell(w=w_pt, h=12, text=label, align="C")

        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tf:
            stamp_path = tf.name
        stamp.output(stamp_path)
        stamp_page = PdfReader(stamp_path).pages[0]

        writer = PdfWriter()
        for page in reader.pages:
            page.merge_page(stamp_page)
            writer.add_page(page)
        with open(out_pdf, "wb") as f:
            writer.write(f)
        os.unlink(stamp_path)
        print(json.dumps({"ok": True, "pages": len(reader.pages), "output": out_pdf}))
        return 0
    except Exception as e:  # never leak a traceback to the caller
        print(json.dumps({"ok": False, "error": f"stamp failed: {str(e)[:200]}"}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
