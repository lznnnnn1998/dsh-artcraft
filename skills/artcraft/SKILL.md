---
name: artcraft
description: Use when creating, editing, inspecting or rendering a document with any ArtCraft application — spreadsheets (GridCraft), documents (WordCraft), slides (DeckCraft), PDFs (PdfCraft), CAD drawings (CADCraft), vector art (VectorCraft), raster images (PhotoCraft), photo raw (LightCraft), video (FilmCraft), motion graphics (EffectCraft), page layout (DesignCraft), interface design (FigCraft) or 3D texture painting (TextureCraft) — including working in the copy the user already has open.
---

# Driving the ArtCraft applications

Fourteen desktop applications share one architecture: a Rust engine, a command registry
where every menu item is one command, a headless CLI, and an MCP server. The installed
plugins for `<craft>` expose both surfaces to you, and they never touch application source.

Pick the craft first, then work through its tools. Do not attempt to produce the file with a
generic library (openpyxl, python-docx, ffmpeg, …) when the matching craft plugin is
available: the craft owns formats, layout, fonts and rendering, and its output is what the
user opens in the app.

## The two surfaces

| Surface | Tools | Use it for |
|---|---|---|
| Command registry | `<craft>_commands`, `<craft>_describe`, `<craft>_run` | Anything: it reaches every action. The registry is authoritative and grows with each release. |
| Modelled MCP | `<craft>_mcp_tools`, `<craft>_mcp_call` | When you want a typed operation with a JSON Schema, a screenshot, a curated prompt, or a workflow the app modelled. Also the only way to drive the user's open window. |

`<craft>_inspect` reads a document back. `<craft>_commands` lists ids; `describe` prints the
exact parameter grammar. Sizes: 135 commands for TextureCraft up to 953 for PhotoCraft, so
search rather than reading a whole catalogue.

## The loop

1. **Look before you edit.** For an existing file call `<craft>_inspect` first; it reports the
   shape of the document (sheets, slides, layers, pages, clips, comps, texture sets).
2. **Find the operation.** `<craft>_commands` with `search`, then `<craft>_describe` for the
   parameter grammar. Prefer the app's own vocabulary (`layer.add.paint`, `slide.insert`,
   `frame.create`) over guessing.
3. **Apply.** `<craft>_run` takes an ordered list: `{ "id": "<command id>", "json": { … } }`.
   Every command runs in one process, so ordering is preserved.
4. **Save.** Pass `save` with the right extension for that craft. Without it the change is
   discarded when the process exits.
5. **Verify.** Re-run `inspect`. For anything visual, render or screenshot and look at the
   result with `read_image` — the tool saves the image and returns its path.

A run reports one JSON line per step, so a failing step names its command. Fix that step and
re-run the list; runs are not resumable.

## Crafts, documents and the one argument that differs

| Craft | Documents | Notes |
|---|---|---|
| GridCraft | `.xlsx .csv .tsv .json .html` | Sheets, formulas, charts, pivot tables, conditional formatting. |
| WordCraft | `.docx .odt .rtf .md .txt` | Styles, tables, headers, footnotes, tracked changes, comments, mail merge. |
| DeckCraft | `.deckcraft .pptx` | Layouts, themes, shapes, pictures, tables, charts, transitions, notes. |
| PdfCraft | `.pdf` | Page operations, text extraction, rendering, combining, redaction audit. |
| CADCraft | `.dxf .dwg` | Lines, arcs, splines, layers, dimensions, hatches, blocks. |
| VectorCraft | `.vcraft .svg .ai .pdf .eps` | Paths, artboards, text, effects, packaging, format export. |
| PhotoCraft | `.pcraft .psd .png .jpg .tif .webp .exr` | Layers, selections, adjustments, filters, droplets, batch actions. |
| LightCraft | `.lcraft .jpg .raw .dng .cr2 .nef` | Non-destructive catalog and raw develop; export. |
| FilmCraft | `.fcraft .mp4 .mov` | Sequences, media import, editing, export presets. |
| EffectCraft | `.ecproject .ectemplate` | Comps, layers, properties, expressions, render queue. |
| DesignCraft | `.dcraft .pdf` | Master pages, frames, text flow, PDF export. |
| FigCraft | `.figcraft .penpot .fig .sketch .svg` | Frames, components, auto layout, variables, prototyping, code export. |
| TextureCraft | `.tcraft` | Texture sets, layers over a mesh, baking, PBR export. Needs a project first; a bare run creates one. |
| SoundCraft | `.scraft .wav .aiff` | Multitrack editing, mixing, plugins, automation, MIDI, bounce. |

Everything else is uniform: the plugin already normalises the crafts that take a generated
script file (FigCraft, TextureCraft) versus inline command flags, and the ones whose save is a
flag versus a script field. Pass `commands` and `save`; the plugin builds the invocation.

## Working in the user's open window

Twelve of the fourteen expose a control channel. When the user says "my open file", "the
window", or asks you to show changes live, pass `attach` (the control-channel port) to
`<craft>_mcp_tools` / `<craft>_mcp_call`. The app must be running with its control port, for
example `figcraft --control 7979`, then `attach: 7979`.

- Attached work is visible in the app and writes to the user's document, so prefer headless
  for drafts and attach only when the user asks.
- LightCraft and PdfCraft have no attach mode; PdfCraft drives a running app through
  `pdfcraft-cli ui --control <file> <method>` instead.
- A refused attach reports the app's own reason ("no control token", "connection refused");
  the fix is to start the app with its control channel, not to retry.

## Seeing the result

Renders, screenshots, page images and thumbnails come back as files:

```
[image] <temp>/dsh-artcraft/figcraft/figcraft-screenshot-….png
Use read_image on that path to look at it.
```

Always look before declaring a visual task done — a slide, a page, a drawing, a chart or a
texture that "ran without error" can still be blank, overlapping or off the canvas. Check the
dimensions and the content, and iterate on the commands.

## Curated workflows

FigCraft's MCP server ships prompts for common jobs (`mobile_screen`, `design_system`,
`landing_page`, `prototype_flow`, `fix_comments`, `watch_comments`) and resources for the open
document, the command catalogue and comments. `<craft>_mcp_tools` lists them; read the named
prompt to follow the app's own recipe before improvising one.

## Pitfalls

- **Parameter grammar is not JSON Schema.** `describe` prints shorthand like
  `{x?, y?, width?, props?}`; optional keys are marked `?`, alternatives use `|`, and
  `props` is a nested object. Read it before writing arguments.
- **Save is explicit.** A run without `save` changes nothing on disk.
- **One document per run.** `input` opens an existing file; `save` writes the result. To edit
  a file in place, pass the same path to both.
- **Long jobs.** Big renders, bakes and bounces can outlast the default timeout; raise it and
  render at a low resolution first to check the composition.
- **Binary output is not text.** `inspect` summarises; use the craft's own export/render
  command for a file the user can open.
- **Do not shell out to the CLI yourself.** The plugin locates the right binary, version and
  platform name; calling `<craft>-cli` directly bypasses that.
