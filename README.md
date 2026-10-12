# dsh-artcraft

Every crafting app from the [ArtCraft](https://github.com/storytold) org — GridCraft, CADCraft,
SoundCraft, PhotoCraft, DeckCraft, WordCraft and six more — as **DSH plugins**. The agent gets
tools like `gridcraft_run`, `cadcraft_inspect` and `soundcraft_mcp_call`, and every one drives the
app's own published CLI headlessly.

**The craft applications are never modified.** The plugins live here and treat each craft's binary
as an external program.

## The twelve

| Craft | What it does | Command ids | MCP tools |
|---|---|---|---|
| **CADCraft** | CAD / drafting (AutoCAD-style) | 305 | 11 |
| **DeckCraft** | Presentations (PowerPoint-style) | 226 | 25 |
| **DesignCraft** | Page layout (InDesign-style) | 446 | 25 |
| **EffectCraft** | Motion graphics (After Effects-style) | 669 | 27 |
| **FilmCraft** | Video editing | 693 | 17 |
| **GridCraft** | Spreadsheets (Excel-style) | 315 | 21 |
| **LightCraft** | Photo library / raw development | 296 | 318 |
| **PdfCraft** | PDF reading and editing | 161 | 161 |
| **PhotoCraft** | Raster image editing (Photoshop-style) | 858 | 21 |
| **SoundCraft** | Digital audio workstation | 465 | 17 |
| **VectorCraft** | Vector art (Illustrator-style) | 743 | 32 |
| **WordCraft** | Word processing | 460 | 16 |

## Two surfaces per craft

Each plugin exposes both, because they answer different questions:

- **Generic commands** — `<craft>_run` applies any of the craft's own command ids; `<craft>_commands`
  and `<craft>_describe` find them. This reaches the entire application.
- **The craft's MCP server** — `<craft>_mcp_tools` lists modelled operations with real JSON
  Schemas; `<craft>_mcp_call` invokes one.

```
gridcraft_commands  {"search": "chart"}          → command ids and their parameter grammar
gridcraft_describe  {"id": "insert.chart"}       → one command's full parameters
gridcraft_run       {"commands": [{"id": "cell.set", "json": {"cell": "A1", "input": "x"}}],
                     "sample": "budget", "save": "/tmp/out.xlsx"}
gridcraft_inspect   {"file": "/tmp/out.xlsx"}    → read back what was produced
gridcraft_mcp_call  {"tool": "write_range", "arguments": {"range": "A1", "values": [["x"]]}}
```

## Install

```sh
git clone https://github.com/lznnnnn1998/dsh-artcraft && cd dsh-artcraft

# 1. the craft CLIs (official releases; no Rust toolchain needed)
node scripts/fetch-binaries.mjs

# 2. link the plugins against your deepseek-harness checkout
node scripts/install-links.mjs

# 3. load them into a DSH profile, then restart it
node scripts/link-into-profile.mjs --profile web
```

Full instructions, configuration and troubleshooting: **[docs/INSTALL.md](docs/INSTALL.md)**.

## Verify

```sh
node scripts/verify.mjs
```

Every craft must find its binary, load its live catalog, expose the right tool set, complete an MCP
handshake, and produce a non-empty artifact from a real headless run. Current result:

```
cadcraft     cadcraft-cli 0.5.0      305 (live)   8   11 tools    ok → out.dxf (34140 B)
gridcraft    gridcraft-cli 0.5.0     315 (live)   8   21 tools    ok → out.xlsx (7682 B)
soundcraft   SoundCraft CLI 0.6.1    465 (live)   8   17 tools    ok → out.wav (16094696 B)
…                                                                  all 12 plugin(s) verified
```

## Layout

```
dsh-plugins/
  craft-kit/            shared kernel: discovery, exec, catalogs, tool factory, MCP client
    src/                TypeScript source of truth
    lib/                generated plain ESM (scripts/build-kit.mjs)
    catalog/            per-craft command snapshots + discovered binary paths
  plugin-<craft>/       one DSH plugin per craft
scripts/
  fetch-binaries.mjs    download the craft CLIs from GitHub releases
  install-links.mjs     link plugins against a harness checkout
  build-kit.mjs         compile craft-kit/src → craft-kit/lib
  gen-catalogs.mjs      snapshot each craft's command catalog
  link-into-profile.mjs install/uninstall plugins in a dsh profile
  verify.mjs            end-to-end verification
docs/
  INSTALL.md            install, configure, use, troubleshoot
  CRAFT-MATRIX.md       the 23 ArtCraft repositories and their verified CLI surfaces
  craft-notes/          per-craft evidence and limitations
```

## How it works

A craft is described once in [`dsh-plugins/craft-kit/src/profiles.mjs`](dsh-plugins/craft-kit/src/profiles.mjs):
its binary, how it spells a headless run, how commands are passed, and where its catalog comes from.
The kernel turns that description into tools, hiding the differences between crafts — GridCraft takes
`--cmd id={...}`, PhotoCraft takes `--cmd id --params {...}`, LightCraft takes positional
`id key=value`, FilmCraft takes a JSONL script file, and EffectCraft has no output flag at all.

Everything about the craft binaries was measured by running them, not read from documentation. Where
a craft's real CLI contradicted an assumption, the notes record the raw output.

## Scope

All 23 repositories matching `craft` under `github.com/storytold` were cloned and assessed
([docs/CRAFT-MATRIX.md](docs/CRAFT-MATRIX.md)). Twelve are applications with a published headless
CLI and became plugins. The other eleven are libraries, asset bundles, or GUIs without a scriptable
entry point — including `artcraft`, the umbrella app, whose MCP support is a documented UI stub.

## License

MIT OR Apache-2.0, matching the craft applications. The craft binaries are downloaded from their own
releases and keep their own licences; none of their source is vendored here.
