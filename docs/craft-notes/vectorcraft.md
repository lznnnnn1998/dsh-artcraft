# VectorCraft → DSH plugin

`dsh-plugins/plugin-vectorcraft/` exposes VectorCraft (vector illustration) to the agent as
Cordis tools that drive the real `vectorcraft-cli`. The upstream source tree is never touched:
the CLI is an external process discovered at call time, so installing it mid-session works.

## Package layout

| Path | Notes |
| --- | --- |
| `package.json` | `@dsh-artcraft/plugin-vectorcraft`; identical to the GridCraft reference apart from `name`/`description`; `exports` → `./src/index.ts` (DSH loads plugins through tsx); no build step, no `lib/` |
| `src/root.ts` | byte-identical to `plugin-gridcraft/src/root.ts` (verified by `shasum`) |
| `src/index.ts` | reference plugin with the craft id, `profileOf('vectorcraft')`, `export const name`, docblock and prompt text changed |
| `node_modules/@dsh-artcraft/craft-kit` | symlink → `../../../craft-kit` (prebuilt `lib/index.js`) |
| `node_modules/@deepseek-ai/{dsh-tools,cordis}` | symlinks → DSH checkout `packages/core/tools`, `vendor/cordis` |

## Wiring taken from `craft-kit/src/profiles.mjs` (kernel unmodified)

```json
{"verb":"run","inFlag":"--in","sampleFlag":"--new","cmdFlag":"--cmd","cmdSeparator":"",
 "cmdStyle":"flag-params","cmdParamsFlag":"--params","saveFlag":"--export"}
```

`run --in FILE --cmd ID --params JSON … --export FILE`; catalogue from `commands` (JSON array).
Profile declares one read: `convert`.

## Verified evidence — 2026-10-13, `crafts-bin/vectorcraft-cli 0.10.0`

- `profileOf('vectorcraft')` → `VectorCraft`, `bin=vectorcraft-cli`
- `runtime.binary()` → `/Users/zhinan/Documents/dsh_workspace/dsh-artcraft/crafts-bin/vectorcraft-cli`
  (`search-dir:…/crafts-bin`), version `vectorcraft-cli 0.10.0`
- `runtime.catalog()` → `origin=live`, **743** commands, first ids `file.new,file.close,document.activate,document.inspect`
- registered tools: `vectorcraft_run`, `vectorcraft_commands`, `vectorcraft_describe`, `vectorcraft_convert`
- raw CLI end-to-end:
  `vectorcraft-cli run --cmd file.new --params '{}' --export /tmp/vc.svg` → exit 0
  ```
  {"command":"file.new","result":{"index":0,"previewMode":"default"},"step":"cmd"}
  {"result":{"bytes":251,"format":"svg","path":"/tmp/vc.svg","warnings":[]},"step":"export"}
  ```
  `/tmp/vc.svg` = 251 bytes
- through the plugin: `vectorcraft_run({input:"/tmp/vc.svg", save:"/tmp/plugin-vc-conv.pdf"})` → `VectorCraft exited 0 in 50ms`, `/tmp/plugin-vc-conv.pdf` 3906 bytes
- `vectorcraft_convert({input:"/tmp/vc.svg", output:"/tmp/plugin-vc-conv2.pdf"})` → exit 0, 3906 bytes

## Kernel/profile mismatches found (reported, kernel NOT edited)

1. **`run.sampleFlag: '--new'` is not a real flag.** `vectorcraft-cli run --new …` →
   ```
   vectorcraft-cli: unknown run option `--new`
   ```
   exit 1. Reality per `--help`: a new document is simply `run` with no `--in`. Consequence: the
   `vectorcraft_run` tool called *without* `input` fails (raw plugin-path output:
   `vectorcraft-cli: unknown run option `--new`\nVectorCraft exited 1 in 4ms`). Supplying `input`,
   or `extraArgs`, works today.
2. **Profile declares no `inspect`, but the CLI has one.** `vectorcraft-cli --help` documents
   `vectorcraft-cli info FILE` ("Print a JSON summary…"), and it exits 0 with JSON for
   `/tmp/vc.svg`. Because `profile.reads` only lists `convert`, the plugin correctly registers no
   `vectorcraft_inspect` (tool set matches the profile as specified), but the model has no
   first-class read tool for a VectorCraft document.
