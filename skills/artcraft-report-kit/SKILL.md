---
name: artcraft-report
description: Use when the user wants a data-backed report or document — a PDF, DOCX, or a page deck — with headings, narrative text and charts, built in the real applications (WordCraft for the document, GridCraft for the numbers) and verified page by page by rendering it.
---

# Data-backed reports in the real applications

Build the document in **WordCraft** and the numbers in **GridCraft**, then export and *look at
every page*. The chart is a native Word chart — editable in Word, PowerPoint and Google Docs —
not a flattened picture of one.

Use this when the deliverable is a report, brief, memo or proposal that a person will open in
Word and may edit. Do **not** reach for `python-docx` for the same job: it has no chart API, so
its only chart is an embedded matplotlib image, and the result cannot be edited as a chart.

## The two surfaces, and which one a report needs

| Tool | Use it for |
|---|---|
| `wordcraft_mcp_call` (`new_document`, `type_text`, `batch`, `save_document`, `render_page`) | Everything a report needs: paragraphs, headings, native charts, page rendering. **This is the main surface.** |
| `wordcraft_run` + `wordcraft_commands` | Registry-only actions the MCP tool set does not model (cover pages, section breaks, table formatting, references, review). |
| `gridcraft_run` / `gridcraft_mcp_call` | Prepare and check the numbers; a report's figures usually start here. |

## Verified recipe

This sequence was run end to end; every call returned what it says, and page 1 was rendered and
inspected. Values are examples — keep the shapes.

```text
1  wordcraft_mcp_call  new_document      {"template": "blank"}
2  wordcraft_mcp_call  type_text         {"text": "2026 Q3 Revenue Report", "paragraphs": true}
3  wordcraft_mcp_call  batch             {"commands": [{"command": "para.heading1"},
                                                     {"command": "text.newParagraph"}]}
4  wordcraft_mcp_call  type_text         {"text": "Revenue grew 12% quarter over quarter…", "paragraphs": true}
5  wordcraft_mcp_call  batch             {"commands": [
                                            {"command": "text.newParagraph"},
                                            {"command": "insert.chart", "params": {
                                              "type": "column", "title": "Quarterly revenue (M USD)",
                                              "legend": "bottom", "dataLabels": true,
                                              "width": 400, "height": 200,
                                              "data": {"categories": ["Q1","Q2","Q3"],
                                                       "series": [{"name": "Revenue","values": [120,135,151]}]}}}]}
6  wordcraft_mcp_call  save_document     {"path": "report.pdf"}
7  wordcraft_mcp_call  render_page       {"page": 1, "scale": 1.5}   → prints an image path
8  read_image          <that path>        ← look at it before saying it is done
```

`save_document` picks the format from the extension: `.docx` (editable), `.pdf` (delivery),
`.png` (a page image). Save both when the user needs to edit and to send.

### Chart parameters

`insert.chart` takes `{type, data: {categories, series: [{name, values}]}, title, legend, dataLabels, width, height}`.

- `type`: `column | columnStacked | bar | barStacked | line | area | pie | doughnut | scatter`.
- Without `data` the command opens the type picker instead of creating a chart — always pass data.
- `width`/`height` are points. 400×200 fits an A4 body column; wider overflows the margin.
- A chart is the reason to use this app: the numbers stay linked and the chart stays editable.

### The numbers side

Keep the figures in one place and let the document quote them:

```text
gridcraft_mcp_call  {"tool": "write_range", "arguments": {"range": "A1:C4", "values": [...]}}
gridcraft_run       {"commands": [{"id": "insert.chart", …}], "save": "figures.xlsx"}
```

A workbook the user can re-check beats numbers typed twice.

## Verification loop

Text and charts must be looked at, not assumed:

1. `save_document` to `.pdf`, then `render_page` for each page (`page: 1`, `page: 2`, …).
2. `read_image` each returned path. Check: the heading is a heading, text does not run past the
   margin, the chart sits between paragraphs and is legible, and nothing overlapped.
3. Fix by editing the same document (commands act on the caret/selection), re-save, re-render.

`inspect_document` gives the structure when a page looks wrong: block order, paragraph styles,
table cells and each chart's data. Use it before editing blind.

## Pitfalls this recipe exists to avoid

- **`text.newParagraph` on a selection deletes the selected text.** It splits at the caret; with
  a selection it replaces it. Apply the heading first, then add the paragraph break — or collapse
  the selection with `select.collapse` (which goes to the *start* of the selection, so a
  heading-then-collapse-then-break sequence can strand an empty heading).
- **The caret starts at position 0** after `new_document`. Type the title before inserting
  anything; `insert.chart` and `insert.table` land at the caret, so inserting first puts the chart
  above the text.
- **`insert.table` creates an empty grid.** There is no headless cell-filling: `type_text` types
  literal `\t` and `\n` into one cell, and the catalog has no "next cell" command. For a table of
  numbers, either put the figures in a chart, build the table in GridCraft and place its image, or
  keep a two-column "value — label" list in text. Say which one you chose rather than shipping an
  empty table.
- **Page size is A4** (595×842 pt) by default; set US Letter explicitly when the user needs it.
- **Fonts**: a document opened on another machine renders with that machine's fonts. Prefer the
  document theme's fonts unless the user names a face.
- **A `.pdf` is a delivery format.** Keep the `.docx` alongside it; the user edits the docx.

## Boundaries

- Like every ArtCraft plugin, this needs the applications installed. On a machine without them,
  the library route (`docx`, `openpyxl`) is the fallback — with a flattened chart.
- Figures that must recalculate belong in GridCraft; the document quotes them. Do not hardcode a
  total in prose that the sheet computes.
