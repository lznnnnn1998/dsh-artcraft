# PhotoCraft → `@dsh-artcraft/plugin-photocraft`

Verified against `crafts-bin/photocraft-cli` **0.7.0** (`792616159`, 2026-10-11) on 2026-10-13,
workspace `/Users/zhinan/Documents/dsh_workspace/dsh-artcraft`.

## Package

| | |
|---|---|
| Package dir | [`dsh-plugins/plugin-photocraft/`](../../dsh-plugins/plugin-photocraft) |
| Plugin name | `dsh-artcraft-photocraft` |
| Profile | `profileOf('photocraft')` — `cmdStyle: 'flag-params'`, `cmdParamsFlag: '--params'`, `saveFlag: '--out'` |
| Binary | `photocraft-cli` (`PHOTOCRAFT_CLI`, found in `crafts-bin/`) |
| Tools | `photocraft_run`, `photocraft_commands`, `photocraft_describe`, `photocraft_inspect`, `photocraft_convert` |
| Docblock not in scope | `src/root.ts` byte-identical to the reference (sha256 `40d2d5b8…6698f`) |

## How the CLI spells a headless run

```
photocraft-cli run (<file> | --new <json>) --cmd <id> [--params <json>] [--cmd …] [--out <file>] [--format <ext>] [--quality <1-100>]
```

Each `--params` applies to the preceding `--cmd` — exactly the kernel's `flag-params` style.
`--new` is the profile's `sampleFlag` with `newSampleValue: {"width":1920,"height":1080}`; the
CLI accepts any `{"width":…,"height":…}` JSON there, so a 64×64 canvas means overriding
`newSampleValue` (not modelled by the tool's schema) or relying on `file.new` params, as below.

## Verified evidence

```
[profileOf] PhotoCraft id=photocraft bin=photocraft-cli style=flag-params saveFlag=--out
[binary]    {"path":"…/crafts-bin/photocraft-cli","source":"search-dir:…/crafts-bin","version":"photocraft-cli 0.7.0 (792616159, 2026-10-11)"}
[catalog]   origin=live count=858
[catalog]   first5=file.new, file.close, edit.undo, edit.redo, edit.fill
[tools]     run, commands, describe, inspect, convert

[argv]      photocraft-cli run --new {"width":1920,"height":1080} --cmd file.new --params {"width":64,"height":64} --out /tmp/pc-kernel.png
[result]    {"command":"file.new","result":{"document":1}}
            PhotoCraft exited 0 in 35ms
[artifact]  /tmp/pc-kernel.png  168 bytes — PNG image data, 64 x 64, 8-bit/color RGB, non-interlaced
```

The literal argv suggested by the task also works standalone:

```
$ photocraft-cli run --new '{"width":64,"height":64}' --cmd file.new --out /tmp/pc.png
{"command":"file.new","result":{"document":1}}      (exit 0)
/tmp/pc.png  8712 bytes — PNG image data, 1920 x 1080     # --out saves the --new document, not file.new's
```

The catalog is read live from `photocraft-cli commands --json` (261 787 bytes of JSON) and
yields **858** commands with `origin: 'live'`.

## Notes and quirks

1. **The profile's default canvas wins over `file.new` params for the `--new` document.** In the
   kernel run above `--new` created the 1920×1080 document and `file.new {64×64}` created a second
   document; `--out` saved the 64×64 one because `file.new` makes it active. Both argv spellings
   are valid; only the saved size differs.
2. **`samples` is not declared for PhotoCraft**, so the `run` tool has no `sample` parameter and
   always sends the profile's `newSampleValue` when no `input` is given. That is faithful to
   `profiles.mjs` and works; it does mean a model cannot pick 64×64 through the schema.
3. **`inspect` and `convert` are correct as wired**: `photocraft-cli info <file>` and
   `photocraft-cli convert <in> <out>` both exist in `--help`.
4. No contradiction with `dsh-plugins/craft-kit/src/profiles.mjs` was found for this craft, and
   the kernel was not modified.
