"""Build the Tirek functional report from its reviewable Markdown source.

Use the document-authoring Python runtime with python-docx installed.
The report deliberately uses one page per functional section. Internal PDF and
PNG previews belong under .local and must not be committed.
"""
from __future__ import annotations

import argparse
import re
from pathlib import Path

from docx import Document
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_CELL_VERTICAL_ALIGNMENT

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SOURCE = ROOT / "docs/reports/functional-blocks-2026-10-24.md"


def field(paragraph, instruction):
    run = paragraph.add_run()
    begin = OxmlElement("w:fldChar")
    begin.set(qn("w:fldCharType"), "begin")
    code = OxmlElement("w:instrText")
    code.set(qn("xml:space"), "preserve")
    code.text = f" {instruction} "
    end = OxmlElement("w:fldChar")
    end.set(qn("w:fldCharType"), "end")
    run._r.extend([begin, code, end])


def text_runs(paragraph, text):
    for index, part in enumerate(re.split(r"\*\*(.*?)\*\*", text)):
        run = paragraph.add_run(part)
        run.bold = index % 2 == 1


def configure(document):
    section = document.sections[0]
    section.page_width, section.page_height = Cm(21), Cm(29.7)
    section.top_margin, section.bottom_margin = Cm(1.9), Cm(1.8)
    section.left_margin = section.right_margin = Cm(1.9)
    section.header_distance = section.footer_distance = Cm(0.8)
    for name in ["Normal", "Title", "Subtitle", "Heading 1", "Heading 2", "List Bullet", "List Number"]:
        style = document.styles[name]
        style.font.name = "Arial"
        style.font.color.rgb = RGBColor(0, 0, 0)
        style.font.size = Pt(11)
        style.paragraph_format.space_after = Pt(6)
        style.paragraph_format.line_spacing = 1.08
        style.paragraph_format.widow_control = True
    normal = document.styles["Normal"]
    normal._element.get_or_add_rPr().append(OxmlElement("w:lang"))
    normal._element.rPr[-1].set(qn("w:val"), "ru-RU")
    for name, size in [("Title", 26), ("Heading 1", 18), ("Heading 2", 12)]:
        style = document.styles[name]
        style.font.size, style.font.bold = Pt(size), True
        style.paragraph_format.keep_with_next = True
        style.paragraph_format.space_before = Pt(8 if name == "Heading 2" else 0)
        style.paragraph_format.space_after = Pt(8)
    # The bundled default template has a title rule and expanded tracking.
    # Remove these explicitly for the report's plain black heading style.
    for name in ["Title", "Subtitle", "Title Char", "Subtitle Char"]:
        if name not in document.styles:
            continue
        element = document.styles[name]._element
        for decoration in element.xpath("./w:pPr/w:pBdr | ./w:rPr/w:spacing"):
            decoration.getparent().remove(decoration)
    document.styles["Subtitle"].font.size = Pt(13)
    document.styles["Subtitle"].font.italic = False
    document.styles["Subtitle"].paragraph_format.space_after = Pt(15)
    for name in ["List Bullet", "List Number"]:
        document.styles[name].paragraph_format.space_after = Pt(5)
    header = section.header.paragraphs[0]
    header.text = "Tirek CRM    Функции и развитие продукта"
    header.runs[0].font.size = Pt(8)
    header.runs[0].font.color.rgb = RGBColor(0, 0, 0)
    footer = section.footer.paragraphs[0]
    footer.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    footer.add_run("24 октября 2026    •    ")
    field(footer, "PAGE")
    for run in footer.runs:
        run.font.size = Pt(8)
    document.core_properties.title = "Функциональные блоки Tirek CRM"
    document.core_properties.subject = "Реализованные возможности и требования к развитию CRM"
    document.core_properties.author = "Tirek CRM"
    document.core_properties.keywords = "CRM, задачи, клиенты, документы, финансы, требования"


def add_table(document, lines):
    rows = [[cell.strip() for cell in line.strip().strip("|").split("|")] for line in lines]
    rows = [row for row in rows if not all(re.fullmatch(r":?-+:?", cell) for cell in row)]
    assert rows and all(len(row) == len(rows[0]) for row in rows)
    count = len(rows[0])
    table = document.add_table(rows=0, cols=count)
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = False
    total = 17.2
    if rows[0][-1] == "Страница":
        widths = [3.0, 11.8, 2.4]
    elif count == 2:
        widths = [4.3, 12.9]
    else:
        widths = [4.0, 6.6, 6.6]
    assert abs(sum(widths) - total) < 0.01
    for column, width in zip(table.columns, widths):
        column.width = Cm(width)
    borders = OxmlElement("w:tblBorders")
    for side in ["top", "left", "bottom", "right", "insideH", "insideV"]:
        edge = OxmlElement(f"w:{side}")
        for key, value in {"val": "single", "sz": "4", "color": "D9D9D9"}.items():
            edge.set(qn(f"w:{key}"), value)
        borders.append(edge)
    table._tbl.tblPr.append(borders)
    for row_index, values in enumerate(rows):
        row = table.add_row()
        trpr = row._tr.get_or_add_trPr()
        trpr.append(OxmlElement("w:cantSplit"))
        if row_index == 0:
            trpr.append(OxmlElement("w:tblHeader"))
        for cell, value, width in zip(row.cells, values, widths):
            cell.width = Cm(width)
            cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
            tcpr = cell._tc.get_or_add_tcPr()
            shading = OxmlElement("w:shd")
            shading.set(qn("w:fill"), "E8EFF5" if row_index == 0 else ("F7F8FA" if row_index % 2 == 0 else "FFFFFF"))
            tcpr.append(shading)
            margins = OxmlElement("w:tcMar")
            for side, value_margin in [("top", 70), ("bottom", 70), ("left", 100), ("right", 100)]:
                element = OxmlElement(f"w:{side}")
                element.set(qn("w:w"), str(value_margin))
                element.set(qn("w:type"), "dxa")
                margins.append(element)
            tcpr.append(margins)
            p = cell.paragraphs[0]
            p.paragraph_format.space_after = Pt(0)
            p.paragraph_format.line_spacing = 1.0
            text_runs(p, value)
            for run in p.runs:
                run.font.size = Pt(10)
                if row_index == 0:
                    run.bold = True
    gap = document.add_paragraph()
    gap.paragraph_format.space_after = Pt(1)
    gap.paragraph_format.space_before = Pt(0)
    gap.paragraph_format.line_spacing = 1
    gap.add_run().font.size = Pt(3)


def build(source, output):
    text = source.read_text(encoding="utf-8")
    pages = re.split(r"(?m)^---\s*$", text)
    assert len(pages) == 24, f"Expected 24 sections, got {len(pages)}"
    document = Document()
    configure(document)
    for page_index, page in enumerate(pages):
        lines = page.strip().splitlines()
        i = 0
        while i < len(lines):
            line = lines[i].strip()
            if not line:
                i += 1
                continue
            if line.startswith("|"):
                table_lines = []
                while i < len(lines) and lines[i].strip().startswith("|"):
                    table_lines.append(lines[i])
                    i += 1
                add_table(document, table_lines)
                continue
            if line.startswith("# "):
                title = line[2:]
                assert not re.search(r"[^\w\s]", title), f"Punctuation in heading: {title}"
                p = document.add_paragraph(title, "Title" if page_index == 0 else "Heading 1")
                if page_index:
                    p.paragraph_format.page_break_before = True
            elif line.startswith("## "):
                title = line[3:]
                assert not re.search(r"[^\w\s]", title), f"Punctuation in heading: {title}"
                document.add_paragraph(title, "Heading 2")
            elif line.startswith("- "):
                text_runs(document.add_paragraph(style="List Bullet"), line[2:])
            elif re.match(r"^\d+\. ", line):
                text_runs(document.add_paragraph(style="List Number"), re.sub(r"^\d+\. ", "", line))
            elif page_index == 0 and line == "Описание возможностей и требований к развитию системы":
                document.add_paragraph(line, "Subtitle")
            else:
                text_runs(document.add_paragraph(), line)
            i += 1
    output.parent.mkdir(parents=True, exist_ok=True)
    document.save(output)
    print(f"Created {output.name}: {len(pages)} sections, {len(document.tables)} tables, {len(document.paragraphs)} paragraphs")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    build(args.source, args.output or args.source.with_suffix(".docx"))