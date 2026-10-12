# DesignCraft plugin — verification notes

Task: `task-1` (batch A: effectcraft, filmcraft, designcraft) · owner `craft-a` · 2026-10-13
Binary: `crafts-bin/designcraft-cli` **0.6.0** (128 MB, pre-installed, untouched)

## Deliverables

| Path | Notes |
| --- | --- |
| `dsh-plugins/plugin-designcraft/package.json` | reference `plugin-gridcraft/package.json` verbatim; only `name` + `description` changed |
| `dsh-plugins/plugin-designcraft/src/root.ts` | reference code verbatim; only the `@module` tag changed to this package |
| `dsh-plugins/plugin-designcraft/src/index.ts` | reference + craft strings (`name`, `profileOf('designcraft')`, docblock, error text, prompt section) |
| `dsh-plugins/plugin-designcraft/node_modules/@dsh-artcraft/craft-kit` | symlink → `../../../craft-kit` |
| `dsh-plugins/plugin-designcraft/node_modules/@deepseek-ai/dsh-tools` | symlink → `/Users/zhinan/deepseek-harness/packages/core/tools` |
| `dsh-plugins/plugin-designcraft/node_modules/@deepseek-ai/cordis` | symlink → `/Users/zhinan/deepseek-harness/vendor/cordis` |

## ACCEPTANCE 1 — kernel probe (cwd = plugin package)

```console
$ cd dsh-plugins/plugin-designcraft && node --input-type=module -e "
const kit = await import('@dsh-artcraft/craft-kit')
const profile = kit.profileOf('designcraft')
const runtime = kit.createRuntime(profile, process.cwd(), {})
const bin = runtime.binary(); const cat = await runtime.catalog()
console.log(JSON.stringify({ profileId: profile.id, binary: bin.path, source: bin.source,
  version: bin.version, catalogOrigin: cat.origin, catalogCommands: cat.commands.length }, null, 2))"
{
  "profileId": "designcraft",
  "product": "DesignCraft",
  "binary": "/Users/zhinan/Documents/dsh_workspace/dsh-artcraft/crafts-bin/designcraft-cli",
  "binarySource": "search-dir:/Users/zhinan/Documents/dsh_workspace/dsh-artcraft/crafts-bin",
  "binaryVersion": "designcraft-cli 0.6.0",
  "catalogOrigin": "live",
  "catalogCommands": 446,
  "firstIds": ["file.new", "file.newSample", "file.presets"]
}
```

`profileOf('designcraft')` resolves, `runtime.binary()` finds exactly
`crafts-bin/designcraft-cli`, `runtime.catalog()` is **live** with **446** commands.
The profile reads the catalog with bare `commands` (`catalogJson: true`,
`catalogArgs: ['commands']`) — the CLI prints JSON by default. (`commands --json` would be
wrong here: the CLI treats `--json` as a *filter* and prints `[]`.)

## ACCEPTANCE 2 — real headless end-to-end run (exit 0 + artifact)

Driven through the kernel's own `run` tool, so the argv is exactly what the plugin sends:

```console
$ cd dsh-plugins/plugin-designcraft && node --input-type=module -e "
const kit = await import('@dsh-artcraft/craft-kit')
const runtime = kit.createRuntime(kit.profileOf('designcraft'), process.cwd(), {})
const tools = kit.createToolSet(runtime)
const args = { commands: [{ id: 'file.new', json: { preset: 'A4', pages: 1 } }],
               export: '/tmp/craft-a-ev/e2e/kit-design.pdf' }
console.log('argv:', JSON.stringify(kit.buildRunArgv(runtime.profile, { ...args, sample: true })))
console.log(await tools.run.execute(args))"

argv: ["run","--sample","--cmd","file.new={\"preset\":\"A4\",\"pages\":1}","--export","/tmp/craft-a-ev/e2e/kit-design.pdf"]
{"index":1}
wrote /tmp/craft-a-ev/e2e/kit-design.pdf (1 pages, 2028 bytes)
DesignCraft exited 0 in 45ms

$ ls -la /tmp/craft-a-ev/e2e/kit-design.pdf
-rw-r--r--@ 1 zhinan  wheel  2028 Oct 13 00:15 /tmp/craft-a-ev/e2e/kit-design.pdf
$ head -c 8 /tmp/craft-a-ev/e2e/kit-design.pdf | xxd
00000000: 2550 4446 2d31 2e37                      %PDF-1.7
```

The spelling matches the profile exactly: repeated `--cmd id=json`, plus `--export` for the
rendered artifact. `run --sample` loads the built-in magazine sample; the `file.new` command
then creates the real one-page A4 document that is exported.

`tools` = `run, commands, describe, inspect`. The **catalog-based `describe` tool works** — it
looks the command up in the live catalog:

```console
$ tools.describe.execute({ id: 'file.new' })
file.new  — Document…
params: {preset?: "Letter"|"A4"|…, width?, height?, pages?, facingPages?, columns?, gutter?, margins?: number|{top,bottom,inside,outside}, bleed?, title?}
menu: File ▸ New
shortcut: Cmd+N

Call it with `designcraft_run`: commands: [{ "id": "file.new", "json": { … } }]
```

The profile *also* declares `reads: [{ name: 'inspect', verb: 'describe' }]`, which makes the
kernel build a second, **broken** `designcraft_inspect` tool (see mismatch 2 below).

## ACCEPTANCE 3 — kernel untouched

```console
$ for f in dsh-plugins/craft-kit/lib/*.js dsh-plugins/craft-kit/lib/*.mjs; do node --check "$f"; done
ok  dsh-plugins/craft-kit/lib/catalog.js   ok  dsh-plugins/craft-kit/lib/discover.js
ok  dsh-plugins/craft-kit/lib/exec.js      ok  dsh-plugins/craft-kit/lib/index.js
ok  dsh-plugins/craft-kit/lib/tools.js     ok  dsh-plugins/craft-kit/lib/types.js
ok  dsh-plugins/craft-kit/lib/profiles.mjs
$ node scripts/build-kit.mjs --check
craft-kit/lib is up to date          # exit 0
```

`dsh-plugins/craft-kit/{src,lib}` mtimes stayed at 00:11–00:13 (before this task's writes at
00:15+). Nothing under `repos/`, `crafts-bin/` or `craft-kit/src` was modified. Plugin
TypeScript sources parse with the same `stripTypeScriptTypes` transform used by the build
script: `plugin-designcraft/src/{root,index}.ts` → `ok`.

## Reality vs. the kernel profile (kernel NOT edited)

1. **`run.saveFlag: '--save'` is wrong for the `run` verb.** DesignCraft's help for `run` is
   `run [--in FILE | --sample] [--cmd ID[=JSON]]… [--export OUT] [--all-pages DIR]` — there is
   no `--save` (only the separate `script` subcommand has `--save OUT`). Calling the tool's
   `save` parameter therefore fails:

   ```console
   $ # tools.run.execute({ commands: [{id:'file.new', json:{preset:'A4'}}], save: '…/kit-design-save.dcraft' })
   argv: ["run","--sample","--cmd","file.new={\"preset\":\"A4\"}","--save","/tmp/craft-a-ev/e2e/kit-design-save.dcraft"]
   {"index":1}
   designcraft-cli: unknown option --save
   DesignCraft exited 1 in 44ms
   ```

   Persisting a document works through `--export` (PDF, used above); a `.dcraft` round-trip
   needs the `script` subcommand, which the profile does not model.

2. **`reads: [{ name: 'inspect', verb: 'describe' }]` is not a document reader.** The kernel's
   `inspect` tool runs `[verb, file]`, i.e. `designcraft-cli describe <file>`, but DesignCraft's
   `describe` takes a **command id**:

   ```console
   $ tools.inspect.execute({ file: '/tmp/craft-a-ev/e2e/kit-design.pdf' })
   designcraft-cli: no command `/tmp/craft-a-ev/e2e/kit-design.pdf`
   DesignCraft exited 1 in 3ms

   $ crafts-bin/designcraft-cli describe file.new        # the real contract
   { "id": "file.new", "label": "Document…", "menu": ["File", "New"], …
   ```

   DesignCraft has no document-read verb at all (no `info`/`inspect` subcommand in its usage),
   so this read spec should be dropped from the profile rather than remapped; the generic
   catalog `describe` tool already covers command lookup.

3. **`--all-pages` typing** — the profile carries `exportAllPagesFlag: '--all-pages'` as a
   boolean-ish field in `CraftRunSpec` and `buildRunArgv` pushes `options.exportAllPages` as a
   value, but the CLI expects a **directory** (`--all-pages DIR`). Unused by the acceptance
   run; flagged for the profile owner.

These are documented here rather than fixed: `dsh-plugins/craft-kit/src/` is the Lead's scope.
