---
name: artcraft-cad-set
description: "Use when the deliverable is a drawing package — a CAD drawing or a set of them delivered as PDF/PNG with a cover and a merged set. CADCraft for the geometry, CADCraft convert for the sheets, PdfCraft to combine and stamp. Also for \"turn this DXF into a PDF I can send\"."
---

# A drawing set from CADCraft

Drawings leave CAD as sheets, never as a raw `.dxf`. The job is: draw accurately in CADCraft, export
the views, and deliver one PDF — with a cover, page numbers and no missing sheet.

## The chain

```
CADCraft                  →  CADCraft convert      →  PdfCraft               →  delivery
layers, geometry,            PDF/PNG per sheet         combine, bookmarks,       one PDF
dimensions, title block      at a fixed window         reduce, stamp
```

## Verified steps

**1. Draw.** The `run` verb takes `--cmd '<id> {json}'` per command, `--save` for the drawing and
`--export` for a raster of the current view.

```text
cadcraft_run {"commands": [
  {"id": "line", "json": {"points": [[0, 0], [200, 120], [240, 0]]}}],
  "save": "plan.dxf"}
```

Verified: `cadcraft-cli run --cmd 'line {"points":[[0,0],[200,120],[240,0]]}' --save plan.dxf`
wrote a 18,640-byte DXF. Units matter: a new drawing is **imperial** unless `--metric` is passed.

**2. Export the sheets.** `convert` picks the format from the output extension — `dxf`, `dwg`,
`dwt`, **`svg`**, **`png`**, **`pdf`**.

```text
cadcraft_convert {"input": "plan.dxf", "output": "plan.pdf"}
cadcraft_convert {"input": "plan.dxf", "output": "plan.png"}
```

Verified: a DXF converted to a 1,069-byte PDF and a 29,213-byte PNG. Image/PDF output shows model
space fitted to the drawing extents — `--window x0,y0,x1,y1` and `--view` change the framing, and
the wrong framing is the usual cause of a sheet with the title block cut off.

**3. Combine into a set.** PdfCraft's `doc_combine` takes the files in order, keeps one bookmark per
file, and can stamp/reduce.

```text
pdfcraft_mcp_call {"tool": "doc_combine", "arguments": {"paths": ["cover.pdf", "plan.pdf", "details.pdf"], "out": "set.pdf"}}
```

Verified schema: `{paths, out?, pages?, passwords?, groups?, field_conflicts?}`. `pages` selects
pages per file (`"1-3, 6"`), so a multi-sheet source can contribute one sheet.

**4. Look at every sheet.** Render the combined PDF pages (PdfCraft `page_render`) and `read_image`
them. Check: the title block is inside the page, dimensions are legible at the delivered size, and
nothing is clipped by the extents fit.

## Rules that keep a set usable

- **One layer per discipline** (walls, dimensions, notes). A combined drawing with everything on
  layer 0 cannot be turned off by the person receiving it.
- **Export each sheet from its own view.** A single conversion of a multi-layout drawing gives one
  page; export per sheet and combine afterwards.
- **PDF is the delivery, DXF is the source.** Keep both; a receiver edits the DXF and reads the PDF.
- **Reduce, don't re-render.** PdfCraft `doc_reduce` downsamples images to delivery size; a 40 MB
  set is usually an image-resolution problem, not vector detail.

## Boundaries

Needs CADCraft (and PdfCraft for the set). The geometry is the application's, so dimensions and
linetypes behave as the user's CAD does. For plotting to a physical printer's paper size, set the
page setup in CADCraft rather than scaling the PDF afterwards.
