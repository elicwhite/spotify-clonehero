# Product videos

Launch and feature videos for Music Charts Tools, made with
[Remotion](https://www.remotion.dev) from one shared kit. A film is a
workspace package in `films/` that composes the kit's tested blocks: the
product's real highway, recordings of the running app, kinetic type and
light, all cut to the music.

```
videos/
  kit/        @musiccharts/video-kit: blocks (src/), Node tools (scripts/),
              the Blender logo sting (blender/), and the template (template/):
              the example film assembled from the blocks, which new-film copies
  gallery/    the blocks one by one, one composition each, and the smoke checks
  films/      one package per film (pnpm new-film)
```

## Quickstart

```sh
cd videos
pnpm install                                  # the workspace; each package links the shared browser
pnpm browser                                  # once per checkout: the headless Chrome (see Machine gotchas)
pnpm new-film --name my-film --title "My Product"
pnpm install                                  # links the new film into the workspace
cd films/my-film
pnpm studio                                   # the film, and each scene on its own
pnpm still --frame=150                        # one frame to out/still.png
pnpm pacing                                   # the reading-time audit
pnpm render                                   # the picture, muted and chunked, to out/picture.mp4
```

The new film renders straight away: its timeline is a 120 BPM tempo bed, so
it needs no song material. Its `README.md` lists every command, and the
pipeline below replaces each placeholder in turn. From `videos/`,
`pnpm gallery` opens every block (see [gallery](gallery/README.md)),
`pnpm typecheck` checks every package and `pnpm test` runs the kit's tests.
Once a film imports its generated timeline (step 1), it typechecks only
with its gitignored `public/generated/` in place, so in a fresh checkout
`pnpm typecheck` needs each such film's soundtrack built first.

## The pipeline, in order

The commands below run in the film's folder, where `$KIT` is
`node_modules/@musiccharts/video-kit` and every path is the film's own.
The same tools also run from `videos/` as `node --import tsx
kit/scripts/<path>`.

### 1. Music: the timeline

Everything in a film is timed from `timeline.json` (the contract in
[music](kit/src/music/README.md)): beats and bars, the edit's segments, the
chart's notes and hits, sung timing, and the credits (`meta`).

- **A song.** `buildSoundtrack` cuts the film's soundtrack from a chart
  folder and its stems, and writes the timeline beside it:

  ```sh
  node --import tsx $KIT/scripts/audio/soundtrack.ts --config src/soundtrack.config.ts \
    --chart <chart folder> --out public/generated
  ```

  The config (`SoundtrackConfig`) holds the film's length and fps, the
  stems, the song-bar ranges laid end to end (they must add up to the
  film's length to within a frame), splice crossfades, gain lanes (ramps and mutes on video bars and beats),
  an optional reverb ring-out, edge fades and the loudness target. It writes
  `timeline.json`, `peaks.json`, `envelopes.json`, `audio/mix.wav` and
  `audio/stems/<stem>.wav`. See [scripts/audio](kit/scripts/audio/README.md).

- **A music bed.** `loopBed.ts` arranges loops on a beat grid, and the film
  builds its timeline from the tempo with
  `tempoTimeline({bpm, beatsPerBar, durationSec, fps, meta})`:

  ```sh
  node --import tsx $KIT/scripts/audio/loopBed.ts --arrangement <file> \
    --library <loop folder> --out public/generated/audio/bed.wav
  ```

The film's music lives in one module, `src/music.ts`. The storyboard, the
cues, the pacing sheet and the Node tools all import it when they load, so
the timeline is a value, not a file fetched at render time. Until the film
has a soundtrack, `music.ts` exports a `tempoTimeline(...)` (the template's
120 BPM bed) and no files. After the build it imports the generated JSON,
checks it against the contract, and names the soundtrack's files by their
paths in `public/`:

```ts
// src/music.ts
import generated from '../public/generated/timeline.json';
import {assertTimeline} from '@musiccharts/video-kit/music';

export const timeline = assertTimeline(
  generated,
  'public/generated/timeline.json',
);

export const soundtrack: Soundtrack = {
  mix: 'generated/audio/mix.wav',
  peaks: 'generated/peaks.json',
  envelopes: 'generated/envelopes.json',
};
```

`src/Film.tsx` wraps the film and every scene preview in the same `Music`
provider, so a scene renders the same in both, `envelopeAt` included. The
film plays the mix from its `FilmClock`, and a preview from its
`SceneWindow`:

```tsx
const Music: React.FC<{children: ReactNode}> = ({children}) => (
  <TimelineProvider
    timeline={timeline}
    peaks={soundtrack.peaks}
    envelopes={soundtrack.envelopes}>
    {children}
  </TimelineProvider>
);

export const Film = () => (
  <Music>
    <FilmClock src={soundtrack.mix}>...every scene...</FilmClock>
  </Music>
);

export const ScenePreview = ({id}) => (
  <Music>
    <SceneWindow {...board.window(id)} audio={soundtrack.mix}>
      ...
    </SceneWindow>
  </Music>
);
```

A film then needs its `public/generated/` to typecheck and bundle, so a
fresh checkout runs the soundtrack build first. The provider's other form,
`src="generated/timeline.json"`, fetches the file while the frame waits. It
suits a composition that reads musical time only inside its components,
with nothing computed from the timeline at module load, and that must
still bundle before the file exists. A gallery block or a QA composition is
the typical case: a missing file then fails only that render, naming the
command that writes it (`writtenBy`). A film's storyboard and pacing sheet
are computed at load, so a film imports the timeline.

### 2. Storyboard on bars

`src/storyboard.ts` lists the scenes in film frames with the bar each
starts on (`defineStoryboard`, in [clock](kit/src/clock/README.md)). The
template's film fails to render when a scene drifts off its bar
(`checkStoryboard`). A one-take film derives its scene starts from their
durations (`oneTake`) instead of typing them.

### 3. Cues from beats and hits

`src/cues.ts` turns musical positions into frames, once:
`board.sceneBeat(tl.frameOfBeat, id)(bar, beat)` counts from a scene's
first downbeat, `tl.hitFrames.kick` and `tl.drumFrames({kit: 'crash'})` give
the hits, `snapToEvent` moves a grid cue onto the hit the band plays near
it, and `stopFrames`, `tuttiFrames` and `syllableFrames` find the rest.
Scenes, the pacing sheet and the sound design all read these frames.

### 4. Scenes from kit blocks

A scene is a component in a `<SceneWindow>` that draws from
`useGlobalFrame()` and its cues with the blocks in the catalog below:
`KineticText` and `ChapterSlate` for copy, `fx` for light, `camera` for
moves on a tilted plane, `BrandStage` behind everything and `EndCard` at
the end.

### 5. Product footage

- **The highway.** `ProductHighway` is the app's own three.js renderer,
  drawn every frame at the film's song time (from the timeline's segments).
  Link the chart, and the film reads it with
  `useChartFolder({dir: 'generated/highway'})` (`--test-chart` writes the
  kit's invented test chart instead):

  ```sh
  node --import tsx $KIT/scripts/highway/link-chart.ts --chart <chart folder> \
    --out public/generated/highway
  ```

  Set it into a shot with `HighwayCrop`, `LaneBleed`, `Iris` and
  `GlassRim`. `HighwaySmoke` fails a render that draws black or out of
  time. See [highway](kit/src/highway/README.md).

- **The running app.** `$KIT/scripts/recorder/record.mjs` records any web
  page frame by frame under a virtual clock, on the film's clock
  (`--timeline` and `--storyboard` place a take in its scene), into
  `public/generated/rec`; `apps/chart-editor/record.mjs` does the same for
  the chart editor. `RecordedLayer` plays a take back frame-accurately, and
  `assertTakeMatchesEdit` refuses a take recorded for another edit of the
  music. See [recorder](kit/src/recorder/README.md) and
  [scripts/recorder](kit/scripts/recorder/README.md).

### 6. Sound effects from cues

`sfx.ts` synthesizes every effect (no third-party samples) at its cue frame
over the music and brings the whole to the loudness target. The cue list is
`{frame, kind, pan?, gain?}`, built from the same cue frames as the
picture, in a module that also exports the film's frame rate
(`export const fps = FORMAT.fps;`), so the command never types one:

```sh
node --import tsx $KIT/scripts/audio/sfx.ts --cues src/sfx.ts \
  --bed <music.wav> --out public/generated/audio/mix.wav
```

The logo sting is optional: `write-brand-json.ts`, then
`blender/stingEvents.ts`, Blender's `logo_sting.py` and `LogoSting` (see
[blender](kit/blender/README.md)).

### 7. Render

`renderFilm.ts` (the template's `pnpm render`) bundles once and renders the
picture muted in chunks (`--chunks` or `--chunk-size`), each with a long
timeout and retries (`--retries 2` by default: three attempts in all), then
joins them losslessly. `--resume` reuses finished chunks, and refuses any
rendered with other settings. `--scale 2` supersamples (text and the WebGL
highway rasterize at twice the density) and scales back with lanczos. See
[scripts/render](kit/scripts/render/README.md).

```sh
node --import tsx $KIT/scripts/render/renderFilm.ts --entry src/index.ts \
  --composition Film --out out/picture.mp4 [--chunk-size 600] [--scale 2] [--resume]
```

### 8. Delivery

`deliver.ts` makes the master and its web and 720p variants: the soundtrack
muxed with the AAC encoder delay trimmed, BT.709 limited range tagged in the
bitstream and the container, the poster clip (the end card, rendered by
`renderFilm.ts` with the same settings) first, and every file's A/V offset
measured. A file whose audio does not match the mix fails, and a mix shorter
than the picture is padded with silence. `mux.ts` does the same for a
review clip.

```sh
node --import tsx $KIT/scripts/render/deliver.ts --picture out/picture.mp4 \
  --mix public/generated/audio/mix.wav --out-dir out/final --name <name> [--poster out/poster.mp4]
```

### 9. QA

| Check                                     | Tool                                                                                                                                                                     |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Every line is read, and nothing drags     | `$KIT/scripts/qa/pacingAudit.ts --sheet src/pacing.ts` (the template's `pnpm pacing`)                                                                                    |
| The picture never freezes                 | `$KIT/scripts/qa/motionAudit.ts --in <film.mp4>`                                                                                                                         |
| A take is the take the film needs         | `$KIT/scripts/recorder/compare-takes.mjs <take> <twin>` (see the take rule)                                                                                              |
| The highway plays every note on its frame | `$KIT/scripts/qa/highwaySync.ts --timeline <timeline.json> --chart <folder>`                                                                                             |
| A refactor changed nothing                | `$KIT/scripts/render/checkFrames.ts` (`--write-reference` first, from the code you trust) or `compareFrames.ts <before> <after>`                                         |
| Review by eye                             | `stills.ts` (chosen frames, or `--heroes <id prefix>`: every matching composition at its `hero` default prop), `strip.ts` and `contactSheet.ts` in `$KIT/scripts/render` |

See [scripts/qa](kit/scripts/qa/README.md).

## The kit's blocks

Import each area by its subpath (`@musiccharts/video-kit/<area>`). Each
area's README has the full API and its rules.

| Area                                   | Blocks                                                                                                                                                                                                                  | What for                                                                                                         |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| [format](kit/src/format/README.md)     | `useFormat` (fps, size, `unit`, the title-safe box), `formatOf`, `toSec`, `toFrames`                                                                                                                                    | The composition's format; sizes written for a 1080 short side scale by `unit`                                    |
| [load](kit/src/load/README.md)         | `publicUrl`, `useLoaded`, `loadJson`, `fetchFile`                                                                                                                                                                       | Files named by their path in `public/`, loaded while Remotion waits                                              |
| [clock](kit/src/clock/README.md)       | `FilmClock`, `SceneWindow`, `useGlobalFrame`, `useScene`, `TimeShift`, `defineStoryboard`, `oneTake`, `snapToEvent`, `useHitPulse`, event helpers                                                                       | Film time across scenes and previews, storyboards on bars, cues and pulses                                       |
| [music](kit/src/music/README.md)       | `TimelineProvider`, `useTimeline`, `makeTimeline`, `tempoTimeline`, `beatGrid`, `songTimeAt`, the timeline contract                                                                                                     | Musical time: bars and beats, hits, envelopes, song time through the edit                                        |
| [motion](kit/src/motion/README.md)     | easings and `glide`, springs and `settle`, `keyed`/`kf`, `wave`, `staggerIndex`, seeded random, colour, `Rect`, `quadToQuadMatrix3d`                                                                                    | Pure motion math, exact at any fractional frame, with no brand in it                                             |
| [camera](kit/src/camera/README.md)     | `Pose`, `PlaneView`/`PlaneShot`, `makePath`, `orbit`, `cameraBlur`, `project`, `placeOnPlane`                                                                                                                           | One plane camera: a pose pins a plane point to the screen; paths, a slow orbit, overlays that land on the plane  |
| [text](kit/src/text/README.md)         | `KineticText` with its presets, `textStyle`, `useFontsReady`, `measureWidth`, `breakLines`, `useFitLineSize`, `PIXEL_STABLE_LINE_HEIGHT`                                                                                | Kinetic type: measured, balanced, fitted to the safe width, split into words or characters                       |
| [brand](kit/src/brand/README.md)       | tokens, `ease`, `useLayout`, `BrandMark`, `Wordmark`, service and instrument marks, `Gem`, `BrandStage`, `EndCard`, `LogoSting`, `brandJson`                                                                            | The brand as data and its pieces: easing and spring presets, the safe layout, the stage, the end card, the sting |
| [fx](kit/src/fx/README.md)             | `Grain`, `Vignette`, `Glow`, `Flash`, `Shockwave`, `SparkBurst`, `LightSweep`, `ChromaSplit`, `CameraShake`, `MotionBlur`, `SampledMotionBlur`, `WhipFilter`, `Pop`, `GlassPlane`, `Bokeh`, `SideShade`, `DepthOfField` | Light, lens and motion effects                                                                                   |
| [ui](kit/src/ui/README.md)             | `Cursor`, `ClickRing`, `Callout`/`Leader`, `Chip`, `Eyebrow`, `ChapterSlate`, `Playhead`, `BeatMarker`, `Waveform`                                                                                                      | On-screen UI pieces, every timing a film frame                                                                   |
| [highway](kit/src/highway/README.md)   | `ProductHighway`, `WarpedHighway`, `HighwayCrop`, `LaneBleed`, `Iris`, `GlassRim`, `useSplitHighway`, `useChartFolder`, `HighwaySmoke`, chart edits                                                                     | The product's own highway, framed and composited from outside                                                    |
| [recorder](kit/src/recorder/README.md) | `RecordedLayer`, `useRecording`, `loadRecording`, `assertTakeMatchesEdit`, `recordedCursorPath`                                                                                                                         | Recordings of the running app, played on the film clock                                                          |
| [config](kit/src/config/README.md)     | `withProductApp`, `loadProductAppOptions`, `productAppWebpack`, `productAppPaths`                                                                                                                                       | Bundling a film with the app's own sources, from the film's `productApp.config.ts`                               |

Node tools, each run as `node --import tsx kit/scripts/<path>` from
`videos/` (or `$KIT/scripts/<path>` from a film's folder), with every path
on its command line:

| Folder                                             | Tools                                                                                                                     |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| [scripts/audio](kit/scripts/audio/README.md)       | `soundtrack.ts` (buildSoundtrack), `loopBed.ts`, `sfx.ts`                                                                 |
| [scripts/render](kit/scripts/render/README.md)     | `renderFilm.ts`, `deliver.ts`, `mux.ts`, `stills.ts`, `strip.ts`, `contactSheet.ts`, `checkFrames.ts`, `compareFrames.ts` |
| [scripts/qa](kit/scripts/qa/README.md)             | `pacingAudit.ts`, `motionAudit.ts`, `highwaySync.ts`                                                                      |
| [scripts/recorder](kit/scripts/recorder/README.md) | `record.mjs`, `apps/chart-editor/record.mjs`, `selftest.mjs`, `compare-takes.mjs`                                         |
| [blender](kit/blender/README.md)                   | `stingEvents.ts`, `logo_sting.py`, `preview.ts`                                                                           |
| `scripts/`                                         | `new-film.ts`, `link-browser.mjs`, `brand/write-brand-json.ts`, `highway/link-chart.ts`                                   |

## Conventions every area follows

- **Units.**
  - Time points (`at`, `from`, `start`, `enterAt`, `exitAt`) are film
    frames.
  - Durations passed to a component are frames, as in Remotion's own API.
  - Presets, tokens and library defaults are written in seconds and
    converted with the composition's fps.
  - Tolerances in the music API are seconds.
  - A value that breaks these carries a `Sec` suffix (`decaySec`).
- **Paths.** Every kit API names a file by its path relative to `public/`
  (`generated/timeline.json`). `publicUrl` in [load](kit/src/load/README.md)
  is the one place such a path becomes a URL.
- **Dependencies point one way.** `motion` is pure math and imports nothing
  from the brand or the app; `brand` builds its easing and spring presets on
  motion, and its tokens are data any area may read. `music` never imports
  `clock`; the clock's pulses read the music.

## The rules

- **Real product only.** The highway is the app's own renderer and app UI
  is a recording of the running app. Neither is redrawn.
- **Every frame is a pure function of the global film frame.** No wall
  clock, no `Math.random`, no scene-local state for motion that crosses a
  cut. A scene renders the same in the film and in its own preview.
- **Format from the composition.** Frame rate and size come from
  `useVideoConfig` through `useFormat`; sizes are reference px times `unit`,
  and layout stays inside the title-safe box (`useLayout`).
- **Song material stays out of git.** Audio, charts, timelines, recordings
  and lyrics are generated into a film's gitignored `public/generated/`. No
  real song, artist or charter name appears in a committed file; examples
  and tests use invented names.
- **Only the product renders lyrics.** A film shows sung words only through
  the product's own highway or a recording of the app; the timeline carries
  syllable timing, never text.
- **Credits name the music, not the chart.** `EndCard`'s credit reads
  "Music: title by artist" from the timeline's `meta`.
- **Read, then look.** Copy is paced so every line is read before anything
  else happens. The rules, and the only place they are written, are
  [`PACING_RULES`](kit/scripts/qa/pacing.ts); `pacingAudit.ts` checks a
  film against them.
- **Takes land in pairs.** Land a recorded take only when a second take of
  the same spec (or the take it replaces) is byte-identical on every
  component the film uses, manifest included (`compare-takes.mjs`). Chrome's
  anti-aliasing can change under GPU load: now and then one frame differs
  from its twin by a few pixels, and the encoder carries the difference to
  the end of its group of frames.
- **Scripts take every path on the command line.** Nothing hard-codes a
  machine path.

## Machine gotchas

- **The headless browser.** Remotion looks for its Chrome in the nearest
  package's `node_modules/.remotion`; every package here links that folder
  to the shared `videos/node_modules/.remotion` when it installs
  (`kit/scripts/link-browser.mjs`). Get the browser once with
  `pnpm browser` (`remotion browser ensure`, run in the kit). Where Remotion's
  downloader can't reach the network, copy a `chrome-headless-shell` folder
  from another Remotion checkout into `videos/node_modules/.remotion/`.
- **Sandboxed shells.** Chrome (Studio, stills, renders, recordings) binds
  local ports and Blender needs the GPU, so in a sandboxed agent shell they
  run with the sandbox disabled.
- **Temp folders.** Remotion's Studio and CLI leave about 35 MB of
  `remotion-webpack-bundle-*` folders in the system temp dir per bundle;
  clear them now and then. The kit's scripts delete their own.
- **Bundle into a fresh folder.** Bundling twice into one folder fails
  (EEXIST) when the public dir holds a symlink, which every film's does
  (`public/product`).
- **Renders under load.** A busy machine times renders out: render in
  chunks with a long timeout and retries (`renderFilm.ts` does all three).
- **Muxing.** Remotion's own MP4 mux plays the AAC audio about 43 ms late
  (the encoder's priming is never trimmed). Render muted and mux with
  `deliver.ts` or `mux.ts`, which trim it and measure the result.
