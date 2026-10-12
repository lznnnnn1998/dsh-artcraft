# WordCraft → DSH plugin

`dsh-plugins/plugin-wordcraft/` exposes WordCraft (Word-style word processing) to the agent as
Cordis tools that drive the real `wordcraft-cli`. The upstream source tree is never touched: the CLI
is an external process discovered at call time.

## Package layout

| Path | Notes |
| --- | --- |
| `package.json` | `@dsh-artcraft/plugin-wordcraft`; identical to the GridCraft reference apart from `name`/`description`; `exports` → `./src/index.ts`; no build step, no `lib/` |
| `src/root.ts` | byte-identical to `plugin-gridcraft/src/root.ts` (verified by `shasum`) |
| `src/index.ts` | reference plugin with the craft id, `profileOf('wordcraft')`, `export const name`, docblock and prompt text changed |
| `node_modules/@dsh-artcraft/craft-kit` | symlink → `../../../craft-kit` (prebuilt `lib/index.js`) |
| `node_modules/@deepseek-ai/{dsh-tools,cordis}` | symlinks → DSH checkout `packages/core/tools`, `vendor/cordis` |

## Wiring taken from `craft-kit/src/profiles.mjs` (kernel unmodified)

```json
{"verb":"run","inFlag":"--file","sampleFlag":"--template","cmdFlag":"--cmd","cmdSeparator":"=",
 "saveFlag":"--save","printFlag":"--print"}
```

`run --file F --cmd 'id={json}' --save out.docx [--print]`; catalogue from `commands --json`.
Profile declares two reads: `inspect` and `convert`.

## Verified evidence — 2026-10-13, `crafts-bin/wordcraft-cli 0.5.0`

- `profileOf('wordcraft')` → `WordCraft`, `bin=wordcraft-cli`
- `runtime.binary()` → `/Users/zhinan/Documents/dsh_workspace/dsh-artcraft/crafts-bin/wordcraft-cli`
  (`search-dir:…/crafts-bin`), version `wordcraft-cli 0.5.0`
- `runtime.catalog()` → `origin=live`, **460** commands, first ids `text.insert,text.newParagraph,text.lineBreak,text.pageBreak`
- registered tools: `wordcraft_run`, `wordcraft_commands`, `wordcraft_describe`, `wordcraft_inspect`, `wordcraft_convert`
- raw CLI end-to-end:
  `wordcraft-cli run --cmd 'text.insert={"text":"Hello from craft-c"}' --save /tmp/w.docx` → exit 0
  ```
  wrote /tmp/w.docx
  ```
  `/tmp/w.docx` = 6285 bytes
- through the plugin: `wordcraft_run({input:"/tmp/w.docx", commands:[{id:"text.insert", json:{text:" via plugin"}}], save:"/tmp/plugin-w.docx"})`
  → `WordCraft exited 0 in 9ms`, `/tmp/plugin-w.docx` 6299 bytes
- `wordcraft_inspect({file:"/tmp/plugin-w.docx"})` → exit 0
  (`{"blocks":[{"index":0,"len":18,"style":"Normal","text":"Hello from craft-c via plugin","type":"paragraph"}],"pages":1,…}`)
- `wordcraft_convert({input:"/tmp/plugin-w.docx", output:"/tmp/plugin-w.md"})` → exit 0, 29 bytes
- the no-`input` path (`run --template --cmd … --save …`) also exits 0, so `sampleFlag: '--template'`
  is harmless as spelled by the kernel.

No kernel/profile contradiction was found for WordCraft.
