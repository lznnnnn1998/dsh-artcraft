# SoundCraft — DSH plugin notes

Verified 2026-10-13 on macOS with `crafts-bin/soundcraft-cli` (**SoundCraft CLI 0.6.1**).
Every command below was run in this workspace; outputs are pasted verbatim.

| Item           | Value                                                                 |
| -------------- | --------------------------------------------------------------------- |
| Craft id       | `soundcraft`                                                          |
| Plugin package | `dsh-plugins/plugin-soundcraft/`                                      |
| Kernel profile | `dsh-plugins/craft-kit/src/profiles.mjs:81-105` (id `soundcraft`)     |
| Binary         | `crafts-bin/soundcraft-cli` (17,152,128 bytes)                        |
| Files          | `.scraft`, `.wav`, `.aiff`                                            |
| Tools          | `soundcraft_run`, `soundcraft_commands`, `soundcraft_describe`, `soundcraft_inspect`, `soundcraft_convert` |

## Verified

### 1. Profile, discovery and live catalog

```
$ cd dsh-plugins/plugin-soundcraft && node --input-type=module -e "…profileOf/createRuntime…"
1) profileOf(soundcraft) = {"id":"soundcraft","product":"SoundCraft","bin":"soundcraft-cli"}
2) runtime.binary() = {"path":"/Users/zhinan/Documents/dsh_workspace/dsh-artcraft/crafts-bin/soundcraft-cli","source":"search-dir:/Users/zhinan/Documents/dsh_workspace/dsh-artcraft/crafts-bin","version":"SoundCraft CLI 0.6.1"}
3) runtime.catalog() origin = live | count = 465
   groups = session,file,app,edit,view,track,clip,event,markers,mix,automation,options,setup,transport,engine
   sample ids = session.new, session.open, session.close, session.save, session.save_as, session.save_copy, session.save_template, session.revert
```

### 2. The plugin package loads through tsx and registers its tools

DSH loads plugins as TypeScript, so the entry was imported with `tsx` and `apply()` called
with a stub Cordis context:

```
module name   : dsh-artcraft-soundcraft
module inject : ["tools"]
module craft  : soundcraft / SoundCraft
tools registered: 5
  - soundcraft_run: Run SoundCraft headlessly.
  - soundcraft_commands: List or search SoundCraft's commands and their parameter grammar.
  - soundcraft_describe: Look up one SoundCraft command in full: …
  - soundcraft_inspect: Summarize an audio file or .scraft session.
  - soundcraft_convert: Convert a document between formats with `soundcraft-cli convert in out`.
systemPrompt sections: 1 artcraft:soundcraft
```

### 3. Real end-to-end headless bounce (acceptance run)

Raw CLI, exactly the argv the task specified:

```
$ crafts-bin/soundcraft-cli run --demo --cmd 'mix.volume={"track":"Kick","db":-6}' --bounce /tmp/sc.wav
mix.volume: {"tracks":1}
{"bytes":16094696,"lufs":-19.64916229248047,"path":"/tmp/sc.wav","peak_db":-5.074565887451172,"seconds":55.884,"true_peak_db":-5.050276756286621}
EXIT=0
```

The same run through the kernel's `run` tool (the code path the plugin registers) composed
that argv and exited 0:

```
exact argv     : ["/Users/zhinan/Documents/dsh_workspace/dsh-artcraft/crafts-bin/soundcraft-cli","run","--demo","--cmd","mix.volume={\"track\":\"Kick\",\"db\":-6}","--bounce","/tmp/sc-plugin.wav"]
--- run tool output ---
mix.volume: {"tracks":1}
{"bytes":16094696,"lufs":-19.64916229248047,"path":"/tmp/sc-plugin.wav","peak_db":-5.074565887451172,"seconds":55.884,"true_peak_db":-5.050276756286621}
SoundCraft exited 0 in 850ms
```

Both artifacts are 16,094,696 bytes, `RIFF (little-endian) data, WAVE audio`
(`soundcraft_inspect` reports 2 channels, 48,000 Hz, Int24, 55.884 s).

The `track` key in the acceptance example is a real selector, not a typo for `tracks`:
`mix.volume={"track":"Nonexistent","db":-6}` fails with
``soundcraft-cli: mix.volume: bad parameters for `mix.volume`: no track named `Nonexistent` ``.
On the demo session every spelling selects the same single Kick track, so
`{"track":"Kick",…}`, `{"tracks":"Kick",…}`, `{"tracks":["Kick"],…}` and `{"db":-6}` all
produced **byte-identical** output (md5 `cf657c2c9624ceb51044911bed14cc35`), while a run with
no command differed (md5 `5249e79298e2dc3b7f4d4a3a816c158b`, LUFS -19.371 vs -19.649) —
i.e. `db` is genuinely applied.

### 4. Inspect / describe / convert tools

```
$ soundcraft_inspect on /tmp/sc-plugin.wav
{"bwf": null, "channels": 2, "format": "Wav", "frames": 2682432, "sample_format": "Int24", "sample_rate": 48000, "seconds": 55.884}
SoundCraft exited 0 in 5ms
```

## Not available / caveats

- **`soundcraft_describe` cannot show parameter grammar.** The profile reads the catalog from
  `soundcraft-cli commands` with `catalogJson: false`
  (`dsh-plugins/craft-kit/src/profiles.mjs:103-104`). That table has only three columns —
  id, label, menu — and **no params column**:

  ```
  $ crafts-bin/soundcraft-cli commands | head -3
  session.new                          New...                             File
  session.open                         Open Session...                    File
  session.close                        Close Session                      File
  ```

  so every parsed command has empty `params` and the tool prints `params: (none)`:

  ```
  $ soundcraft_describe {"id":"mix.volume"}
  mix.volume  — Set Volume
  params: (none)
  ```

  The binary *does* know the grammar — but only via `describe ID`, which the kernel profile
  never calls:

  ```
  $ crafts-bin/soundcraft-cli describe mix.volume
  {"id":"mix.volume","label":"Set Volume","menu":[],"shortcut":null,"params":"{tracks?, db: -144..12 | delta_db}","enabled":false,"disabled_reason":"nothing is selected"}
  ```

  `commands --json` is not an alternative: it prints **nothing** (stdout 0 bytes, exit 0).

  This contradicts the kernel's profile in a user-visible way, so per instructions **the
  kernel was not edited**. Reported to the Lead: the fix needs either a per-craft
  "describe args" hook in `craft-kit` or the `describe` tool falling back to the CLI's own
  `describe ID` subcommand.

- **`--in` sessions were not exercised.** All runs above use `--demo`; no `.scraft` session
  file was produced or opened, so `run --in` wiring is inferred from
  `soundcraft-cli --help` only.
- **`soundcraft_convert` was not executed**; the profile lists `convert IN OUT [--bit-depth]
  [--rate] [--normalize]`, which matches the CLI help, but no conversion was run.
- Audio output is not bit-comparable across CLI versions; the md5 identities above hold only
  for SoundCraft CLI 0.6.1.

## Raw CLI help (reference)

```
soundcraft-cli info FILE                       audio file or .scraft summary
soundcraft-cli convert IN OUT [--bit-depth 16|24|32f] [--rate HZ] [--normalize]
soundcraft-cli run [--in S.scraft | --demo] [--cmd ID[=JSON]]… [--bounce OUT] [--start T --end T] [--save S.scraft] [--inspect]
soundcraft-cli script FILE [--in S | --demo] [--save S] [--bounce OUT]   (one `ID JSON` per line)
soundcraft-cli commands [FILTER]               list commands
soundcraft-cli describe ID                     one command's details
soundcraft-cli app [--port P] METHOD [JSON]     call a running app's control channel
soundcraft-cli mcp [--connect PORT] [--demo]    MCP server on stdio
soundcraft-cli parity [--write PATH]            parity report (markdown)
soundcraft-cli plugins                          list built-in plugins
```
