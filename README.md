<div align="center">

# ArtCraft × DSH

**Fourteen crafting applications. One agent. Zero source changes.**

Every app from the [ArtCraft](https://github.com/storytold) org — CAD, spreadsheets, audio, video,
photo, vector, PDF, slides, documents — exposed to [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
as a first-class plugin.

[![DSH plugin](https://img.shields.io/badge/DSH-plugin-4D6BFE?style=flat-square)](https://github.com/deepseek-ai/deepseek-harness)
[![built on Cordis](https://img.shields.io/badge/built%20on-Cordis-6E56CF?style=flat-square)](https://github.com/cordiverse/cordis)
[![License](https://img.shields.io/badge/license-MIT%20OR%20Apache--2.0-blue?style=flat-square)](#license)
[![Plugins](https://img.shields.io/badge/plugins-14-success?style=flat-square)](#the-fourteen)
[![Tools](https://img.shields.io/badge/tools-108-informational?style=flat-square)](#two-surfaces-per-craft)
[![MCP](https://img.shields.io/badge/MCP-bridged-8A2BE2?style=flat-square)](#two-surfaces-per-craft)
[![Verified](https://img.shields.io/badge/verified-12%2F12-brightgreen?style=flat-square)](#verify-it-yourself)
[![npm](https://img.shields.io/npm/v/dsh-artcraft-plugin-gridcraft?style=flat-square&label=npm&color=cb3837)](https://www.npmjs.com/package/dsh-artcraft-plugin-gridcraft)

English · [中文](README.zh.md)

</div>

---

```console
$ dsh --profile web
you › make me a Q3 sales spreadsheet with a chart, save it to ~/Documents

  ⏺ gridcraft_commands  {"search": "chart"}          315 commands, 8 families
  ⏺ gridcraft_describe  {"id": "insert.chart"}       {range?, type?, title?, at?}
  ⏺ gridcraft_run       sample "sales", 2 commands   exited 0 in 41ms
  ⏺ gridcraft_inspect   ~/Documents/q3.xlsx          1 sheet, 1 chart, A1:H24

✔ GridCraft wrote ~/Documents/q3.xlsx (14,208 bytes)
```

## What this is

The ArtCraft suite is fourteen native Rust applications. Each one already ships a headless CLI and
its own MCP server — but nothing tells an agent they exist, what they can do, or how to call them.

This repository closes that gap. Each app becomes a **DSH plugin** that registers model-callable
tools on `ctx.tools`, discovers the app's binary on your machine, and drives it as an external
process.

**No craft source is ever modified.** Every plugin lives here. The applications are dependencies,
not forks.

## The fourteen

| | Craft | What it does | Commands | MCP tools |
|:--|:--|:--|--:|--:|
| 📐 | **CADCraft** | CAD and drafting (AutoCAD-style) | 449 | 12 |
| 📊 | **GridCraft** | Spreadsheets (Excel-style) | 364 | 22 |
| 🎚️ | **SoundCraft** | Digital audio workstation | 479 | 17 |
| 🖼️ | **PhotoCraft** | Raster image editing (Photoshop-style) | 953 | 26 |
| 🌄 | **LightCraft** | Photo library and raw development | 375 | 397 |
| 📄 | **PdfCraft** | PDF reading and editing | 183 | 183 |
| 🖋️ | **VectorCraft** | Vector art (Illustrator-style) | 906 | 33 |
| 🎬 | **EffectCraft** | Motion graphics (After Effects-style) | 743 | 27 |
| 🎞️ | **FilmCraft** | Non-linear video editing | 716 | 17 |
| 🎨 | **DesignCraft** | Page and layout design (InDesign-style) | 545 | 26 |
| 📽️ | **DeckCraft** | Presentations (PowerPoint-style) | 331 | 25 |
| 📝 | **WordCraft** | Word processing (Word-style) | 648 | 17 |
| ✒️ | **FigCraft** | Interface design and prototyping (Figma-style) | 629 | 19 |
| 🧶 | **TextureCraft** | 3D texture painting | 135 | 22 |

<sub>Command counts are read live from each binary; MCP counts are what each server declares.</sub>

## Two surfaces per craft

Every plugin exposes **both**, because they answer different questions:

<table>
<tr><th width="50%">Generic commands</th><th width="50%">The craft's own MCP server</th></tr>
<tr valign="top"><td>

Reaches the **entire application** — every menu item is a command id.

```
gridcraft_commands  {"search": "chart"}
gridcraft_describe  {"id": "insert.chart"}
gridcraft_run       {"commands": [...], "save": "..."}
gridcraft_inspect   {"file": "..."}
gridcraft_convert   {"input": "...", "output": "..."}
```

</td><td>

**Modelled operations** with real JSON Schemas, served over JSON-RPC by the app itself.

```
gridcraft_mcp_tools  {"search": "range"}
gridcraft_mcp_call   {"tool": "write_range",
                      "arguments": {"range": "A1",
                                    "values": [["x"]]}}
gridcraft_mcp_status {}
```

</td></tr>
</table>

The MCP server is spawned once per plugin and kept warm — starting GridCraft's engine costs ~600 ms —
then shut down after five idle minutes or when the plugin unloads.

### What else the bridge gives you

- **Look at the result.** A render, screenshot or page image comes back as a file and a path;
  the agent opens it with `read_image`, so a visual task is checked instead of assumed.
- **Work in the open window.** Twelve of the fourteen publish a control channel, so pass
  `attach: <port>` to an MCP call and the agent edits the document the user already has open,
  with every change visible in the app. LightCraft and PdfCraft are headless only.
- **Use the app's own recipes.** `<craft>_mcp_tools` also lists the MCP **resources** (the open
  document, the command catalogue, comments) and **prompts** — FigCraft ships six curated
  workflows such as `design_system` and `prototype_flow`.
- **Long jobs run in the background.** A 4K render, a texture bake or an audio bounce outlasts a
  tool timeout; pass `background: true` to `_run` and the process keeps going while the call
  returns a job id, a log path and a `_job` tool to poll, wait on or kill.
- **A skill, not just tools.** `skills/artcraft/SKILL.md` is installed to `$DSH_HOME/skills` and
  carries the workflow, per-craft quirks and pitfalls. Tools provide the capability; the skill
  provides the competence, and costs context only when loaded.

## Quick start

**Windows** — from a fresh clone, in PowerShell:

```powershell
git clone https://github.com/lznnnnn1998/dsh-artcraft
cd dsh-artcraft
.\install.ps1                      # or: install.cmd   (if .ps1 files are blocked)
```

That finds the Node the harness already ships (no `node`, `npm` or `pnpm` on `PATH`
needed), downloads every craft CLI for your platform, and installs the fourteen plugins
into your DSH profile. Add `-Crafts gridcraft` for one craft, `-List` for a dry run, or
`-Verify` to prove it works:

```powershell
.\install.ps1 -Crafts gridcraft,wordcraft -Profile desktop -Verify
```

**macOS and Linux** — the same two steps by hand:

```sh
git clone https://github.com/lznnnnn1998/dsh-artcraft
cd dsh-artcraft

# 1. the craft CLIs — macOS, Windows and Linux, no Rust toolchain needed
node scripts/install-craft.mjs
#    …or compile them from source instead (needs Rust, ~1 min per craft):
# node scripts/install-craft.mjs --from-source

# 2. install the plugins into a DSH profile, then restart it
node scripts/install-into-profile.mjs --profile web
```

Both platforms run the same Node scripts; `install.ps1` only adds Node discovery and
PowerShell-friendly defaults. Nothing is installed machine-wide and no shell profile is
modified.

Or install a single craft from npm, straight into a profile:

```sh
dsh plugin --profile web add dsh-artcraft-plugin-gridcraft
```

Each craft is its own package: `dsh-artcraft-plugin-<craft>` for `cadcraft`, `gridcraft`,
`soundcraft`, `deckcraft`, `wordcraft`, `photocraft`, `lightcraft`, `pdfcraft`, `vectorcraft`,
`effectcraft`, `filmcraft` and `designcraft`.

Then just ask:

> *"Open the CADCraft sample floor plan and export a PNG of the kitchen."*
> *"Take the demo song in SoundCraft, drop the kick 6 dB and bounce it."*
> *"Render page 3 of this PDF at 300 dpi."*

Full instructions, configuration and troubleshooting: **[docs/INSTALL.md](docs/INSTALL.md)**

<details>
<summary><b>Requirements</b></summary>

- **Node.js** `^22.19.0 || >=24.0.0` — on Windows the harness's own bundled Node is
  found automatically, so you do not need it on `PATH`
- A running [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) profile
- **macOS, Windows 11 or Ubuntu 24.04** — the installer picks the right build, and
  nothing else is required (no Rust, no `unzip`, no `tar`, no `npm`, no `pnpm`)

Nothing else. The craft apps are **not** built from source; step 1 downloads signed release
binaries.

</details>

## Verify it yourself

```sh
node scripts/verify.mjs
```

Every craft must locate its binary, load its live catalog, expose the right tool set, complete an
MCP handshake, and produce a non-empty artifact from a real headless run:

```
cadcraft       v0.16.0   449 commands   12 MCP tools   ok
gridcraft      v0.15.0   364 commands   22 MCP tools   ok
soundcraft     v0.16.0   479 commands   17 MCP tools   ok
photocraft     v0.19.0   953 commands   26 MCP tools   ok
lightcraft     v0.17.0   375 commands  397 MCP tools   ok
pdfcraft       v0.17.0   183 commands  183 MCP tools   ok
vectorcraft    v0.20.0   906 commands   33 MCP tools   ok
effectcraft    v0.20.0   743 commands   27 MCP tools   ok
filmcraft      v0.16.0   716 commands   17 MCP tools   ok
designcraft    v0.16.0   545 commands   26 MCP tools   ok
deckcraft      v0.14.1   331 commands   25 MCP tools   ok
wordcraft      v0.14.0   648 commands   17 MCP tools   ok
figcraft       v0.14.0   629 commands   19 MCP tools   ok
texturecraft   v0.2.0    135 commands   22 MCP tools   ok

all 14 plugin(s) verified
```

## How it works

Each craft is described **once**, in
[`dsh-plugins/craft-kit/src/profiles.mjs`](dsh-plugins/craft-kit/src/profiles.mjs). The kernel turns
that description into tools and hides every difference between the apps:

| Craft | How a headless run is spelled |
|:--|:--|
| GridCraft, CADCraft, DeckCraft, WordCraft, SoundCraft, DesignCraft | `--cmd 'id={...}'` |
| PhotoCraft, VectorCraft | `--cmd id --params '{...}'` |
| LightCraft, PdfCraft | positional `id key=value` |
| EffectCraft | positional `id {...}` |
| FilmCraft | a generated JSONL script file |

```
dsh-plugins/
├── craft-kit/              shared kernel
│   ├── src/                discovery · exec · catalogs · tool factory · MCP client
│   ├── lib/                generated plain ESM
│   └── catalog/            command snapshots + discovered binary paths
├── plugin-cadcraft/        one DSH plugin per craft
├── plugin-gridcraft/       …
└── plugin-wordcraft/
```

Every fact about the binaries was **measured by running them**, never assumed. Where a craft's real
CLI contradicted an expectation, the raw output is recorded in [docs/craft-notes/](docs/craft-notes).

## Beyond the fourteen

All **23** repositories matching `craft` under `github.com/storytold` were cloned and assessed
([docs/CRAFT-MATRIX.md](docs/CRAFT-MATRIX.md)). Fourteen are applications with a published headless
CLI and became plugins. The other eleven are libraries, asset bundles, or GUIs without a scriptable
entry point — including `artcraft`, the umbrella app, whose MCP support is a documented UI stub.

## Documentation

| | |
|:--|:--|
| **[docs/INSTALL.md](docs/INSTALL.md)** | install, configure, use, troubleshoot |
| **[docs/CRAFT-MATRIX.md](docs/CRAFT-MATRIX.md)** | the 23 repositories and their verified CLI surfaces |
| **[docs/craft-notes/](docs/craft-notes)** | per-craft evidence, quirks, limitations |

## Contributing

Found a craft whose CLI behaves differently than described? The notes are meant to be corrected —
open an issue with the raw output, or run the offending command with tracing on:

```sh
# macOS / Linux
DSH_ARTCRAFT_TRACE=/tmp/trace.log node scripts/verify.mjs <craft>
```

```powershell
# Windows (PowerShell)
$env:DSH_ARTCRAFT_TRACE = "$env:TEMP\artcraft-trace.log"; node scripts\verify.mjs <craft>
```

That writes the exact argv of every invocation to the trace file.

## License

Dual-licensed under [MIT](LICENSE-MIT) or [Apache-2.0](LICENSE-APACHE), at your option — the same
terms the craft applications use.

The craft binaries are downloaded from their own GitHub releases and remain under their own
licences; none of their source is vendored here.

<div align="center">
<sub>Built with <a href="https://github.com/deepseek-ai/deepseek-harness">DeepSeek Harness</a> · powered by <a href="https://github.com/cordiverse/cordis">Cordis</a> · for the <a href="https://github.com/storytold">ArtCraft</a> community</sub>
</div>
