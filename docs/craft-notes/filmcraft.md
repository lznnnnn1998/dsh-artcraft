# FilmCraft plugin — verification notes

Task: `task-1` (batch A: effectcraft, filmcraft, designcraft) · owner `craft-a` · 2026-10-13
Binary: `crafts-bin/filmcraft-cli` **0.6.0** (124 MB, pre-installed, untouched)

## Deliverables

| Path | Notes |
| --- | --- |
| `dsh-plugins/plugin-filmcraft/package.json` | reference `plugin-gridcraft/package.json` verbatim; only `name` + `description` changed |
| `dsh-plugins/plugin-filmcraft/src/root.ts` | reference code verbatim; only the `@module` tag changed to this package |
| `dsh-plugins/plugin-filmcraft/src/index.ts` | reference + craft strings (`name`, `profileOf('filmcraft')`, docblock, error text, prompt section) |
| `dsh-plugins/plugin-filmcraft/node_modules/@dsh-artcraft/craft-kit` | symlink → `../../../craft-kit` |
| `dsh-plugins/plugin-filmcraft/node_modules/@deepseek-ai/dsh-tools` | symlink → `/Users/zhinan/deepseek-harness/packages/core/tools` |
| `dsh-plugins/plugin-filmcraft/node_modules/@deepseek-ai/cordis` | symlink → `/Users/zhinan/deepseek-harness/vendor/cordis` |

## ACCEPTANCE 1 — kernel probe (cwd = plugin package)

```console
$ cd dsh-plugins/plugin-filmcraft && node --input-type=module -e "
const kit = await import('@dsh-artcraft/craft-kit')
const profile = kit.profileOf('filmcraft')
const runtime = kit.createRuntime(profile, process.cwd(), {})
const bin = runtime.binary(); const cat = await runtime.catalog()
console.log(JSON.stringify({ profileId: profile.id, binary: bin.path, source: bin.source,
  version: bin.version, catalogOrigin: cat.origin, catalogCommands: cat.commands.length }, null, 2))"
{
  "profileId": "filmcraft",
  "product": "FilmCraft",
  "binary": "/Users/zhinan/Documents/dsh_workspace/dsh-artcraft/crafts-bin/filmcraft-cli",
  "binarySource": "search-dir:/Users/zhinan/Documents/dsh_workspace/dsh-artcraft/crafts-bin",
  "binaryVersion": "filmcraft-cli 0.6.0",
  "catalogOrigin": "live",
  "catalogCommands": 693,
  "firstIds": ["file.newProject", "file.openDemoProject", "file.newSequence"]
}
```

`profileOf('filmcraft')` resolves, `runtime.binary()` finds exactly
`crafts-bin/filmcraft-cli`, `runtime.catalog()` is **live** with **693** commands
(from `filmcraft-cli commands --json`, a pretty-printed JSON array).

## ACCEPTANCE 2 — real headless end-to-end run (exit 0 + artifact)

### 2a. The kernel's argv does NOT work — raw evidence

```console
$ cd dsh-plugins/plugin-filmcraft && node --input-type=module -e "
const kit = await import('@dsh-artcraft/craft-kit')
const runtime = kit.createRuntime(kit.profileOf('filmcraft'), process.cwd(), {})
const tools = kit.createToolSet(runtime)
const args = { commands: [{ id: 'file.newProject', json: { name: 'craft-a' } }] }
console.log('argv:', JSON.stringify(kit.buildRunArgv(runtime.profile, args)))
console.log(await tools.run.execute(args))"

argv: ["run","file.newProject","{\"name\":\"craft-a\"}"]
filmcraft-cli: file.newProject: No such file or directory (os error 2)
FilmCraft exited 1 in 4ms
```

The profile says `cmdStyle: 'positional-pair'` (same as EffectCraft) **and**
`scriptMode: true`, but the real CLI is:

```
run <script.jsonl | ->        run commands, one {"id","params"} per line (# comments ok)
```

i.e. `run`'s first positional is a **script file path** (or `-` for stdin). The kernel's
`buildRunArgv` implements `positional-pair` and ignores `scriptMode` entirely, so
`["run","file.newProject","{…}"]` makes the CLI try to open a file named `file.newProject`.
Direct proof that positional pairs are the wrong spelling:

```console
$ crafts-bin/filmcraft-cli run file.newProject '{"name":"craft-a"}'
filmcraft-cli: file.newProject: No such file or directory (os error 2)      # exit 1
```

### 2b. The real, working headless run — raw evidence

```console
$ cat /tmp/craft-a-ev/e2e/film.jsonl
{"id":"file.newProject","params":{"name":"craft-a"}}
{"id":"file.newSequence","params":{"name":"Seq A","width":1920,"height":1080,"fps":24}}
{"id":"file.newColorMatte","params":{"color":"#3366ff","seconds":2}}

$ crafts-bin/filmcraft-cli --save-as /tmp/craft-a-ev/e2e/film-a.fcproj run /tmp/craft-a-ev/e2e/film.jsonl
{"id":"file.newProject","line":1,"ok":true,"result":null}
{"id":"file.newSequence","line":2,"ok":true,"result":{"sequence":7}}
{"id":"file.newColorMatte","line":3,"ok":true,"result":{"item":8}}
exit=0

$ ls -la /tmp/craft-a-ev/e2e/film-a.fcproj
-rw-r--r--@ 1 zhinan  wheel  3991 Oct 13 00:15 /tmp/craft-a-ev/e2e/film-a.fcproj
```

`run -` (JSONL on stdin) is equivalent and also exits 0:

```console
$ printf '%s\n' '{"id":"file.newProject","params":{"name":"stdin-a"}}' | crafts-bin/filmcraft-cli run -
{"id":"file.newProject","line":1,"ok":true,"result":null}      # exit 0
```

**Artifact produced:** `/tmp/craft-a-ev/e2e/film-a.fcproj` (3 991 bytes), the saved project,
written by a real headless `run` that exited 0. The plugin itself cannot currently produce
it, because the kernel builds a positional-pair argv for FilmCraft.

### 2c. `filmcraft_inspect` is broken for the same reason

```console
$ tools.inspect.execute({ file: '/tmp/craft-a-ev/e2e/film-a.fcproj' })
filmcraft-cli: inspect: unknown `/tmp/craft-a-ev/e2e/film-a.fcproj` (project | sequence)
Run `filmcraft-cli help` for usage.
FilmCraft exited 2 in 6ms
```

The real interface is `inspect [project|sequence]` with the project supplied by the global
`--project <p.fcproj>`; the profile's `reads: [{ name: 'inspect', verb: 'inspect' }]` plus the
kernel's `[verb, file]` argv produces an invalid selector. `tools` =
`run, commands, describe, inspect, convert`.

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
script: `plugin-filmcraft/src/{root,index}.ts` → `ok`.

## Reality vs. the kernel profile (kernel NOT edited)

| # | Profile claim | Reality (raw evidence above) |
| --- | --- | --- |
| 1 | `run.cmdStyle: 'positional-pair'`, `run.verb: 'run'` | `run` takes a JSONL **script file** or `-`; `scriptMode: true` is set but never honoured by `buildRunArgv` |
| 2 | `reads: [{ name: 'inspect', verb: 'inspect' }]` → `[verb, file]` argv | Real `inspect [project\|sequence]` selects a *section*; the project comes from `--project`, so the file argument is rejected with exit 2 |
| 3 | `run.inFlag: ''` | Correct (no `--in`); the project is opened with the global `--project`/`--demo`, reachable only via `extraArgs` |
| 4 | `run.saveFlag` absent | `--save`/`--save-as` are global flags; `buildRunArgv` cannot emit them, so the tool's `save` parameter pushes an `undefined` argv element (same defect as EffectCraft) |

Fixing this needs a `scriptMode` path in `dsh-plugins/craft-kit/src/exec.ts` (write the
commands as JSONL and pass the file/stdin marker) — Lead's scope, deliberately not touched.
