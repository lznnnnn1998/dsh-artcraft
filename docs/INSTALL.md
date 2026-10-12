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

### 1. Get the craft CLIs

The plugins need each craft's CLI binary. They are ordinary release assets, so no Rust toolchain
is required:

```sh
node scripts/fetch-binaries.mjs            # all crafts → crafts-bin/
node scripts/fetch-binaries.mjs gridcraft  # or just one
node scripts/fetch-binaries.mjs --list     # show what would be fetched
```

Binaries land in `crafts-bin/` and their paths are recorded in
`dsh-plugins/craft-kit/catalog/binaries.json`, which the kernel reads first. You can also skip
this step and point the plugins at your own copies (see [Configuration](#configuration)).

### 2. Link the plugin dependencies

The plugins import `@deepseek-ai/cordis` and `@deepseek-ai/dsh-tools`, and they must be the *same*
instances the harness runs — a second Cordis copy would hand the plugin a different `Context` and
nothing would register. `node_modules` is not committed, so link it against your harness checkout:

```sh
node scripts/install-links.mjs
# or, if autodetection misses it:
node scripts/install-links.mjs --harness ~/code/deepseek-harness
DSH_HARNESS_DIR=/path/to/deepseek-harness node scripts/install-links.mjs
```

It looks for a **built** checkout (its `vendor/cordis/lib/index.js` and
`packages/core/tools/lib/index.js` must exist) and fails with instructions if it finds only an
unbuilt one. `pnpm install` inside `dsh-plugins/` produces the same links.

### 3. Load the plugins into a DSH profile

```sh
node scripts/link-into-profile.mjs                    # profile "web", home ~/.dsh
node scripts/link-into-profile.mjs --profile headless
node scripts/link-into-profile.mjs --print            # show the YAML rows only
node scripts/link-into-profile.mjs --remove           # uninstall
```

This symlinks each plugin into the profile's `node_modules` and writes one managed `insert` block
into `<profile>/cordis.patch.yml` between `# >>> dsh-artcraft plugins` markers. Hand-written rows
elsewhere in the file are never touched, and re-running is idempotent.

### 4. Restart the profile

```sh
dsh --profile web web        # or whichever profile you linked into
```

Plugin rows are read at boot, so a running session keeps the tools it started with.

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
  fetch-binaries.mjs           download and install the craft CLIs
  install-links.mjs            link the plugins against your harness checkout
  build-kit.mjs                compile craft-kit/src → craft-kit/lib
  gen-catalogs.mjs             snapshot each craft's command catalog
  link-into-profile.mjs        install/uninstall the plugins in a dsh profile
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
`node scripts/fetch-binaries.mjs <craft>` or set `$<CRAFT>_CLI`.

**A craft command fails with `unknown option`.** The craft's profile disagrees with its CLI —
`docs/craft-notes/<craft>.md` records which options were verified, and `DSH_ARTCRAFT_TRACE=/tmp/trace.log`
records the exact argv of every invocation.
