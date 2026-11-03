# Live preview panel — layer B

A dependency-free, read-only HTTP view of the ArtCraft preview state directory.
The state format and routes are defined in [`docs/PREVIEW.md`](../../docs/PREVIEW.md);
this directory consumes that contract, it does not own it.

```
index.json + <craft>/state.json + renders
        │
        ├── GET /              panel.html (self-contained)
        ├── GET /state         merged index + per-craft state
        ├── GET /events        SSE, an event whenever state changes
        └── GET /img/<craft>/<file>
```

## Run

```sh
# real agent output, default ~/.dsh/artcraft/preview on port 4177
node scripts/preview/server.mjs --open

# or point it at any preview root
node scripts/preview/server.mjs --dir /path/to/preview --port 4177 --open
```

`--open` prints the URL; it never launches a browser. `DSH_ARTCRAFT_PREVIEW_DIR`
sets the default root (a `--dir` flag wins), and `--port 0` picks a free port.
The server binds `127.0.0.1` only and has no write path.

## Test without an agent

```sh
node scripts/preview/fixture.mjs                      # writes /tmp/artcraft-preview-fixture
node scripts/preview/server.mjs --dir /tmp/artcraft-preview-fixture --open
```

The fixture crops the report page out of `docs/screenshots/live-preview-panel.png`
and resizes it into the contract's `step-NNN.png` / `thumb-NNN.png` pairs, adds
synthetic DeckCraft slides and FilmCraft frames, a FilmCraft timeline, and a
text-only SoundCraft entry. `--out DIR` changes the target; `--quiet` suppresses
the summary.

## Merged `/state` shape

`/state` returns the index plus each craft: any craft directory with a
`state.json` is included even if absent from `index.json`. Each craft is the
index entry overlaid with its full state, plus derived URLs:

```json
{
  "version": 1,
  "previewDir": "/Users/me/.dsh/artcraft/preview",
  "rootExists": true,
  "updatedAt": "2026-11-03T22:40:12.000Z",
  "crafts": {
    "wordcraft": {
      "craft": "wordcraft", "product": "WordCraft", "file": "/tmp/report.docx",
      "pages": 1, "current": 4, "stepCount": 4, "updatedAt": "…",
      "timeline": null,
      "steps": [
        {
          "n": 4, "title": "WordCraft · 1 command", "tool": "run", "summary": "…",
          "image": "step-004.png", "thumb": "thumb-004.png",
          "imageUrl": "/img/wordcraft/step-004.png",
          "thumbUrl": "/img/wordcraft/thumb-004.png",
          "width": 918, "height": 1188, "durationMs": 191
        }
      ]
    }
  },
  "warnings": []
}
```

`timeline` is accepted on the craft (`state.json`) or, for compatibility with
the craft-kit writer, on the current/last step; both are normalized to the craft
level. An optional per-clip `status` (`"rendering"`, `"error"`) is tolerated by
the panel although the contract only names `start`/`duration`/`label`.

## Behaviour notes

- The panel follows the newest-updated craft by default; the header tabs switch
  crafts. Steps are shown for the selected craft (the contract keeps one
  `state.json` per craft, unlike the static mock, which mixes crafts in one list).
- Clicking a step or filmstrip thumb pins that render; "back to latest" returns
  to following `current` as the agent appends steps.
- Thumbnails are optional: the filmstrip falls back to the full render, then to a
  `step N` label. A step without any image gets the text-only state.
- The video block appears only when a craft has a non-empty timeline.
- SSE changes are debounced by 80 ms so one `writeFileSync` does not produce
  several panel refreshes. Heartbeats keep idle streams alive.
- Loopback origins on other ports (the layer C GUI) get CORS on `/state` so it
  can poll; non-loopback origins are refused. Images are served
  `Cross-Origin-Resource-Policy: cross-origin` for the same reason.
- Image requests are resolved with `realpath` and prefix checks, so neither
  `..` segments nor symlinks can escape the preview root.
