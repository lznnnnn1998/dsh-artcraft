# Live preview: the shared state contract

Three deliverables share one thing: a render of the document as it is right now. To keep them
from inventing three formats, everything goes through the state directory and JSON below.

| Layer | What it is | Where it lives |
|---|---|---|
| **A** | A render after every mutating call, returned as an image block so the transcript shows the step | the craft tool result |
| **B** | A local panel that watches the state and shows steps, current render, filmstrip, video timeline | `scripts/preview/` + `http://127.0.0.1:4177` |
| **C** | A DSH client plugin that embeds the same panel inside the GUI | `dsh-plugins/preview-panel/` |

## Directory

```
$DSH_HOME/artcraft/preview/           # default: ~/.dsh/artcraft/preview
  index.json                          # every craft the agent has touched this session
  <craft>/
    state.json
    step-001.png                      # full-size render of that step
    step-002.png
    thumb-001.png                     # ≤ 320 px wide, for the filmstrip
```

`DSH_ARTCRAFT_PREVIEW_DIR` overrides the root. One writer per craft keeps the directory free of
cross-craft races.

## `index.json`

```json
{
  "updatedAt": "2026-11-03T22:40:12.000Z",
  "crafts": {
    "wordcraft": { "file": "/tmp/report.docx", "pages": 1, "stepCount": 4, "updatedAt": "…" },
    "deckcraft": { "file": "/tmp/story.deckcraft", "pages": 3, "stepCount": 2, "updatedAt": "…" }
  }
}
```

## `<craft>/state.json`

```json
{
  "craft": "wordcraft",
  "product": "WordCraft",
  "file": "/tmp/report.docx",
  "pages": 1,
  "updatedAt": "2026-11-03T22:40:12.000Z",
  "current": 4,
  "steps": [
    {
      "n": 4,
      "at": "2026-11-03T22:40:12.000Z",
      "tool": "run",
      "title": "WordCraft · 1 command",
      "summary": "insert.chart → report.docx · exit 0 · 191 ms",
      "image": "step-004.png",
      "thumb": "thumb-004.png",
      "width": 918,
      "height": 1188,
      "durationMs": 191
    }
  ]
}
```

- `steps` is append-only for the session; the panel shows the last `current` as the big render.
- `image`/`thumb` are relative to `<craft>/`. Both may be absent when a craft cannot render
  (SoundCraft has no visual; GridCraft renders only through a converter), and the panel then shows
  the step as text.
- `timeline` belongs to the DOCUMENT, not to a step: time-based crafts (FilmCraft, EffectCraft,
  SoundCraft) put it at the top level of `state.json` as
  `[{ "start": 0, "duration": 3.2, "label": "clip 1" }]`. A step's `timeline` is not part of the
  contract — `/state` merges a step-level value up if a writer emits one, so both shapes read.

## HTTP endpoints (layer B)

| Route | Meaning |
|---|---|
| `GET /` | the panel page (HTML, no build step) |
| `GET /state` | `index.json` plus every craft's `state.json`, merged |
| `GET /events` | server-sent events; an event on every state change |
| `GET /img/<craft>/<file>` | a render or thumbnail |

The server binds `127.0.0.1` only, serves a read-only view of the preview directory, and takes no
input from the network — so it is safe to leave running while an agent works.

## Render recipes

The kernel owns these; a craft with no recipe writes a state entry without an image.

| Craft | Recipe | Verified |
|---|---|---|
| WordCraft | `render FILE OUT --page 1 --scale S` | yes, wrote a 31 KB PNG |
| DeckCraft | `render FILE --slide 0 --scale S OUT` | yes, wrote a 24 KB PNG (1440×810) |
| CADCraft | `convert FILE OUT.png` | yes, 29 KB |
| FigCraft | `convert FILE OUT.png` | syntax verified |
| VectorCraft | `run FILE --export OUT.png` | syntax verified |
| PhotoCraft | `convert FILE OUT.png` | syntax verified |
| TextureCraft | `render FILE OUT --view 2d` | syntax verified |
| EffectCraft | `render-frame --time 0 --out OUT.png` | syntax verified |
| LightCraft | `render FILE -o OUT` | syntax verified |
| PdfCraft | MCP `page_render` (no CLI render verb) | not wired yet |
| DesignCraft | `file.exportPdf`, then PdfCraft `page_render` | not wired yet |
| FilmCraft | `file.exportFrame` through its MCP server | not wired yet |
| GridCraft | no PNG verb (`convert` writes pdf/csv/html) | state-only for now |
| SoundCraft | no image | state-only |

## Configuration

`CraftPluginConfig` gains:

```ts
preview?: 'auto' | 'off'   // default 'auto': render after a call that wrote a document
previewDir?: string        // override the directory
previewScale?: number      // render scale, default 1.5
```

`auto` renders only when the call produced or modified a document (a `save`/`export`/`input`
argument), so a read like `commands` costs nothing.
