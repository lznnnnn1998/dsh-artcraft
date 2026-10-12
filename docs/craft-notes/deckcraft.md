# DeckCraft — DSH plugin notes

Verified 2026-10-13 on macOS with `crafts-bin/deckcraft-cli` (**deckcraft-cli 0.5.0**).
Every command below was run in this workspace; outputs are pasted verbatim.

| Item           | Value                                                                    |
| -------------- | ------------------------------------------------------------------------ |
| Craft id       | `deckcraft`                                                              |
| Plugin package | `dsh-plugins/plugin-deckcraft/`                                          |
| Kernel profile | `dsh-plugins/craft-kit/src/profiles.mjs:106-130` (id `deckcraft`)        |
| Binary         | `crafts-bin/deckcraft-cli` (133,102,864 bytes)                           |
| Files          | `.deckcraft`, `.pptx`                                                    |
| Tools          | `deckcraft_run`, `deckcraft_commands`, `deckcraft_describe`, `deckcraft_inspect`, `deckcraft_convert` |

## Verified

### 1. Profile, discovery and live catalog

```
$ cd dsh-plugins/plugin-deckcraft && node --input-type=module -e "…profileOf/createRuntime…"
1) profileOf(deckcraft) = {"id":"deckcraft","product":"DeckCraft","bin":"deckcraft-cli"}
2) runtime.binary() = {"path":"/Users/zhinan/Documents/dsh_workspace/dsh-artcraft/crafts-bin/deckcraft-cli","source":"search-dir:/Users/zhinan/Documents/dsh_workspace/dsh-artcraft/crafts-bin","version":"deckcraft-cli 0.5.0"}
3) runtime.catalog() origin = live | count = 226
   groups = file,window,edit,slide,section,shape,insert,chart,picture,media,arrange,text,format,design,view
   sample ids = file.new, file.open, file.openBytes, file.save, file.saveAs, file.saveTemplate, file.saveBytes, file.export
```

The catalog is rich: `commands` prints JSON by default (the profile sets
`catalogJson: true`, `dsh-plugins/craft-kit/src/profiles.mjs:128-129`), so parameter
grammar is present and `deckcraft_describe` works properly:

```
$ deckcraft_describe {"id":"slide.new"}
tool: deckcraft_describe  args: {"id":"slide.new"}
--- output ---
slide.new  — New Slide
params: {layout?: layout name or kind (title, titleAndContent, sectionHeader, twoContent, comparison, titleOnly, blank, contentWithCaption, pictureWithCaption), at?: index, title?: text, body?: text}
menu: Home ▸ Slides
shortcut: Cmd+Shift+N

Call it with `deckcraft_run`: commands: [{ "id": "slide.new", "json": { … } }]
```

```
$ deckcraft_commands {"search":"slide","limit":5}
DeckCraft command catalog (live): 44 shown 5 matching "slide"
  slide.delete  — Delete Slide
      params: {index?, ids?: [slide id]}
  slide.duplicate  — Duplicate Slide
      params: {index?}
  slide.first  — First Slide
      params: {}
  slide.fromOutline  — Slides from Outline…
      params: {text}
  slide.go  — Go to Slide
      params: {index} | {id}
binary: /Users/zhinan/Documents/dsh_workspace/dsh-artcraft/crafts-bin/deckcraft-cli deckcraft-cli 0.5.0
```

### 2. The plugin package loads through tsx and registers its tools

```
module name   : dsh-artcraft-deckcraft
module inject : ["tools"]
module craft  : deckcraft / DeckCraft
tools registered: 5
  - deckcraft_run: Run DeckCraft headlessly.
  - deckcraft_commands: List or search DeckCraft's commands and their parameter grammar.
  - deckcraft_describe: Look up one DeckCraft command in full: …
  - deckcraft_inspect: Summarize a deck: slide count, layouts, sizes.
  - deckcraft_convert: Convert a document between formats with `deckcraft-cli convert in out`.
systemPrompt sections: 1 artcraft:deckcraft
```

### 3. Real end-to-end headless run (acceptance run)

Driven through the kernel's `run` tool with a real `slide.*` command id:

```
exact argv     : ["/Users/zhinan/Documents/dsh_workspace/dsh-artcraft/crafts-bin/deckcraft-cli","run","--sample","--cmd","slide.new={\"title\":\"DSH Acceptance\",\"body\":\"driven through the DSH plugin\"}","--save","/tmp/d-plugin.deckcraft"]
--- run tool output ---
DeckCraft exited 0 in 6ms
```

Artifact: `/tmp/d-plugin.deckcraft`, 7,515 bytes, a zip with mimetype
`application/vnd.storyteller.deckcraft+zip` (`file` output: *Zip data (MIME type
"application/vnd.storyteller.deckcraft+zip?")*).

The same command line run directly against the binary also exits 0 and writes 7,494 bytes
(`slide.new={"title":"DSH Acceptance"}` only). Note that a successful DeckCraft run prints
**nothing** to stdout — the only tool-visible signal is the exit line — so the artifact, not
the log, is the result.

### 4. Inspect and export tools

```
$ deckcraft_inspect {"file":"/tmp/d-plugin.deckcraft"}
{"dirty": false, "fonts": {"major":"Inter","minor":"Inter"}, "layouts": [{"id":12,"name":"Title Slide"},{"id":18,"name":"Title and Content"},{"id":24,"name":"Section Header"},{"id":31,"name":"Two Content"}, …],
 "theme": "DeckCraft", "title": "d-plugin", "undo": null}
DeckCraft exited 0 in 5ms
```

(The middle of the JSON — per-slide details — is elided here; the `…` is not part of the
tool output.)

`export` maps to `--export` (`dsh-plugins/craft-kit/src/profiles.mjs:121`) and really renders:

```
$ rm -f /tmp/d-export.pdf
$ crafts-bin/deckcraft-cli run --sample --cmd 'slide.new={"title":"DSH Export"}' --save /tmp/d-export.deckcraft --export /tmp/d-export.pdf
EXIT=0
/tmp/d-export.pdf: PDF document, version 1.7, 9 pages   (1,079,845 bytes)
```

## Not available / caveats

- **No `.pptx` round trip was exercised.** The profile lists `.pptx` as a DeckCraft
  extension, but only native `.deckcraft` files were written and only `--export` (PDF) was
  rendered. `deckcraft_convert` was not executed.
- **`run --in FILE` was not exercised**; both runs used `--sample`.
- The sample deck already contains 9 slides, so "9 pages" above is the sample's slide count,
  not proof that `slide.new` appended a page that the PDF export re-rendered.
- `soundcraft` (the other craft in this batch) has a catalog-parameter caveat caused by its
  table-only `commands` output; DeckCraft is **not** affected — its catalog carries params.

## Raw CLI help (reference)

```
usage: deckcraft-cli info FILE
       deckcraft-cli render (FILE | --sample) [--slide N | --all] [--scale S] [--edit] OUT
       deckcraft-cli convert IN OUT
       deckcraft-cli run [--in FILE | --sample] [--cmd ID[=JSON]]... [--save OUT] [--export OUT] [--print]
       deckcraft-cli commands [FILTER]
       deckcraft-cli describe COMMAND
       deckcraft-cli app [--port PORT] COMMAND [JSON] | --method METHOD [JSON]
       deckcraft-cli mcp [--connect PORT] [--sample]
       deckcraft-cli links | --version
```
