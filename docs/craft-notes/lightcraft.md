# LightCraft → `@dsh-artcraft/plugin-lightcraft`

Verified against `crafts-bin/lightcraft-cli` **0.6.0** (2026-10-13), workspace
`/Users/zhinan/Documents/dsh_workspace/dsh-artcraft`.

## Package

| | |
|---|---|
| Package dir | [`dsh-plugins/plugin-lightcraft/`](../../dsh-plugins/plugin-lightcraft) |
| Plugin name | `dsh-artcraft-lightcraft` |
| Profile | `profileOf('lightcraft')` — `cmdStyle: 'positional-kv'`, `positionalKeyValues: true` |
| Binary | `lightcraft-cli` (`LIGHTCRAFT_CLI`, found in `crafts-bin/`) |
| Tools | `lightcraft_run`, `lightcraft_commands`, `lightcraft_describe`, `lightcraft_inspect` (no `convert`: the profile declares no `convert` read) |
| Docblock not in scope | `src/root.ts` is byte-identical to the GridCraft reference (sha256 `40d2d5b8…6698f`), per the task's "copy verbatim" |

## How the CLI spells a headless run

```
lightcraft-cli run [--demo | --library DIR | --import PATH…] COMMAND [key=value | '{json}']… [COMMAND …]
```

Commands are **positional**; a bare word (no `=`) starts the next command and values are parsed
as JSON when they parse, otherwise as strings (`--help`). The kernel's `positional-kv` style
emits exactly that: one word per command id, then `key=value` for each entry of the command's
JSON object. `--demo` is the profile's `sampleFlag` and loads the procedural demo library, which
is what makes a run headless and deterministic.

## Verified evidence

Kernel-driven run (`createRuntime` + `createToolSet(...).run.execute`, cwd = workspace root):

```
[profileOf] LightCraft id=lightcraft bin=lightcraft-cli style=positional-kv saveFlag=--library
[binary]    {"path":"…/crafts-bin/lightcraft-cli","source":"search-dir:…/crafts-bin","version":"lightcraft-cli 0.6.0"}
[catalog]   origin=live count=296
[catalog]   first5=edit.undo, edit.redo, library.source, library.filter, library.folders
[tools]     run, commands, describe, inspect
[argv]      lightcraft-cli run --demo develop.auto app.export path=/tmp/lc-kernel.jpg longEdge=800
[result]    {"command":"develop.auto","ms":27.1,"ok":true,"result":{"blacks":0.0,…}}
            {"command":"app.export","ms":177.3,"ok":true,"result":{"bytes":63977,"height":799,"path":"/tmp/lc-kernel.jpg",…}}
            LightCraft exited 0 in 211ms
[artifact]  /tmp/lc-kernel.jpg  63977 bytes
            JPEG image data, JFIF standard 1.02, …, 533x799, components 3
```

The catalog is read live from the 602-line `lightcraft-cli commands` **table** (`catalogJson:
false`); the kernel's table parser folds the indented `params:` continuation lines back into
their command and yields **296** commands with `origin: 'live'`.

## Quirks and mismatches (kernel NOT edited)

1. **`lightcraft_inspect` ignores its `file` argument.** `reads.inspect.verb` is `commands`, so
   the generated tool runs `lightcraft-cli commands <file>`; the CLI accepts the extra positional
   and prints the command table anyway, exiting 0:

   ```
   [argv] lightcraft-cli commands /tmp/does-not-exist-xyz.lcraft
   [result] 603 lines, tail: "… params: {…} | LightCraft exited 0 in 6ms"
   ```

   The tool is therefore usable as a command reference but is not a document inspector. The task
   for this batch treats the profile as authoritative, so the kernel and profile were left alone.

2. **`saveFlag: '--library'` is not a document writer.** It opens (or creates) a LightCraft
   library directory; on a fresh empty library there is no photo selected and develop commands
   fail. Artifacts are written by the `app.export` command's own `path=`, not by the save flag:

   ```
   lightcraft-cli run --library /tmp/lc-lib develop.auto app.export path=/tmp/lc-lib-export.jpg longEdge=400
   → {"command":"develop.auto","error":"command `develop.auto` is not available right now: no photo selected","ok":false}
   → lightcraft-cli: 1 command(s) failed   (exit 1)
   ```

   The plugin's system-prompt line is generated from the profile (`…written with \`--library\``),
   which is faithful to `profiles.mjs` but reads oddly for this craft.
