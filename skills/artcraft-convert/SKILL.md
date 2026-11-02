---
name: artcraft-convert
description: Use when the task is "convert this file to X" — PDF, PNG, SVG, DOCX, PPTX, XLSX, MP4 — and the right application matters for fidelity. Routes each format to the craft that owns it instead of round-tripping through a generic converter.
---

# Convert with the application that owns the format

Every converter loses something. The rule here is: **convert with the application whose native
format the source is** — a `.docx` with WordCraft, a `.dxf` with CADCraft, a deck with DeckCraft —
and only then hand the result to PdfCraft for combination or reduction. A `.docx` forced through a
generic PDF converter loses page geometry; a deck exported by anything but its own engine loses
master layouts.

## Routing table (verified commands)

| Source → target | Surface | Command |
|---|---|---|
| WordCraft `.docx/.odt/.rtf/.md` → PDF/PNG/PDF | `wordcraft_convert` | `convert IN OUT` (extension decides; `--update-fields` refreshes fields) |
| CADCraft `.dxf/.dwg` → PDF/PNG/SVG | `cadcraft_convert` | `convert IN OUT` |
| DeckCraft `.deckcraft` → PNG/JPEG/PPTX/PDF/GIF | `deckcraft_run` | `file.export {path, format}`; `file.render {slide, scale}` |
| FigCraft `.figcraft/.penpot/.fig/.sketch` → PNG/SVG/PDF | `figcraft_convert` | `convert IN OUT`; `export --out` for frames |
| VectorCraft `.vcraft/.svg/.ai/.pdf/.eps` → SVG/PDF/PNG/EPS | `vectorcraft_convert` | `convert IN OUT`, or `run --export OUT` |
| DesignCraft `.dcraft` → PDF/HTML/EPUB/IDML | `designcraft_run` (no `convert`/`inspect` tool) | `file.exportPdf {path}`, `file.exportHtml`, `file.exportEpub` |
| PhotoCraft raster → PNG/JPEG/WebP/TIFF/PSD | `photocraft_run` | `file.export…` family (`file.exportAs`, presets) |
| LightCraft `.lcraft/.raw` → JPEG/TIFF | `lightcraft_run` | `app.export` after selecting in the library |
| FilmCraft `.fcraft` → MP4/MOV + EDL/AAF/FCPXML | `filmcraft_run` | `file.exportMedia {path, preset}`, `file.exportInterchange` |
| SoundCraft `.scraft` → WAV/AIFF | `soundcraft_run` | bounce/export commands (`export.bounce`) |
| PdfCraft: anything → one PDF, promote, reduce | `pdfcraft_mcp_call` | `doc_combine {paths, out}`, `doc_reduce`, `page_render` |

Verified examples: `cadcraft-cli convert plan.dxf plan.pdf` produced a valid 1 KB vector PDF and a
29 KB PNG; `wordcraft-cli convert report.docx out.pdf` wrote an 11.5 KB PDF; `figcraft-cli export
design.figcraft --out hero.png` wrote a PNG.

## The procedure

1. **Identify the true source format**, not the file extension the user named. A `.pdf` that was a
   deck is still a deck; convert from the deck if it exists, and say so.
2. **Pick the owning craft** from the table. If the source is unknown, `inspect` with the matching
   craft first — it reports structure and catches a mis-named file.
3. **Convert, then verify.** Render a page and `read_image` it. Conversions fail quietly: a blank
   page, missing fonts, a cropped table.
4. **Post-process only in PdfCraft.** Combining, reducing and stamping are PDF operations; doing
   them in the source app is re-authoring.

## When NOT to use this skill

- The source is already the target (nobody needs a `.pdf` → `.pdf`).
- The user needs to **edit** after conversion: convert to the editable native format (`.docx`,
  `.figcraft`, `.deckcraft`) rather than to PDF.
- The source has forms, signatures or embedded fonts the target cannot carry: state what is lost
  instead of delivering a silently degraded file.

## Pitfalls

- **Extension decides the format.** `convert in out.xyz` errors rather than guessing; pick a
  supported extension.
- **PDF is a sink, not a hub.** Converting PDF → DOCX → PDF loses layout twice. If the source is a
  docx, edit the docx.
- **Fonts.** A PDF made where the font is missing substitutes it; check the rendered page, not the
  file size.
- **`--update-fields`** (WordCraft) is what refreshes TOC/field values; without it a converted
  document keeps the field codes' cached text.

## Boundaries

Each craft must be installed. For a machine without them, a generic library converter is the
fallback — with the losses named above.
