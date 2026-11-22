#!/usr/bin/env python3
"""Printable planner bridge — structured spec (JSON) -> A4 PDF (fpdf2).

Usage: python3 planner_bridge.py <spec.json> <out.pdf>
Prints a JSON result object on stdout (last line). Errors -> exit 1.

Spec:
  {"title": str, "type": "daily"|"weekly",
   "days": [{"date": "2026-11-09", "label": "Monday"}],
   "goals": [str x3], "habits": [str x5]}

Daily page: date header + Top-3 priorities (checkbox rows) + hourly
schedule 06:00-22:00 + habit checkboxes + notes box.
Weekly page: 7-day grid (one column per day) + weekly goals + notes.

Honest limits:
  - Printable PDF only. Hyperlinked / fillable digital planners are NOT
    built here (fpdf2 has no AcroForm / link support) — see
    docs/digital-products.md.
  - Dates come from the caller; the bridge draws the pages, it never
    invents content.
"""
import json
import sys

ACCENT = (180, 85, 31)
DARK = (28, 28, 34)
MUTED = (92, 92, 102)
LIGHT_LINE = (220, 218, 210)


def _fail(msg: str):
    print(f"planner_bridge: {msg}", file=sys.stderr)
    return 1


def _safe(text: str) -> str:
    """Core fonts are Latin-1 only — map common punctuation, then drop
    anything still unsupported instead of crashing the whole render."""
    repl = {"•": "-", "—": "-", "–": "-", "…": "...", "“": '"', "”": '"', "‘": "'", "’": "'"}
    for k, v in repl.items():
        text = text.replace(k, v)
    return text.encode("latin-1", "replace").decode("latin-1")


def _header(pdf, title: str, sub: str):
    pdf.set_font("Helvetica", "B", 20)
    pdf.set_text_color(*DARK)
    pdf.cell(0, 10, _safe(title), new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 11)
    pdf.set_text_color(*MUTED)
    pdf.cell(0, 7, _safe(sub), new_x="LMARGIN", new_y="NEXT")
    pdf.set_draw_color(*ACCENT)
    pdf.set_line_width(0.8)
    pdf.line(pdf.l_margin, pdf.get_y() + 2, 210 - pdf.r_margin, pdf.get_y() + 2)
    pdf.ln(6)


def _section(pdf, label: str):
    pdf.set_font("Helvetica", "B", 11)
    pdf.set_text_color(*ACCENT)
    pdf.cell(0, 7, label.upper(), new_x="LMARGIN", new_y="NEXT")
    pdf.ln(1)


def _checkbox_row(pdf, text: str, width: float):
    y = pdf.get_y()
    pdf.set_draw_color(*MUTED)
    pdf.set_line_width(0.4)
    pdf.rect(pdf.l_margin, y + 1, 4, 4)
    pdf.set_font("Helvetica", "", 10)
    pdf.set_text_color(*DARK)
    pdf.set_x(pdf.l_margin + 7)
    pdf.cell(width - 7, 6, _safe(text), new_x="LMARGIN", new_y="NEXT")


def _daily_page(pdf, title: str, day: dict, goals: list, habits: list):
    pdf.add_page()
    _header(pdf, title, f"{day['label']}  •  {day['date']}")
    _section(pdf, "Top 3 priorities")
    for i in range(3):
        _checkbox_row(pdf, goals[i] if i < len(goals) else "", 190)
    pdf.ln(3)
    _section(pdf, "Schedule")
    pdf.set_font("Helvetica", "", 9)
    for hour in range(6, 23):
        pdf.set_text_color(*MUTED)
        pdf.cell(14, 6, f"{hour:02d}:00", new_x="RIGHT", new_y="LAST")
        pdf.set_draw_color(*LIGHT_LINE)
        pdf.set_line_width(0.3)
        pdf.line(pdf.get_x(), pdf.get_y() + 5, 210 - pdf.r_margin, pdf.get_y() + 5)
        pdf.ln(6)
    pdf.ln(2)
    _section(pdf, "Habits")
    x0 = pdf.l_margin
    for h in habits:
        pdf.set_font("Helvetica", "", 9)
        pdf.set_text_color(*DARK)
        pdf.set_draw_color(*MUTED)
        pdf.set_line_width(0.4)
        y = pdf.get_y()
        pdf.rect(x0, y + 1, 4, 4)
        pdf.set_x(x0 + 7)
        pdf.cell(0, 6, _safe(h), new_x="LMARGIN", new_y="NEXT")
    pdf.ln(3)
    _section(pdf, "Notes")
    pdf.set_draw_color(*LIGHT_LINE)
    pdf.rect(pdf.l_margin, pdf.get_y(), 190, 28)
    for _ in range(3):
        pdf.ln(7)


def _weekly_page(pdf, title: str, days: list, goals: list):
    pdf.add_page()
    first = days[0]["date"] if days else ""
    _header(pdf, title, f"Week of {first}")
    _section(pdf, "This week")
    col_w = 190 / 7
    x0 = pdf.l_margin
    y0 = pdf.get_y()
    pdf.set_font("Helvetica", "B", 8)
    for i, d in enumerate(days):
        x = x0 + i * col_w
        pdf.set_xy(x, y0)
        pdf.set_text_color(*DARK)
        pdf.cell(col_w, 5, _safe(d["label"][:3].upper()), align="C")
        pdf.set_xy(x, y0 + 5)
        pdf.set_font("Helvetica", "", 8)
        pdf.set_text_color(*MUTED)
        pdf.cell(col_w, 5, d["date"][5:], align="C")
        pdf.set_font("Helvetica", "B", 8)
    # grid body: 3 blank lines per day column
    pdf.set_draw_color(*LIGHT_LINE)
    pdf.set_line_width(0.3)
    top = y0 + 11
    pdf.rect(x0, top, 190, 66)
    for i in range(1, 7):
        pdf.line(x0 + i * col_w, top, x0 + i * col_w, top + 66)
    for r in range(1, 3):
        pdf.line(x0, top + r * 22, x0 + 190, top + r * 22)
    pdf.set_y(top + 72)
    _section(pdf, "Weekly goals")
    for i in range(3):
        _checkbox_row(pdf, goals[i] if i < len(goals) else "", 190)
    pdf.ln(3)
    _section(pdf, "Notes")
    pdf.set_draw_color(*LIGHT_LINE)
    pdf.rect(pdf.l_margin, pdf.get_y(), 190, 28)


def main() -> int:
    if len(sys.argv) != 3:
        return _fail("usage: planner_bridge.py <spec.json> <out.pdf>")
    spec_path, out_path = sys.argv[1], sys.argv[2]
    try:
        with open(spec_path, encoding="utf-8") as f:
            spec = json.load(f)
    except Exception as e:
        return _fail(f"cannot read spec: {e}")
    ptype = spec.get("type", "daily")
    title = str(spec.get("title", "Planner")).strip() or "Planner"
    days = spec.get("days", []) or []
    goals = [str(g) for g in (spec.get("goals", []) or [])][:3]
    habits = [str(h) for h in (spec.get("habits", []) or [])][:5]
    if not days:
        return _fail("planner needs at least 1 day")
    try:
        from fpdf import FPDF

        pdf = FPDF(orientation="P", unit="mm", format="A4")
        pdf.set_auto_page_break(auto=True, margin=15)
        pdf.set_margins(10, 12, 10)
        if ptype == "weekly":
            for i in range(0, len(days), 7):
                _weekly_page(pdf, title, days[i : i + 7], goals)
            pages = (len(days) + 6) // 7
        else:
            for d in days:
                _daily_page(pdf, title, d, goals, habits)
            pages = len(days)
        pdf.output(out_path)
    except Exception as e:
        return _fail(f"render failed: {e}")
    print(json.dumps({"engine": "fpdf2", "pages": pages, "type": ptype}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
