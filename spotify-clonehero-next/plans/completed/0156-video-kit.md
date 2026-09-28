# 0156 — Video kit

A shared library for making the product's launch and feature videos, so the
next film starts from tested building blocks instead of from a copy of the
last one. It is extracted from two films made in parallel: the `/chart-editor`
launch film (branch `claude/chart-editor-showreel-video-5a554b`, `video/`) and
the Find Music launch film (branch `claude/music-charts-showreel-video-417ba0`,
`showreel/`, not committed). Neither film moves in this plan; each can adopt
the kit later.

## Layout

```
videos/
  README.md            making a product video: quickstart, pipeline, rules
  package.json         pnpm workspace root: typecheck, test, gallery scripts
  pnpm-workspace.yaml  packages kit, gallery, films/*; one version catalog;
                       the app's 7-day minimum release age
  tsconfig.base.json
  kit/                 @musiccharts/video-kit, TypeScript consumed as source
    src/<area>/        React and pure modules, one README per area
    scripts/<area>/    Node tools, run with `node --import tsx`
    blender/           the brand logo sting
    template/          the example film assembled from the blocks (a tempo
                       bed, a storyboard on bars, a title and an end card);
                       `new-film` copies it into videos/films/<name>
    test/              node:test unit tests for the pure modules
  gallery/             a Remotion project: the blocks one by one, one
                       composition each, and the smoke checks
  films/               future films, one workspace package each
```

A film imports areas by subpath (`@musiccharts/video-kit/text`). Its
`productApp.config.ts` is the one place that says where the app is
(`appRoot`). The film's `remotion.config.ts` passes it to the kit's
`withProductApp(Config, productApp)`, and the kit's Node scripts read the
same module (`loadProductAppOptions`). A film always serves its own
`public/`, where the kit's `generated/` and `product/` paths live. That
helper aliases `@` and `@product` to the app, keeps one copy each of react,
react-dom, remotion, three and scan-chart (the highway's asset patch needs a
single THREE), compiles app sources with the app's TypeScript semantics
(`useDefineForClassFields: false`), and turns on ANGLE. Node scripts that
bundle get the same webpack override from the same options.

## Areas and where each block comes from

CE = the chart-editor film (`video/`), FM = the Find Music film
(`showreel/`).

| Area | Blocks | Sources |
| --- | --- | --- |
| `config` | `withProductApp`, bundle override for scripts, both from the film's one `productApp.config.ts` | CE `remotion.config.ts`, FM `bundle-config.mjs` |
| `format`, `load` | fps, size and the title-safe box from the composition; `useLoaded`, loading by path in `public/` through one `publicUrl` | CE `lib/load.ts` |
| `clock` | FilmClock (optional audio, no required timeline), SceneWindow, `useGlobalFrame`, `useScene`, TimeShift, event and pulse helpers; storyboard (`defineStoryboard`, `sceneBar`, `sceneBeat`, check) with no runtime imports; cue helpers (`snapToEvent`); one-take scene starts derived from durations | CE `lib/time.ts`, `storyboard.ts`, cue modules; FM board D |
| `music` | the timeline contract (types only), `TimelineProvider`/`useTimeline`/`TimelineApi`, beat grid, song time over an edit's segments, a timeline built from a tempo for films on a music bed | CE `lib/timeline.ts`, `beatGrid.ts`, `songTime.ts` |
| `motion` | easings, springs and `settle` (fps as a parameter), keyframes, staggers, seeded random, `glide`; colour, geometry, sorted event lists, quad-to-quad `matrix3d` | CE `lib/motion.ts`, `color.ts`, `geometry.ts`, `highway/quad.ts`; FM `fx.tsx`, board D |
| `camera` | one plane-camera model: a pose pins a plane point to a screen point with scale, rotation, depth of field and blur; keyframed paths; `project` for overlays; slow orbit; blur from screen velocity; the highway floor camera | FM `boards/d/camera.ts`, board D; CE `highway/planeCamera.ts`, S07 `space.ts`, `camAt` |
| `text` | measurement and balanced line breaking, `KineticText` with presets (a blur-in preset replaces FM's `Words`/`BlurWords`), fonts that hold the frame until loaded, pixel-stable line height for supersampled renders | CE `lib/text.ts`, `KineticText`, `kineticPresets`, `fonts.ts`; FM `fx.tsx`, `parts.tsx`, `fonts.ts`, `ui/` |
| `brand` | tokens (colours from the app's own `lib/og/tokens`, plus type scale, space, radius and motion presets), `BrandMark`, `Wordmark`, service and instrument marks, one `BrandStage`, an `EndCard`, the `LogoSting` player | CE `theme/tokens.ts`, `Brand.tsx`, `Stage.tsx`, S08; FM `brand/`, stages |
| `fx` | Grain, Vignette, Glow, Flash, Shockwave, SparkBurst, LightSweep, ChromaSplit, CameraShake, MotionBlur, Pop, GlassPlane, Bokeh, DepthOfField, WhipFilter | CE components; FM `fx.tsx`, `e/kit.tsx`, board D `World` |
| `ui` | Cursor with recorded and scripted paths, ClickRing, Callout/Leader, Chip, Eyebrow, ChapterSlate, Playhead, BeatMarker, Waveform with `clipPeaks`/`peakMax` | CE components; FM `d/parts.tsx`, `f/kit.tsx` |
| `highway` | `ProductHighway` driven by `HighwayStage.renderFrame` (chart and song time injectable), product assets, highway geometry and editing, split panes, compositing (`HighwayCrop`, lane mask, `LaneBleed`, `Iris`), one copy of the app's highway types | CE `highway/`; FM `f/kit.tsx`, `d/highway.tsx` |
| `recorder` | `RecordedLayer`, the manifest core, the take-versus-edit check, recorded cursor paths, loaders with an injectable root | CE `recorder/` |
| `scripts/recorder` | record any running web app under a virtual clock: CDP client, virtual clock with the worker gate, frame encoder, gestures, a frame loop with setup, time-pin, per-frame data and sync hooks, placing a take in the storyboard; the chart editor's adapter (session, probe helpers, roll layout, spec kit, roll stills) | CE `scripts/recorder`, `scripts/editor` |
| `scripts/audio` | PCM, DSP (FFT, onsets, biquads, BS.1770 loudness, true peak), mastering, the music edit (attack-aware splices, gain lanes, ring-out), verification, chart to timeline data, the timeline writer (peaks, envelopes), `buildSoundtrack(config)`, SFX synthesis from cues, a loop-bed arranger | CE `scripts/audio`, `prep-showcase-audio.ts`; FM `sfx.py`, `arrange.py` |
| `scripts/render` | film render (optional 2× supersampling, scene chunks, retries under load), mux with the AAC delay trimmed, delivery encode (BT.709 tags, variants, poster frame first), stills, strips, contact sheets, frame comparison and reference checks | CE `scripts/dev`, the chunk and check scripts; FM `render-film.mjs`, `strip.mjs`, `stills.mjs`, `frames.mjs` |
| `scripts/qa` | motion audit (frozen frames), pacing audit (reading time, configurable rules), highway smoke check (not black, in sync) | FM `motion-audit.py`, `pacing-audit.mjs`, `DevChecks.tsx`; CE `verify-sync.ts` |
| `blender` | the logo sting, with start, length, event frames, fps, size and brand colours as inputs | CE `scripts/blender` |

Left behind: FM's hand-drawn CSS highway and its hand-written copies of the
app's UI (videos use the real highway and recordings of the real app), board
data such as beat tables and measured pixel boxes, every song-specific edit,
recording spec and chart, and the rejected boards' fonts.

## App changes the kit needs

The highway is the app's own renderer, so the kit needs a few hooks in
`lib/preview/highway/`. The app behaves as before: the editor never calls
`renderFrame` or `seek`, and each new option defaults to what the stage
did already.

1. Draw at any time, in the commit "Let a caller that owns its clock draw
   the highway at any time". `AnimatedTexture.seek(ms)`,
   `AnimatedTextureManager.seek(ms)` and `SharedCellTextures.seek(ms)` show
   the frame a looping texture plays `ms` into its loop.
   `HighwayStage.renderFrame(elapsedMs)` seeks the textures and draws one
   frame synchronously.
2. Render offscreen for the kit, a second change tested by
   `__tests__/stage-render-frame.test.ts` and
   `__tests__/highwayCamera.test.ts`:
   - `renderFrame` throws when the draw fails, when the stage is destroyed,
     and once its WebGL context is lost. The animation loop's draw still
     logs and carries on. The kit also watches the stage's existing
     `onContextLost`, so a lost context fails the render.
   - `highwayCamera.ts` holds `createHighwayCamera(worldX)` and
     `fitHighwayCamera(camera, rect, halfWidth)`, moved out of the stage, so
     the kit's overlays build the same camera the stage draws with.
   - `StageConfig.pixelRatio` sets the device pixel ratio, and
     `LyricsOverlay` takes it too. `StageConfig.loadingManager` is the
     manager every texture request goes through, the animated WebP
     fetches included (`resolveURL`).
   - `stage.ts` exports `StageClock` and `GridData`. `StageClock` is the
     members of `AudioManager` the stage reads, which `setupStage` now
     takes. `GridData` is what `setGridData` takes.
   - `NoteRenderer.ts` exports `GEM_ANCHOR_Y` and `LyricsOverlay.ts`
     exports `CANVAS_CSS_HEIGHT`, for the kit's highway geometry and its
     smoke check.

## Rules the kit encodes

- Real product only: the highway is the app's own renderer, and app UI is a
  recording of the running app. Neither is redrawn.
- Every frame is a pure function of the global film frame. No wall clock, no
  scene-local state for motion that crosses a cut.
- Format comes from the composition (`useVideoConfig`); pure helpers take fps
  as a parameter, and layout keeps to the format's title-safe box. A block
  must not assume 60 fps or 1920×1080; the template is checked at 60 fps
  landscape and at 30 fps portrait.
- Song-specific material (audio, charts, recordings, lyrics, names) is
  generated into a film's gitignored `public/generated/` and never committed.
  Committed examples use invented names.
- Only the product renders lyrics. Credits name the music, not the chart.
- Scripts take every path on the command line; nothing hard-codes a machine
  path.

## Verification

- `pnpm typecheck` is clean for the kit (the template included) and the
  gallery. `pnpm test` passes 273 tests: the pure modules (beat grid, song
  time, tempo timelines, line breaking, springs and `settle`, quads,
  splices, loudness on synthetic signals), and each script end to end on
  synthetic input (a click track, a generated test chart), never on song
  material.
- The gallery renders all 53 of its compositions. Its smoke check fails
  when the product highway draws black or runs a frame or two out of sync.
- A film scaffolded from the template typechecks, passes the pacing audit
  and keeps to the title-safe box at 60 fps landscape and at 30 fps
  portrait. A scene preview plays the film's soundtrack and renders
  pixel-identical to the same frame of the film.
- The chart editor's recorder adapter recorded the running app four times,
  byte-identical.
- The app's highway changes: typecheck and the full jest suite pass at each
  commit.
- The recorder's `.mjs` and `.js` scripts are not type-checked: `checkJs`
  is off. The recorder's tests and `selftest.mjs` exercise them instead.

## Out of scope

Moving either existing film onto the kit, and the film-specific
choreography built on these blocks (the editor-window assembly, the
handoff values between scenes).
