# EffectCraft plugin — verification notes

Task: `task-1` (batch A: effectcraft, filmcraft, designcraft) · owner `craft-a` · 2026-10-13
Binary: `crafts-bin/effectcraft-cli` **0.8.0** (144 MB, pre-installed, untouched)

## Deliverables

| Path | Notes |
| --- | --- |
| `dsh-plugins/plugin-effectcraft/package.json` | reference `plugin-gridcraft/package.json` verbatim; only `name` + `description` changed |
| `dsh-plugins/plugin-effectcraft/src/root.ts` | reference code verbatim; only the `@module` tag changed to this package |
| `dsh-plugins/plugin-effectcraft/src/index.ts` | reference + craft strings (`name`, `profileOf('effectcraft')`, docblock, error text, prompt section) |
| `dsh-plugins/plugin-effectcraft/node_modules/@dsh-artcraft/craft-kit` | symlink → `../../../craft-kit` |
| `dsh-plugins/plugin-effectcraft/node_modules/@deepseek-ai/dsh-tools` | symlink → `/Users/zhinan/deepseek-harness/packages/core/tools` |
| `dsh-plugins/plugin-effectcraft/node_modules/@deepseek-ai/cordis` | symlink → `/Users/zhinan/deepseek-harness/vendor/cordis` |

Peer resolution from inside the package (raw):

```
@dsh-artcraft/craft-kit -> file:///Users/zhinan/Documents/dsh_workspace/dsh-artcraft/dsh-plugins/craft-kit/lib/index.js
@deepseek-ai/dsh-tools  -> file:///Users/zhinan/deepseek-harness/packages/core/tools/lib/index.js
@deepseek-ai/cordis     -> file:///Users/zhinan/deepseek-harness/vendor/cordis/lib/index.js
```

## ACCEPTANCE 1 — kernel probe (cwd = plugin package)

```console
$ cd dsh-plugins/plugin-effectcraft && node --input-type=module -e "
const kit = await import('@dsh-artcraft/craft-kit')
const profile = kit.profileOf('effectcraft')
const runtime = kit.createRuntime(profile, process.cwd(), {})
const bin = runtime.binary(); const cat = await runtime.catalog()
console.log(JSON.stringify({ profileId: profile.id, binary: bin.path, source: bin.source,
  version: bin.version, catalogOrigin: cat.origin, catalogCommands: cat.commands.length }, null, 2))"
{
  "profileId": "effectcraft",
  "product": "EffectCraft",
  "binary": "/Users/zhinan/Documents/dsh_workspace/dsh-artcraft/crafts-bin/effectcraft-cli",
  "binarySource": "search-dir:/Users/zhinan/Documents/dsh_workspace/dsh-artcraft/crafts-bin",
  "binaryVersion": "effectcraft-cli 0.8.0",
  "catalogOrigin": "live",
  "catalogCommands": 669,
  "firstIds": ["file.newProject", "file.openDemoProject", "file.open"]
}
```

`profileOf('effectcraft')` resolves, `runtime.binary()` finds exactly
`crafts-bin/effectcraft-cli`, `runtime.catalog()` is **live** with **669** commands.
The catalog comes from `effectcraft-cli commands --json` (a JSON array even though the
profile sets `catalogJson: false`; `parseCatalog` handles the leading `[`).

## ACCEPTANCE 2 — real headless end-to-end run (exit 0 + artifact)

Driven through the kernel's own `run` tool (`createToolSet(runtime).run.execute`), so the
argv below is exactly what the plugin would send:

```console
$ cd dsh-plugins/plugin-effectcraft && node --input-type=module -e "
const kit = await import('@dsh-artcraft/craft-kit')
const runtime = kit.createRuntime(kit.profileOf('effectcraft'), process.cwd(), {})
const tools = kit.createToolSet(runtime)
const args = { commands: [{ id: 'file.saveAs', json: { path: '/tmp/craft-a-ev/e2e/kit-effect.ecproj' } }] }
console.log('argv:', JSON.stringify(kit.buildRunArgv(runtime.profile, args)))
console.log(await tools.run.execute(args))"

argv: ["run","file.saveAs","{\"path\":\"/tmp/craft-a-ev/e2e/kit-effect.ecproj\"}"]
{
  "bytes": 732438,
  "path": "/tmp/craft-a-ev/e2e/kit-effect.ecproj"
}
EffectCraft exited 0 in 15ms

$ ls -la /tmp/craft-a-ev/e2e/kit-effect.ecproj
-rw-r--r--  1 zhinan  wheel  732438 Oct 13 00:15 /tmp/craft-a-ev/e2e/kit-effect.ecproj
```

EffectCraft spells commands as **positional `id json` pairs**, which matches the profile
(`cmdStyle: 'positional-pair'`). A second run without `--project`/`--demo` starts from the
built-in sample project, so the artifact is the sample project saved to disk.

Read tool over the artifact:

```console
$ tools.inspect.execute({ file: '/tmp/craft-a-ev/e2e/kit-effect.ecproj' })
EffectCraft 0.8.0 (headless), 669 commands, 306 effects
project: /tmp/craft-a-ev/e2e/kit-effect.ecproj
  item 92  Composition  Lower Third
  item 502  Composition  EffectCraft Intro
active comp 92 "Lower Third" 1920x1080 @ 29.97002997002997 fps, 4.004 s
EffectCraft exited 0 in 8ms
```

`tools` = `run, commands, describe, inspect, convert` — `inspect` and `convert` exist because
the profile declares `info` and `render` reads.

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
00:15+). Nothing under `repos/`, `crafts-bin/` or `craft-kit/src` was modified.

Plugin TypeScript sources parse cleanly with Node's own `stripTypeScriptTypes` (the exact
transform `scripts/build-kit.mjs` uses): `plugin-effectcraft/src/{root,index}.ts` → `ok`.

## Reality vs. the kernel profile (kernel NOT edited)

1. **No `saveFlag`** — the profile's `run` block for effectcraft has no `saveFlag`, yet the
   `effectcraft_run` tool always advertises a `save` parameter. Calling it builds
   `["run","file.saveAs","{…}",null,"/tmp/…kit-effect-save.ecproj"]` (JSON view of the
   `undefined` element) and the craft rejects it:

   ```
   effectcraft-cli run: cannot read /tmp/craft-a-ev/e2e/kit-effect-save.ecproj: No such file or directory (os error 2)
   EffectCraft exited 1 in 6ms
   ```

   Saving works through the command layer instead: `file.saveAs {"path": …}` (used above).

2. **`input` is silently dropped** — `run.inFlag` is `''` (correct: EffectCraft opens a
   project with the *global* `--project F.ecproj | --demo | --empty`, which no profile field
   models). `buildRunArgv` therefore ignores `input` and only the `extraArgs` escape hatch
   reaches `--project`. The tool description still offers `input` as `.ecproject` source.

These are documented here rather than fixed: `dsh-plugins/craft-kit/src/` is the Lead's scope.
