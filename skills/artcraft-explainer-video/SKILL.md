---
name: artcraft-explainer-video
description: "Use when a slide deck should become a video — a narrated explainer, a product walkthrough, or a silent loop. DeckCraft for the slides, its renderer for frames, FilmCraft for the sequence and the export, SoundCraft for the audio bed."
---

# Deck to explainer video

Slides are already a storyboard. Turn each slide into a frame, put the frames on a timeline, add
an audio bed, and export a real video file — without a screen recorder and without manual
screenshotting.

## The chain

```
DeckCraft            →  rendered frames     →  FilmCraft                →  FilmCraft export
slides + notes          one PNG per slide       sequence, timing, titles    MP4 / MOV
                                                (+ SoundCraft audio bed)
```

## Verified steps

**1. Build the deck.** One slide per beat; keep to 16:9 and a consistent body size, because the
frame is what the viewer sees.

```text
deckcraft_run   {"commands": [{"id": "file.new", "json": {}},
                              {"id": "slide.new", "json": {"layout": "titleAndContent"}}],
                 "save": "story.deckcraft"}
deckcraft_inspect {"file": "story.deckcraft"}     # slide count, sizes, text
```

**2. Render the frames.** `file.render` takes a slide index and returns the PNG (base64) plus its
pixel size; `file.export` writes files by extension.

```text
deckcraft_run {"input": "story.deckcraft", "commands": [{"id": "file.render", "json": {"slide": 1, "scale": 2}}]}
deckcraft_run {"input": "story.deckcraft", "commands": [{"id": "file.export", "json": {"path": "frames/", "format": "png"}}]}
```

Verified: `file.render` exists with `{slide, scale, edit, transparentBackground}` and answers
`{png: base64, width, height}`; `file.export` accepts `png|jpeg|pptx|pdf|gif`. Render at `scale: 2`
for 1080p delivery from a 960×540 slide.

**3. Put the frames on a FilmCraft timeline.** `file.importImageSequence` takes a numbered folder.

```text
filmcraft_run {"commands": [
  {"id": "file.importImageSequence", "json": {"path": "frames/"}},
  {"id": "file.exportMedia", "json": {"path": "explainer.mp4", "preset": "H.264 YouTube 1080p"}}],
  "save": "explainer.fcproj"}
```

Verified command ids: `file.importImageSequence {path, bin?}`, `file.exportMedia {path, preset?, …}`,
plus `file.exportFrame` for a poster still.

**4. Audio (optional).** SoundCraft bounces a WAV/AIFF bed; import it into the sequence as media.
Keep the narration and the slide timing independent — retiming a slide should not re-cut the voice.

**5. Verify before delivering.** `filmcraft_inspect` reports the sequence: duration, tracks, media
and any missing (offline) files. Then render a frame from the middle and `read_image` it: a
sequence of blank frames is the classic silent failure (wrong path, wrong numbering).

## What to check, concretely

- **Frame numbering.** Image sequences need contiguous numbers (`frame_0001.png`). A gap starts the
  clip late or drops the tail.
- **Frame size mismatch.** Mixed sizes make the exporter letterbox or scale; render every slide at
  the same width and height.
- **Duration.** `frames × 1/fps`; a 24-slide deck at 5 s a slide is two minutes, not ten seconds.
  Set the still duration rather than relying on a default.
- **Offline media** shows as coloured bars in the render, not as an error — `inspect` names them.

## Boundaries

DeckCraft and FilmCraft must be installed. This is an editing pipeline, not a recorder: it does not
capture a live desktop, and it exports what the timeline contains. For motion design inside a
single comp, EffectCraft renders the frames instead of DeckCraft.
