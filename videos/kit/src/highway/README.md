# highway: the product's own highway in a film

`@musiccharts/video-kit/highway`

`<ProductHighway>` draws the chart editor's highway with the app's own
three.js renderer (`APP/lib/preview/highway/stage.ts`, the stage the editor
mounts), one frame per film frame. The kit does not reimplement any of it:
camera, floor texture and scroll, fret art, gem sprites and their shine, kick
bars, sustains, hit flames, beat and measure lines, fog, selection highlight
and the karaoke line are the app's pixels. A film frames the canvas from
outside only: CSS transforms, masks, blend modes, and the compositing blocks
below.

## Setup

1. The film's `remotion.config.ts` calls `withProductApp(Config, productApp)`
   with the options from its `productApp.config.ts` (config area): `@` and
   `@product` resolve to the app, the app's TypeScript compiles with its own
   semantics, and there is ONE copy each of three and scan-chart.
2. The film serves the app's art: `public/product` is a committed link to
   the app's `public/assets` (`PRODUCT_ASSETS_PATH`). The renderer requests
   `/assets/preview/...`. Each stage loads its art through its own loading
   manager (`productAssets`, passed as the app's
   `StageConfig.loadingManager`), which points those requests there, the
   animated-WebP decoder's fetches included. Nothing global is patched. A
   request that fails fails the render: the app would otherwise draw
   placeholder textures.
3. A chart: generated in memory (the app's
   `readChartForEditing(testChartFiles())` for the kit's invented test
   chart), or a chart folder linked into the film's gitignored
   `public/generated`:

   ```sh
   node --import tsx kit/scripts/highway/link-chart.ts --chart "<chart folder>" --out <film>/public/generated/highway
   node --import tsx kit/scripts/highway/link-chart.ts --test-chart --out <film>/public/generated/highway
   ```

   It links the folder (not files: Remotion's server answers a symlinked
   file with a 404 but reads through a linked folder) and writes
   `chart-files.json`. The song's chart never enters the repository.

4. `product-modules.d.ts` is the kit's one copy of the app types the kit
   calls, so `tsc` never compiles app files under the kit's settings. The
   barrel references it, so films see it too. A film that needs more of one
   of those modules adds to this file (a second `declare module` of the same
   name would clash). `kit/test/highway-product-modules.test.ts` checks every
   declaration against the app's sources.

## `<ProductHighway>`

```tsx
const chart = useChartFolder({
  dir: 'generated/highway',
  writtenBy: 'link-chart.ts ...',
});
<ProductHighway
  chart={chart} // null while loading: the frame waits
  panes={[{track: EXPERT_GUITAR}, {track: EXPERT_DRUMS}]} // default: Expert drums
  segments={tl.timeline.segments} // film time -> song time through the edit
  laneLabels // the editor's pane chips ("Guitar · Expert")
  style={{transform: '...', mixBlendMode: 'lighten'}}>
  {/* overlays in the box's coordinates, see highwayGeometry.ts */}
</ProductHighway>;
```

| Prop              | Meaning                                                                                                                                                                                                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `chart`           | The document drawn this frame (null while it loads). The stage is built from the first document; later ones must be edits of it (`editHistory`). For another chart, mount a new `ProductHighway` (a `key`).                                                               |
| `panes`           | Highways left to right, laid out exactly like the editor's strip (one canvas, `computeStageLayout`, 1 px gap). Each pane: `track`, and the editor state to show: `selectedNoteIds`, `hoveredNoteId`, `noteDrag {ticks, lanes, noteIds}` (the editor's live drag preview). |
| `songTimeSec`     | Song second at the strikeline, explicitly (by default every frame a seek).                                                                                                                                                                                                |
| `segments`        | The film's edit of the song: film time maps to song time through it, and playback runs from the first frame of the playing segment. With neither, film time is song time, playing from frame 0.                                                                           |
| `segmentIndex`    | Pin the mapping to one segment (a shot that crosses a cut).                                                                                                                                                                                                               |
| `playbackFromSec` | The song second the app's playback last started from (see Determinism).                                                                                                                                                                                                   |
| `showLyrics`      | The karaoke line, as the editor draws it. Default true.                                                                                                                                                                                                                   |
| `laneLabels`      | The editor's DOM chip at the bottom of each pane, rebuilt from its label text and styles.                                                                                                                                                                                 |
| `width`, `height` | Box size in CSS px. Default: the composition size. Keep it constant within a shot and animate with `style.transform`: a size change rebuilds the layout and replays playback.                                                                                             |
| `pixelRatio`      | The device pixel ratio the app renders at (the app's `StageConfig.pixelRatio`): 2 (default; twice the resolution with the app's MSAA off, as on a Retina display) or 1 (MSAA, a quarter of the pixels).                                                                   |
| `assetsPath`      | Where the film serves the app's `public/assets`. Default `product`.                                                                                                                                                                                                       |
| `onDraw`          | `(canvas, songSec) => void`, called in the same task as each frame's draw with the app's WebGL canvas (device px). The app does not preserve its drawing buffer: copy pixels here.                                                                                        |

The canvas is opaque black (the app's clear colour and fog). On a stage use
`mixBlendMode: 'lighten'`: the black drops into the background and every
highway pixel brighter than it stays exactly as drawn.

The highway maps the GLOBAL film frame to song time (`useGlobalFrame`), so
it plays the same inside any `Sequence`. An overlay placed by song time
(`highwayPoint`'s `nowSec`) must read the global frame too.

One stage draws one karaoke line across all its panes, like the editor. To
move parts of one stage independently (its panes, its karaoke band), split
its canvas with `useSplitHighway(regions, pixelRatio)`: one canvas per
region, filled 1:1 in the draw's own task (render the canvases first, hide
the source with `opacity: 0`).

## Determinism

Every frame is a pure function of the props and the song time:

- `stage.renderFrame(ms)` draws synchronously with every looping gem
  texture on the frame it shows at that time (not the editor's wall-clock
  loop). Unlike the editor's loop, which survives a bad frame, it throws:
  when the draw fails, and when the stage is destroyed or has lost its WebGL
  context.
- The stage's own loop reads a clock that always reports the frame's time
  and "not playing", so if it draws, it draws the same picture.
- The karaoke line is the one piece of app state with history (its slide
  between lines). Before drawing a frame the component replays the app's
  playback up to it (karaokeReplay.ts): on the film's frames from the first
  frame of the playing segment (frame 0 without segments; the frame that
  plays `playbackFromSec` when given), each step at its own song position.
  An explicit `songTimeSec` replays on a song-second grid of the film's
  frame rate from `playbackFromSec` instead, and a time off that grid is a
  seek. Frames arriving in order replay nothing between them. A step costs
  a full draw, measured at 0.4 to 0.7 ms (one and two 1920x1080 panes at
  2x, Apple silicon, the machine busy): a fresh tab whose first frame is
  60 s into a segment spends about 2.5 s on the replay. Without karaoke
  lines (`showLyrics={false}`, or a chart without vocals) nothing is
  replayed. The route to a cheaper replay is an app call that steps the
  karaoke line's state without drawing (a `stepLyrics(ms)` on the stage),
  not built yet.
- Nothing global is overridden: the pixel ratio and the loading manager are
  the stage's own config (`StageConfig.pixelRatio`, `loadingManager`).
  Changing either rebuilds the stage; the frame waits for the new one, and
  nothing draws on or mounts panes onto the old one (the same holds when
  Fast Refresh re-runs the stage's effect).
- Failures fail the render (`cancelRender`): a stage that cannot be built, a
  track the chart lacks, an app asset that did not load, an error inside
  the app's draw, or a lost WebGL context (`onContextLost`).

## Edits (`editing.ts`)

Edits run the chart editor's own commands on the document, so the result is
what the editor holds after the same action:

```ts
const phrase = notesBetween(doc, EXPERT_GUITAR, fromMs, toMs); // song ms
const history = editHistory(doc, [
  {frame: dropFrame, apply: d => moveNotes(d, EXPERT_GUITAR, phrase.map(noteIdOf), {lanes: -1})},
  {frame: deleteFrame, apply: d => deleteNotes(d, EXPERT_DRUMS, [id])},
]);
<ProductHighway chart={history(frame)} panes={[{track: EXPERT_GUITAR, selectedNoteIds, noteDrag}]} />
```

Helpers: `trackNotes`, `notesBetween`, `noteIdOf`, `moveNotes` (ticks and/or
pad lanes), `deleteNotes`, `addNote`, `setNoteLength` (ticks), `editHistory`.
Note ids are the editor's (`${tick}:${noteTypeName}`); a moved note gets a new
id, so select moved notes by re-reading them from the edited document. The
app has no pop animation for edits: the gem changes lane on the frame the
edit lands. An empty highway is the chart with the track's notes deleted.

## Geometry

- `floor.ts`: the app's floor in world units, with no imports (Node scripts
  read it: the sync check in scripts/qa): `HIGHWAY_SPEED` (1.5 units per
  song second), `STRIKELINE_Y` (-1), `FLOOR_NEAR_Y` (-1.1), `FLOOR_FAR_Y`
  (0.9, under the fog), `FLOOR_HALF_WIDTH`, `noteWorldY(noteSec, nowSec)`,
  `floorCorners`. `highwayGeometry.ts` checks the values the app exports
  against its own when it loads.
- `highwayGeometry.ts`: where things land in a `ProductHighway` box, with
  the app's lanes, pane layout and camera: each pane projects through the
  app's own `createHighwayCamera` and `fitHighwayCamera`, the builder the
  stage gives every highway. `highwayPoint({box, paneCount, paneIndex,
instrument, lane, atSec, nowSec})` (a lane at a song time; `atSec` omitted
  = the strikeline), `gemCentre` (the centre of the gem sprite the app
  draws there, from its `GEM_ANCHOR_Y` and `SCALE`; `GEM_HEIGHT`),
  `laneOfNoteType` (throws for a type the highway has no
  lane for), `isOnHighway`, `stageLayout` and `paneRects` (the editor's
  strip layout), `highwayQuad(rect, instrument, nearY?, farY?)` and
  `floorQuad(box, instrument)` (the floor's screen corners).
  `highwayInstrumentOf(track)` (floor.ts) names the floor a track is drawn
  on.
- `screenMove.ts`: `moveQuad(move, quad)`, a 2D move of the screen after
  the highway is drawn (scale and turn about a pivot, then translate), on
  the camera area's matrices.

The floor is a plane, so its image is exactly a quad under a projective map
(motion's `quadToQuadMatrix3d`). World Y is linear in song time, so a flat
grid spaced linearly in time lands on the app's beat lines exactly. Gem
sprites face the camera rather than lying on the floor, so any warp beyond a
2D move distorts them: keep the highway in the player's perspective.

## Setting it into a shot

| Block           | What it does                                                                                                                                                                                                                                                                                                                         |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `WarpedHighway` | One highway (`track`: instrument and difficulty) drawn in `box` (default the composition), its floor warped onto the screen quad `target`. Only the floor's box is warped. The wrapper carries `mix-blend-mode: lighten`: put no transform, filter or opacity on an ancestor between it and the stage (compose moves into `target`). |
| `HighwayCrop`   | The highway drawn `renderHeight` tall and slid so the far end of its floor sits `horizonAt` px from the box top, fading out of the fog (`fadeTop`); `cutout` masks the canvas's black away around the lane (`laneMask`). Both come from `floorQuad`, the app's own geometry.                                                         |
| `LaneBleed`     | Lane-coloured light that bleeds out from behind a highway.                                                                                                                                                                                                                                                                           |
| `GlassRim`      | The rim of a glass panel around a highway (last child of the panel).                                                                                                                                                                                                                                                                 |
| `Iris`          | Whatever it wraps, seen through a circle; a rim glows outward only.                                                                                                                                                                                                                                                                  |
| `HighwayPlate`  | The full-frame shot: stage background, lane light, the lane cut out, sized from the composition; `move` drifts, scales and turns it.                                                                                                                                                                                                 |

`HighwayCrop`, `HighwayPlate` and `WarpedHighway` take what is drawn and
when as `CroppedHighwayProps`: the `ProductHighway` props of one pane
(`track`, default Expert drums). Nothing here draws over the highway's
pixels: light sits behind the lane, rims outside it, and fades only take
alpha away.

## Checks

- `HighwaySmoke` (the gallery's `Highway-Smoke`): checks the highway
  against the film's clock, drawing the chart three times at the song time
  the clock gives each frame: the highway (karaoke on, so it replays), the
  same without a probe note (the difference of the two pictures is exactly
  the note), and a twin with no history (karaoke off). It fails the render
  when the frame is black; when the probe is drawn more than half a frame of
  its travel from where the clock puts its gem (`gemCentre`: the app's
  camera, and its sprite geometry `GEM_ANCHOR_Y` and `SCALE`), checked on
  the near half of the floor, clear of the strikeline; when the twin
  differs from the highway by a single pixel below the karaoke band (a
  stale clock, or a frame drawn from another's state); and on `hitFrame`,
  when the drawn song second is not the probe's. `skewFrames` draws the
  highways off the clock, to prove the check: a skew of one or two frames
  fails it, none passes. The pixel helpers (`readPixels`, `litFraction`,
  `differenceOf`, `mismatchOf`) are exported for a film's own checks.
- Frame-exact timing (every note on the strikeline on its timeline frame) is
  the Node sync check in scripts/qa, which reads `floor.ts`.
- `testChart.ts`: the invented test chart (a groove, a riff, a few invented
  syllables) and `TEST_PROBE_NOTE`, a lone snare at 4.5 s.
