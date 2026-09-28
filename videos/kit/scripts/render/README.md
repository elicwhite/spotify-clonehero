# scripts/render

Rendering a film and delivering it, and the review sheets and pixel checks
used on the way. Commands below run from `videos/kit` with
`node --import tsx`; every path comes from a flag, and the flags follow the
kit's vocabulary (`--frames` a list, `--range` a range, `--from` a start
frame, `--every` a step: see [scripts/lib](../lib/README.md)).

Tools that render take the same film flags:

```
--entry <film/src/index.ts>   the Remotion entry point (the file that calls registerRoot)
--composition <id>
[--film <dir>]                the film's root (default: the working directory)
[--props <json>]              input props for the composition
[--browser <chrome>]          a Chrome or Chrome headless shell (default: Remotion's own)
```

The film is bundled once per run, with the app aliased in, into a temporary
folder that is deleted afterwards (also on Ctrl-C). Where the app is and
which public folder to serve come from the film's `productApp.config.ts`
(`src/config`), the same file its `remotion.config.ts` reads. Rendering
starts a headless Chrome and a local server, so run these outside a sandbox
that blocks either. Remotion finds its
browser in `node_modules/.remotion` of the nearest package above the
working directory.

## The film

```bash
node --import tsx scripts/render/renderFilm.ts <film flags> --out <picture.mp4> \
  [--chunks 0-749,750-1424,...] [--chunk-size <frames>] [--range <from-to>] [--scale 2] \
  [--crf 12] [--concurrency 3] [--retries 2] [--timeout-ms 300000] \
  [--offthread-cache-bytes <n>] [--work <dir>] [--resume] [--keep-chunks]
```

Renders the picture (all of it, or `--range`), muted, H.264 BT.709 limited
range, in chunks: list scene-aligned ranges with `--chunks` (they must tile
the range in order), or slice with `--chunk-size`. Each chunk renders on its
own with a long timeout, and a chunk that fails is tried again up to
`--retries` more times, so a render timeout under load costs one chunk; the
chunks are joined losslessly (concat demuxer, stream copy) and the frame
count and size checked. `--scale 2` renders every frame at twice the size
(text and the WebGL highway rasterize at twice the density) and each chunk's
encoder scales the PNG frames back down with lanczos in its BT.709
conversion, so every frame is encoded once, at the film's size, at `--crf`:
the picture is one lossy generation at any scale.

Chunks go to `--work` (default `<out>.chunks`) with a `render.json` of the
settings. The tool only ever deletes its own chunk files there, and the
folder when that empties it. `--resume` keeps the complete chunks of an
earlier run with the same settings and refuses any others; it cannot see a
code change, so use it only to finish a run that failed.

## Delivery

```bash
node --import tsx scripts/render/deliver.ts --picture <picture.mp4> --mix <mix.wav> \
  --out-dir <dir> --name <file base> [--poster <poster.mp4>] \
  [--variant web:18:same --variant 720p:24:h720 | --no-variants] [--tolerance-ms 5]
```

Writes `<name>.mp4` (the render's own encode, retagged and muxed) and one
`<name>-<suffix>.mp4` per variant. A variant is `suffix:crf:size`, the size
`same` or `h<height>` (an even height of at least 2; the width keeps the
aspect), never above the master's.
Every file:

- is tagged BT.709 (primaries, transfer, matrix, limited range) in the
  bitstream and the container. Remotion's bt709 mode sets only the matrix
  and range; players that guess show shifted or crushed blacks;
- carries the mix muxed by ffmpeg, whose MP4 edit list skips the AAC
  encoder's priming (Remotion's own mux leaves it in: audio about 43 ms
  late), with the A/V offset measured by cross-correlating the muxed audio
  against the mix;
- with `--poster` (a clip rendered with the same settings, such as one
  frame of the end card: `renderFilm.ts --range <n>-<n>`), opens on the
  poster, stream copied, so a site that previews a video by its first frame
  shows it. The film's first frame waits for its B-frames, so the poster's
  decode times move back by that delay; without it the joined stream drops a
  frame. The soundtrack starts with the film (the clip opens on negative
  film frames, which play silence).

The tool checks every output: frames = poster + film, the four colour tags,
the offset within `--tolerance-ms`, and that the muxed audio is the mix
(correlation 0.9 or more). A mix shorter than the picture is padded with
silence.

For a review clip, mux on its own:

```bash
node --import tsx scripts/render/mux.ts --picture <clip.mp4> --mix <mix.wav> --out <out.mp4> \
  [--from <film frame of the clip's first frame>] [--tolerance-ms 5]
```

## Review sheets

```bash
# Full-size stills of chosen frames, one Chrome for all
node --import tsx scripts/render/stills.ts <film flags> --frames 110,200,450 --out <dir> [--scale 2] [--concurrency 2]

# The hero frame of every composition whose id starts with a prefix (a storyboard's
# scenes): its `hero` default prop, or frame 0
node --import tsx scripts/render/stills.ts --entry <film/src/index.ts> --heroes <id prefix> --out <dir> [--scale 2]

# Every Nth frame of a range, tiled with frame numbers and times; a range of one frame works
node --import tsx scripts/render/strip.ts <film flags> --range 300-420 --out <sheet.png> \
  [--every 5] [--scale 0.5] [--cols 4] [--font monospace] [--keep <dir>] [--concurrency 2]

# A rendered clip's frames tiled, each stamped with its film frame (--from: the clip's first)
node --import tsx scripts/render/contactSheet.ts --in <clip.mp4> --out <sheet.png> \
  [--every 10] [--cols 6] [--width 480] [--from 0] [--crop w:h:x:y] [--font monospace]
```

`--font` is a fontconfig family (`monospace`, `Menlo`) or a font file.
`--keep` saves the rendered frames (named by film frame) instead of
deleting them.

## Pixel checks for refactors

```bash
# Two folders of PNG frames, file by file (dotfiles such as macOS ._ files skipped)
node --import tsx scripts/render/compareFrames.ts <before-dir> <after-dir> [--tolerance 3]

# Every Nth frame of a range against reference frames named by frame number
node --import tsx scripts/render/checkFrames.ts <film flags> --range 0-2699 [--every 15] \
  --reference <dir> --write-reference        # once, from the code you trust
node --import tsx scripts/render/checkFrames.ts <film flags> --range 0-2699 [--every 15] \
  --reference <dir> [--tolerance 3] [--keep <dir>] [--concurrency 2]
```

A sample may differ by up to the tolerance, 0-255 levels. Both tools default
to `FRAME_TOLERANCE` (compareFrames.ts), 3 levels: repeated WebGL renders of
one frame round a few pixels differently, and 3 is the noise measured on the
product highway, far below any real change. Both exit 1 on a missing or
changed frame, and when there was nothing to compare.

Unit tests: `test/render-plan.test.ts` (chunk plans, the supersampled
encode, variants, frame strides, still runs, the sting's meta and key
frames). `test/e2e-delivery.test.ts` delivers a synthetic ffmpeg picture
with a poster: frames = poster + film, A/V offset under half a
millisecond, the colour tags, the poster first, a review clip muxed from a
later frame, and a contact sheet.
