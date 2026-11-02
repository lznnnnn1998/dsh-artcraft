---
name: artcraft-brand-kit
description: "Use when the user wants a brand or design handoff — a design system turned into real assets and a brand book. FigCraft for the system, exported PNG/SVG for the assets, DesignCraft for the document, PDF out. Also for \"take my Figma/FigCraft file and give me a brand sheet\"."
---

# A brand kit from a design system

One design system produces many artefacts: the source file, exported assets at fixed sizes, a
vector logo that survives scaling, and a document that explains the whole thing. Four
applications cover that, and each owns one step.

## The chain

```
FigCraft            →  FigCraft export      →  VectorCraft (optional)  →  DesignCraft      →  PDF
design system +     PNG/SVG per frame          trace/clean vector art     brand book         delivery
component library   at 1x/2x/3x                (svg, eps)                 (place + text)
```

## Verified steps

**1. Build or open the system in FigCraft.** Colour and text styles, variables and components are
commands like any other; the palette is data, not an image.

```text
figcraft_run   {"commands": [{"id": "frame.create", "json": {"name": "Brand / Cover", "width": 1440, "height": 900}},
                             {"id": "node.create",  "json": {"type": "rectangle", "x": 0, "y": 0, "width": 1440, "height": 900}}],
                "save": "brand.figcraft"}
figcraft_inspect {"file": "brand.figcraft"}
```

**2. Export assets at print and screen size.** The export verb writes one file per top-level frame
when `--out` is a folder, and a single file when it has an image extension.

```text
figcraft_convert {"input": "brand.figcraft", "output": "cover.png"}   # one page/frame to an image
figcraft_run     {"input": "brand.figcraft", "save": "brand.figcraft"} # keep the source updated
```

For a size matrix, convert each frame by name (`cover.png`, `cover@2x.png`) or export from the app;
`convert` picks the format from the output extension.

Verified: `figcraft-cli export brand.figcraft --out hero.png` wrote a PNG. Exports carry the file's
colour profile, so sRGB and Display P3 files stay distinct — check which one the user needs.

**3. Vector work when the logo must scale.** VectorCraft opens SVG/PDF/AI/EPS and exports the same
set; use it for outlines, expanded strokes and artboard-per-size files. A raster export is fine for
the book, never for a logo.

**4. Lay out the brand book in DesignCraft.** `file.place` takes an image (or PDF page) with an
explicit `x`, `y`, `width`; text files (`.md`, `.txt`, `.docx`) place as text frames, and `.xlsx`
places as a table.

```text
designcraft_run {"commands": [
  {"id": "file.new", "json": {}},
  {"id": "file.place", "json": {"path": "assets/cover.png", "x": 0, "y": 0, "width": 595}},
  {"id": "file.place", "json": {"path": "copy/brand-story.md", "x": 72, "y": 520, "width": 451}},
  {"id": "file.exportPdf", "json": {"path": "brand-book.pdf"}}]}
```

`file.place` also takes `pdfPage`, `pdfCrop` and `rect` — a placed PDF page is a live graphic, so a
datasheet keeps its own vector content instead of becoming a screenshot.

**5. Look at it.** DesignCraft has no separate inspect tool — use `designcraft_mcp_tools` for its
document tools, and render the exported PDF (PdfCraft `page_render`) then `read_image` the page. A
brand page that "exported fine" can still have the logo cropped by the margin.

## What makes this the right tool for the job

- The design system stays **data**: colours, type styles and components are edited as commands, so
  a palette change is one command, not twelve re-exports.
- Frames export per artboard, so the size matrix (1x/2x/3x, web/print) is a loop, not manual work.
- The book is a real layout document; DesignCraft places the *same* assets the front-end consumes.

## Pitfalls

- **Export by extension.** `--out` ending in `.png` writes one file; a folder writes one per frame.
  Mixing the two silently produces the wrong number of files.
- **The colour profile travels with the file.** A Display P3 PNG looks wrong wherever P3 is not
  interpreted; say which profile you exported.
- **Text placed from a file is a frame, not live text.** Editing the copy means editing the source
  file and re-placing, or using a text frame.
- **DesignCraft page geometry** is points (A4 = 595×842). A 1440-px-wide export is 2.4× too wide for
  the page at 1:1 — scale on placement with `width`.

## Boundaries

Needs FigCraft and DesignCraft installed; the assets and the book are produced by the applications,
not by a drawing library, so what the user opens is what the app shows.
