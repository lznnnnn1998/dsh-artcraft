# ArtCraft × DSH — install and use

Every `*craft` app from [github.com/storytold](https://github.com/storytold) is now a **DSH
plugin**: the agent gets `gridcraft_run`, `cadcraft_inspect`, `soundcraft_commands` and friends,
and each one drives the craft's own `*-cli` binary headlessly.

The craft repositories under `repos/` are **never modified** — every plugin lives in
[`dsh-plugins/`](../dsh-plugins) and treats the craft binary as an external program.

## What you get

Every craft exposes two complementary surfaces:

- **Generic commands** — `<craft>_run` applies any of the craft's own command ids
  (`cell.set`, `slide.new`, `mix.volume`), with `<craft>_commands` and `<craft>_describe` to find
  them. This reaches the whole application.
- **Its MCP server** — `<craft>_mcp_tools` lists the craft's modelled tools with real JSON
  Schemas, and `<craft>_mcp_call` invokes one. GridCraft's server, for example, offers 21 tools
  including `execute_command`, `read_range`, `write_range` and `insert_chart`.

| Craft | Tools registered | Commands | MCP tools |
|---|---|---|
| CADCraft | `run` `commands` `describe` `inspect` `convert` | 305 | 11 |
| DeckCraft | `run` `commands` `describe` `inspect` `convert` | 226 | 25 |
| DesignCraft | `run` `commands` `describe` | 446 | 25 |
| EffectCraft | `run` `commands` `describe` `inspect` `convert` | 669 | 27 |
| FilmCraft | `run` `commands` `describe` `inspect` `convert` | 693 | 17 |
| GridCraft | `run` `commands` `describe` `inspect` `convert` | 315 | 21 |
| LightCraft | `run` `commands` `describe` `inspect` | 296 | 318 |
| PdfCraft | `run` `commands` `describe` `inspect` `convert` | 161 | 161 |
| PhotoCraft | `run` `commands` `describe` `inspect` `convert` | 858 | 21 |
| SoundCraft | `run` `commands` `describe` `inspect` `convert` | 465 | 17 |
| VectorCraft | `run` `commands` `describe` `convert` | 743 | 32 |
| WordCraft | `run` `commands` `describe` `inspect` `convert` | 460 | 16 |

Tool names are prefixed with the craft: `gridcraft_run`, `gridcraft_commands`, …

## Install

### 1. Get the craft CLIs (macOS, Windows 11, Ubuntu 24.04)

```sh
node scripts/install-craft.mjs              # every craft this platform supports
node scripts/install-craft.mjs gridcraft    # or just one
node scripts/install-craft.mjs --list       # what would be fetched
node scripts/install-craft.mjs --force      # reinstall over an existing copy
```

CLIs land in `$DSH_HOME/crafts/bin` (`~/.dsh/crafts/bin` by default) and the
plugins find them there with no configuration. Nothing here needs a Rust
toolchain, `unzip`, `tar` or `7z`: archives are unpacked by Node itself.

| Platform | Archive used | CLI inside |
|:--|:--|:--|
| macOS (Intel + Apple silicon) | `<craft>-cli-<v>-macos-universal.zip` | `<craft>-cli` |
| Windows x64 / arm64 | `<craft>-<v>-windows-<arch>-portable.zip` | `<craft>-cli.exe` |
| Linux x64 / arm64 | `<craft>-<v>-linux-<arch>.tar.gz` | `bin/<craft>-cli` |

On Windows and Linux the CLI lives inside the full application archive, because
those platforms have no separate CLI download — only the one binary is extracted.

Set `GITHUB_TOKEN` to avoid GitHub's anonymous rate limit, and
`DSH_ARTCRAFT_BIN_DIR` to install somewhere else.

#### Or build from source

```sh
node scripts/install-craft.mjs --from-source                 # clone into ./repos and build
node scripts/install-craft.mjs --from-source gridcraft       # one craft
node scripts/install-craft.mjs --from-source --repos ~/src   # use an existing checkout
```

This compiles each craft's `*-cli` crate with Cargo instead of downloading, which
is worth it when you want a specific commit, a local patch, an architecture
upstream does not publish, or a fully offline workflow. It is cheaper than it
looks: **the CLI crates do not depend on the GUI stack**, so a release build is
about a minute and 266 MB of `target/` for GridCraft, against the multi-hour
egui/wgpu build the full application would need.

Rust is required and checked before anything is cloned:

```sh
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

| | Download | `--from-source` |
|:--|:--|:--|
| Time to first run | ~1 min per craft | ~1 min per craft after a one-time Rust install |
| Architectures | what upstream publishes | anything Rust targets |
| Version control | latest release only | any commit, and local patches |
| Works offline | no | yes, after the first clone |
| Integrity | upstream's signed, notarized binary | your own build |

### 2. Install the plugins into a DSH profile

```sh
node scripts/install-into-profile.mjs                    # profile "web", home ~/.dsh
node scripts/install-into-profile.mjs --profile web
node scripts/install-into-profile.mjs --dry-run          # show what would change
node scripts/install-into-profile.mjs --uninstall
```

The script packs each plugin, installs the tarballs into the profile with pnpm,
and records them in the profile's `dsh.profile.bundles`. That last step is what
makes the plugins **appear on the Web Plugins page**: a row written directly into
`cordis.patch.yml` loads, but no bundle owns it, so the page cannot list or toggle
it.

### 3. Restart the profile

```sh
dsh --profile web web
```

Plugin rows are read at boot. The Plugins page then lists all twelve, and the
agent gains their tools.

## Use

Ask for what you want; the model picks the tools.

```
Make a sales spreadsheet for Q3 with a chart, and put it in ~/Documents/q3.xlsx
```

A typical exchange, and the loop the tools are designed for:

1. `gridcraft_commands` with `{"search": "chart"}` — find the command ids and their parameter grammar.
2. `gridcraft_describe` with `{"id": "insert.chart"}` — read one command's full parameter shape.
3. `gridcraft_run` — apply the commands and write the file:

```json
{
  "sample": "budget",
  "commands": [
    { "id": "cell.set", "json": { "cell": "Z1", "input": "hello" } },
    { "id": "insert.chart", "json": { "range": "B4:F15", "type": "column" } }
  ],
  "save": "/tmp/out.xlsx"
}
```

4. `gridcraft_inspect` with `{"file": "/tmp/out.xlsx"}` — read back what was produced.

### Notes that matter in practice

- **`commands` takes `{ id, json }`.** A bare string entry is also accepted and split on its first
  space, so `"cell.set {\"cell\":\"A1\"}"` works too.
- **Crafts differ in how a run is spelled**, and the kernel hides that: GridCraft gets
  `--cmd id={...}`, PhotoCraft/VectorCraft get `--cmd id --params {...}`, EffectCraft/FilmCraft get
  positional `id {...}`, LightCraft/PdfCraft get `id key=value`.
- **Some crafts cannot take `save`.** EffectCraft and DesignCraft write through their own commands
  (`file.saveAs`, `--export`); the tool omits the parameter rather than sending a flag the CLI
  would reject.
- **PdfCraft holds one document per process.** A second `pdfcraft_run` call replays the first
  call's commands so the document still exists; pass `resetSession: true` to start fresh.
- **FilmCraft takes a JSONL script.** The kernel writes it for you; `save` becomes the global
  `--save-as FILE` that must precede `run`.

## Configuration

Each plugin accepts the same config in `cordis.patch.yml`:

```yaml
- id: artcraft-gridcraft
  config:
    path: /opt/craft/bin/gridcraft-cli   # override binary discovery
    timeoutMs: 300000                     # per-call budget
    catalogLimit: 120                     # rows printed by *_commands
    registerWhenMissing: true             # keep tools registered with no binary
    enableMcp: true                       # bridge to the craft's own MCP server
    mcpIdleMs: 300000                     # shut the MCP server down after this idle time
```

Binary discovery order, reported in every failure message: `config.path` → `$<CRAFT>_CLI`
(`GRIDCRAFT_CLI`, `CADCRAFT_CLI`, …) → `craft-kit/catalog/binaries.json` → `crafts-bin/` beside the
plugins → `PATH`.

With no binary installed the tools stay registered and explain exactly what to install, so the
failure is visible to the model instead of the tools silently disappearing.

### Alternative: DSH's own MCP client

The plugins embed their own MCP bridge, so nothing else is needed. If you would rather let DSH's
built-in `mcp-client` own the connection — for example to share one server between the agent and
another tool, or to set a per-call timeout — point it at the same binaries in
`cordis.patch.yml`:

```yaml
- id: mcp-gridcraft
  name: "@deepseek-ai/dsh-mcp-client"
  config:
    transport: stdio
    serverName: gridcraft
    command: /absolute/path/to/gridcraft-cli
    args: ["mcp"]
    toolCallTimeoutMs: 120000
    failOnStartupError: false
```

Its tools appear as `mcp__gridcraft__<toolName>`. The two approaches are independent and can be
used together; the built-in client additionally exposes MCP *resources*.

## Verify

```sh
node scripts/verify.mjs            # all 12: discovery, catalog, tools, and a real headless run
node scripts/verify.mjs --quick    # skip the headless runs
node scripts/verify.mjs filmcraft  # one craft
```

Each craft must find its binary, load its live catalog, expose the right tool set, and produce a
non-empty artifact. The script also fails if the generated kernel in `dsh-plugins/craft-kit/lib/`
is stale.

## Repository layout

```
repos/                         23 cloned upstream repositories (never modified)
crafts-bin/                    the craft CLIs the plugins drive
dsh-plugins/
  craft-kit/                   shared kernel: discovery, exec, catalogs, tool factory
    src/                       TypeScript source of truth
    lib/                       generated plain ESM (scripts/build-kit.mjs)
    catalog/                   per-craft catalog snapshots + binaries.json
  plugin-<craft>/              one DSH plugin per craft
scripts/
  install-craft.mjs            download the craft CLIs for this platform
  install-into-profile.mjs     install the plugins into a dsh profile
  build-kit.mjs                compile craft-kit/src → craft-kit/lib
  gen-catalogs.mjs             snapshot each craft's command catalog
  lib/archive.mjs              Node-only zip and tar.gz extraction
  verify.mjs                   end-to-end verification
docs/
  INSTALL.md                   this file
  CRAFT-MATRIX.md              verified CLI surface of all 23 repositories
  craft-notes/                 per-craft evidence and limitations
```

## Troubleshooting

**Tools do not appear after restarting.** Check the plugin rows compose:

```sh
dsh --profile <name> --dump-config | grep artcraft
```

A `patch: entry "..." not found` warning means a row is being treated as an override; new rows
must live inside an `insert` list (the linker does this for you). A
`warning: N entries did not activate` message prints the exact error per plugin on stderr.

**A tool says the binary was not found.** The message lists every path searched; run
`node scripts/install-craft.mjs <craft>` or set `$<CRAFT>_CLI`.

**A craft command fails with `unknown option`.** The craft's profile disagrees with its CLI —
`docs/craft-notes/<craft>.md` records which options were verified, and `DSH_ARTCRAFT_TRACE=/tmp/trace.log`
records the exact argv of every invocation.
