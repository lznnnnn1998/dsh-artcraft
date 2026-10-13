# The ArtCraft repositories under DSH

All 23 repositories matching `craft` in [github.com/storytold](https://github.com/storytold) were
cloned into [`repos/`](../repos). This document records what each one is, how it was verified,
and whether it became a DSH plugin.

Every claim below is either (a) produced by running the repository's own published binary, or
(b) read from a cited file in the clone. Per-craft detail lives in [`craft-notes/`](craft-notes).

## Summary

| Repository | Kind | DSH plugin | Verified |
|---|---|---|---|
| `cadcraft` | App (CAD) | ✅ 5 tools | binary 0.5.0, 305 commands, run writes DXF 34140 B |
| `deckcraft` | App (slides) | ✅ 5 tools | binary 0.5.0, 226 commands, run writes .deckcraft 7471 B |
| `designcraft` | App (layout) | ✅ 3 tools | binary 0.6.0, 446 commands, run exports PDF 2028 B |
| `effectcraft` | App (motion graphics) | ✅ 5 tools | binary 0.8.0, 669 commands, run writes .ecproj 732438 B |
| `filmcraft` | App (video) | ✅ 5 tools | binary 0.6.0, 693 commands, script run writes .fcproj 3264 B |
| `gridcraft` | App (spreadsheets) | ✅ 5 tools | binary 0.5.0, 315 commands, run writes XLSX 7682 B |
| `lightcraft` | App (photo/raw) | ✅ 4 tools | binary 0.6.0, 296 commands, run exports JPEG 108535 B |
| `pdfcraft` | App (PDF) | ✅ 5 tools | binary 0.7.1, 161 tools, script run writes PDF 802 B |
| `photocraft` | App (raster) | ✅ 5 tools | binary 0.7.0, 858 commands, run writes PNG 168 B |
| `soundcraft` | App (audio) | ✅ 5 tools | binary 0.6.1, 465 commands, run bounces WAV 16094696 B |
| `vectorcraft` | App (vector) | ✅ 4 tools | binary 0.10.0, 743 commands, run exports SVG 251 B |
| `wordcraft` | App (word processing) | ✅ 5 tools | binary 0.5.0, 460 commands, run writes DOCX 6286 B |
| `artcraft` | Umbrella app (native + web) | ❌ no CLI surface | see [artcraft.md](craft-notes/artcraft.md) |
| `artcraftx` | Umbrella app (early) | ❌ no releases | zero GitHub releases |
| `artcraft-services` | Backend/web services | ❌ not a craft app | Rust services + web frontend |
| `craft-launcher` | GUI installer/updater | ❌ no CLI asset | 12 apps, GUI only |
| `craft-repo-status-app` | Tray dashboard | ❌ no published build | internal `craft-fetch` debug CLI only |
| `craft-libs` | Shared Rust libraries | ❌ library | no binary |
| `craft-fonts` | Font assets | ❌ assets | no binary |
| `craft-common-actions` | CI configuration | ❌ assets | no binary |
| `craft-launcher-assets` | Launcher images | ❌ assets | no binary |
| `photocraft-corpus` | Test data | ❌ data | no binary |
| `placeholder-artcraft` | Web placeholder | ❌ site | TypeScript site |

## Why exactly these twelve became plugins

The twelve apps share one property that makes a DSH plugin both possible and useful: each ships a
published `*-cli` release asset with a headless `run` verb, a machine-readable command catalog,
and an MCP server. The other eleven are libraries, asset bundles, or GUIs without a scriptable
headless entry point — wrapping them would mean inventing a CLI that upstream does not have,
which is exactly the kind of change this task set out to avoid.

`artcraft` deserves a specific note because it is the umbrella application: it has a native egui
app, a Tauri shell, and a web frontend, but **no** `apps/*-cli` crate and no `clap` dependency
anywhere; its releases contain only desktop installers. Its MCP support exists as hosted-service
session-credential endpoints and a UI marked "MCP not ready", not as a tool server the agent could
call. [craft-notes/artcraft.md](craft-notes/artcraft.md) records the evidence.

## Verified CLI shapes

The kernel encodes one orthogonal choice per craft rather than assuming a shared shape. These are
the differences that were discovered by running the binaries, not by reading documentation:

| Craft | Input | Commands | Write-back |
|---|---|---|---|
| cadcraft | positional: `run FILE` | `--cmd 'id={json}'` | `--save`, `--export` |
| gridcraft | `--in FILE` / `--sample NAME` | `--cmd 'id={json}'` | `--out` |
| soundcraft | `--in FILE` / `--demo` | `--cmd 'id={json}'` | `--save`, `--bounce` |
| deckcraft | `--in FILE` / `--sample` | `--cmd 'id={json}'` | `--save`, `--export` |
| wordcraft | `--file FILE` | `--cmd 'id={json}'` | `--save` |
| photocraft | `--new JSON` (no file input) | `--cmd ID --params JSON` | `--out` |
| vectorcraft | `--in FILE` (no sample flag) | `--cmd ID --params JSON` | `--export` |
| lightcraft | `--demo` / `--import PATH` | positional `id key=value` | exports via commands |
| pdfcraft | none (documents open via tools) | positional `id key=value`, one tool per run | `doc_save` tool, or `--script FILE` |
| effectcraft | none | positional `id {json}` | `file.saveAs` command |
| filmcraft | none | JSONL script file | global `--save-as FILE` |
| designcraft | `--in FILE` / `--sample` | `--cmd 'id={json}'` | `--export` (no `--save`) |

### Every craft also has an MCP server

Each app ships `*-cli mcp`, a JSON-RPC server with modelled tools that carry real JSON Schemas.
The plugins bridge to it, so every craft exposes three more tools: `<craft>_mcp_tools` (discover
them), `<craft>_mcp_call` (invoke one) and `<craft>_mcp_status` (diagnostics). Verified tool
counts: cadcraft 11, wordcraft 16, filmcraft 17, soundcraft 17, gridcraft 21, photocraft 21,
deckcraft 25, designcraft 25, effectcraft 27, vectorcraft 32, pdfcraft 161, lightcraft 318.

The server is spawned once per plugin and kept warm — starting GridCraft's engine costs ~600 ms —
then shut down after five idle minutes or when the plugin unloads. Set `enableMcp: false` to skip
the bridge, or `mcpIdleMs` to change the timeout.

Catalog formats differ too: JSON arrays (`commands`, sometimes behind `--json`, sometimes
default), a `tools` list with JSON Schema parameters (pdfcraft), and fixed-width tables with
wrapped continuation lines (soundcraft, lightcraft, effectcraft).

## Limitations worth knowing

These are real behaviours of the craft CLIs, not plugin bugs. Each one is recorded with raw
evidence in the matching [craft-notes](craft-notes) file.

- **A craft run is a fresh process.** Nothing survives between calls on its own. PdfCraft is the
  one craft whose document cannot be reopened by path mid-workflow, so the kernel replays the
  session's earlier commands to rebuild it; pass `resetSession: true` to start over.
- **SoundCraft's `commands` table has no parameters column.** `soundcraft_describe` therefore
  falls back to `soundcraft-cli describe <id>` and reports the real grammar with its source noted.
- **VectorCraft's `export` parameter maps to the same `--export` flag as `save`**, so the tool
  advertises only `save`; passing `export` still works and is folded in.
- **LightCraft's demo library selects no photo**, so `develop.*` commands fail until a photo is
  selected through the library tools. `app.export` from the demo works and is what the verifier runs.
- **FilmCraft cannot open an existing project** (`--project` is read-only for `inspect`), so
  `filmcraft_run` starts a new project and writes it with `--save-as`.
- **PhotoCraft's `--new` and VectorCraft's blank start** mean "no source flag" for those crafts;
  asking for `sample: true` on a craft without one is reported as an error rather than ignored.

## Reproducing every claim

```sh
node scripts/install-craft.mjs            # install the 12 CLIs for this platform
node scripts/gen-catalogs.mjs             # re-snapshot each catalog
node scripts/verify.mjs                   # discovery + catalog + tools + a real headless run
DSH_ARTCRAFT_TRACE=/tmp/trace.log node scripts/verify.mjs   # also log every exact argv
```

All three exited 0 with the results in the table above.
