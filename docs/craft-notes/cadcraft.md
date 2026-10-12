# CADCraft → DSH plugin

`dsh-plugins/plugin-cadcraft/` exposes CADCraft (AutoCAD-style CAD and drafting) to the agent as
Cordis tools that drive the real `cadcraft-cli`. The upstream source tree is never touched: the CLI
is an external process discovered at call time.

## Package layout

| Path | Notes |
| --- | --- |
| `package.json` | `@dsh-artcraft/plugin-cadcraft`; identical to the GridCraft reference apart from `name`/`description`; `exports` → `./src/index.ts`; no build step, no `lib/` |
| `src/root.ts` | byte-identical to `plugin-gridcraft/src/root.ts` (verified by `shasum`) |
| `src/index.ts` | reference plugin with the craft id, `profileOf('cadcraft')`, `export const name`, docblock and prompt text changed |
| `node_modules/@dsh-artcraft/craft-kit` | symlink → `../../../craft-kit` (prebuilt `lib/index.js`) |
| `node_modules/@deepseek-ai/{dsh-tools,cordis}` | symlinks → DSH checkout `packages/core/tools`, `vendor/cordis` |

## Wiring taken from `craft-kit/src/profiles.mjs` (kernel unmodified)

```json
{"verb":"run","inFlag":"--file","sampleFlag":"--sample","cmdFlag":"--cmd","cmdSeparator":"=",
 "saveFlag":"--save","exportFlag":"--export"}
```

`run --sample --cmd 'id={json}' --save out.dxf --export out.png`; catalogue from `commands`
(JSON array). Profile declares two reads: `inspect` (`info`) and `convert`.

## Verified evidence — 2026-10-13, `crafts-bin/cadcraft-cli 0.5.0`

- `profileOf('cadcraft')` → `CADCraft`, `bin=cadcraft-cli`
- `runtime.binary()` → `/Users/zhinan/Documents/dsh_workspace/dsh-artcraft/crafts-bin/cadcraft-cli`
  (`search-dir:…/crafts-bin`), version `cadcraft-cli 0.5.0`
- `runtime.catalog()` → `origin=live`, **305** commands, first ids `new,open,close,closeall`
- registered tools: `cadcraft_run`, `cadcraft_commands`, `cadcraft_describe`, `cadcraft_inspect`, `cadcraft_convert`
- raw CLI end-to-end:
  `cadcraft-cli run --sample --save /tmp/c.dxf --export /tmp/c.png` → exit 0
  ```
  wrote /tmp/c.dxf (34140 bytes)
  wrote /tmp/c.png (348621 bytes)
  ```
- through the plugin: `cadcraft_run({save:"/tmp/plugin-c.dxf", export:"/tmp/plugin-c.png"})` →
  `CADCraft exited 0 in 14ms`, `/tmp/plugin-c.dxf` 34140 bytes
- `cadcraft_inspect({file:"/tmp/plugin-c.dxf"})` → exit 0 (JSON: `entityCount: 46`, layers, extents)
- `cadcraft_convert({input:"/tmp/plugin-c.dxf", output:"/tmp/plugin-c.svg"})` → exit 0, 99867 bytes

## Kernel/profile mismatch found (reported, kernel NOT edited)

**`run.inFlag: '--file'` is not a real option.** `cadcraft-cli run --file /tmp/c.dxf --save …` →
```
unknown option --file
```
exit 1. Reality per `--help`: `cadcraft-cli run [FILE | --sample | --metric] …` — the input
document is **positional**. Consequence: `cadcraft_run` called *with* `input` fails (raw plugin-path
output: `unknown option --file\nCADCraft exited 1 in 2ms`); the sample path (no `input`) works.
Positional invocation `cadcraft-cli run /tmp/c.dxf --save /tmp/c3.dxf` exits 0 and writes 43398 bytes.
