# PdfCraft → `@dsh-artcraft/plugin-pdfcraft`

Verified against `crafts-bin/pdfcraft-cli` **0.7.1** (2026-10-13), workspace
`/Users/zhinan/Documents/dsh_workspace/dsh-artcraft`.

## Package

| | |
|---|---|
| Package dir | [`dsh-plugins/plugin-pdfcraft/`](../../dsh-plugins/plugin-pdfcraft) |
| Plugin name | `dsh-artcraft-pdfcraft` |
| Profile | `profileOf('pdfcraft')` — `cmdStyle: 'positional-kv'`, `positionalKeyValues: true`, `saveFlag: '--out'`, `sampleFlag: '--script'` |
| Binary | `pdfcraft-cli` (`PDFCRAFT_CLI`, found in `crafts-bin/`) |
| Tools | `pdfcraft_run`, `pdfcraft_commands`, `pdfcraft_describe`, `pdfcraft_inspect`, `pdfcraft_convert` |
| Docblock not in scope | `src/root.ts` byte-identical to the reference (sha256 `40d2d5b8…6698f`) |

## How the CLI spells a headless run

```
pdfcraft-cli run <tool> [key=value …] [--root DIR] [--out image.png]
pdfcraft-cli run --script steps.json [--root DIR]          # [{"tool": …, "args": {…}, "out": …}, …]
```

`run` takes **exactly one tool name** followed by `key=value` pairs — the source is explicit
(`repos/pdfcraft/apps/pdfcraft-cli/src/main.rs:750`: `kv.split_once('=').ok_or("run: expected
key=value, got …")`, one `auto.call(tool, obj)` per invocation). Multi-step work goes through
`--script`. Image results are written by `--out`, which belongs to the single call.

## Verified evidence

```
[profileOf] PdfCraft id=pdfcraft bin=pdfcraft-cli style=positional-kv saveFlag=--out
[binary]    {"path":"…/crafts-bin/pdfcraft-cli","source":"search-dir:…/crafts-bin","version":"pdfcraft-cli 0.7.1"}
[catalog]   origin=live count=86
[catalog]   first5=file.open, file.properties, file.close, file.save, edit.column_select
[tools]     run, commands, describe, inspect, convert
```

Real headless runs through the kernel:

```
-- B: positional-kv run (needs `input` to suppress the implicit --script, see mismatch 3)
[argv]   pdfcraft-cli run doc_open path=…/repos/pdfcraft/crates/ui-egui/tests/data/form.pdf
[result] {"dirty":false,"doc":1,"editable":true,"pages":1,"path":"…/form.pdf",…}
         PdfCraft exited 0 in 4ms

-- C: multi-step script mode (extraArgs) — exit 0 and a real artifact
[argv]   pdfcraft-cli run --script /tmp/pdf-steps.json
[result] {"bytes":990,"document":{…"path":"/tmp/pdf-kernel-out.pdf"…},"incremental":false,…}
         PdfCraft exited 0 in 4ms
[artifact]  /tmp/pdf-kernel-out.pdf  990 bytes — PDF document, version 1.7

-- raw CLI, same session, `render` subcommand (profile `reads.convert.verb`)
$ pdfcraft-cli render repos/pdfcraft/crates/ui-egui/tests/data/form.pdf --page 1 --dpi 96 --out /tmp/pdf-page.png
rendered page 1 at 96 dpi: 400×534 px in 2 ms      (exit 0)
/tmp/pdf-page.png  1887 bytes — PNG image data, 400 x 534
```

## Mismatches between `profiles.mjs` and the real CLI (kernel NOT edited)

**1. Catalog ids are app-command ids; `run` wants tool *names*.** `pdfcraft-cli tools` entries
carry both `name` (tool: `doc_open`) and `command` (app command: `file.open`). The kernel's
`normalize()` prefers `id`/`command`, so the catalog advertises `file.open`, and `run` rejects it:

```
kernel argv: pdfcraft-cli run file.open path=…/form.pdf
→ pdfcraft-cli: unknown tool "file.open"        (exit 1)

kernel argv: pdfcraft-cli run doc_open path=…/form.pdf
→ {"doc":1,"pages":1,…}                          (exit 0)
```

**2. `run` takes one tool; the `run` tool description promises an ordered list.** Passing two
commands produces argv the CLI rejects:

```
kernel argv: pdfcraft-cli run doc_open path=…/form.pdf doc_save doc=1 path=/tmp/pdf-two.pdf
→ pdfcraft-cli: run: expected key=value, got "doc_save"     (exit 1)
```

**3. `sampleFlag: '--script'` is injected on every run without `input`, and eats the tool name.**
The `run` tool sets `sample: true` when no `input` is supplied and the profile has no `samples`,
so `buildRunArgv` emits a bare `--script` before the commands:

```
kernel argv: pdfcraft-cli run --script doc_open path=…/form.pdf
→ pdfcraft-cli: doc_open: No such file or directory (os error 2)    (exit 1)
```

Supplying any `input` string suppresses `--script` (and is otherwise ignored, since `inFlag` is
`''`); supplying a script path via `extraArgs` is the only kernel path that both suppresses it and
stays meaningful. A profile with `newSampleValue` for `--script`, or `sampleFlag: ''` plus a
script argument, would fix this — that is a kernel/profile change, so it is reported, not made.

**4. Two thirds of the toolset never reaches the catalog.** `pdfcraft-cli tools` lists **161**
tools, but **75** have `"command": null` (including `page_render`, `doc_create`, `doc_list`,
`render_preview`) and `normalize()` drops them, so only **86** are visible to the model:

```
live catalog count = 86 of 161 tools in `pdfcraft-cli tools`
has id "file.open"   : true
has id "doc_open"    : false
has id "page_render" : false
```

**5. `pdfcraft_convert` runs a subcommand that does not exist.** `createToolSet` hardcodes
`argv: ['convert', input, output]`, while PdfCraft spells that operation `render`:

```
reads.convert.verb = "render"
kernel argv: pdfcraft-cli convert in.pdf out.png  (hardcoded in createToolSet)
→ pdfcraft-cli: unknown command 'convert'; see pdfcraft-cli --help    (exit 1)
```

`pdfcraft_inspect` (`info <file>`) is correct as wired.
