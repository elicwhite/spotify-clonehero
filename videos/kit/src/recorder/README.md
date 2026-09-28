# recorder: recordings of the running product in a film

`@musiccharts/video-kit/recorder`

App UI in a film is the running product, recorded frame by frame on the
film's own clock by `scripts/recorder` (see its README). For every film
frame the recorder pins the app to that frame's time, lets it draw one
animation frame, screenshots it, and crops each UI component into its own
video, so the pieces of the app can move independently and still stay in
sync with each other and the soundtrack. Nothing is a reproduction: hover
halos, marquees, drag previews, selections and the karaoke line are the
product's own pixels.

## Takes

A take is a folder in the film's gitignored public tree: one video per
component (`<component>.mp4`, H.264 4:4:4, BT.709, device pixels) and
`manifest.json`. A film names its takes with explicit roots (paths in its
public dir); there is no built-in list of ids:

```ts
const take = (id: 'editor-drums' | 'editor-tiers'): RecordingRef => ({
  root: 'generated/rec', // under the film's public dir
  id,
  writtenBy: `node --import tsx .../record.mjs --spec specs/${id}.spec.mjs ...`,
});
```

## API

```tsx
import {RecordedLayer, recordedCursorPath, useRecordedFrame, useRecording} from '@musiccharts/video-kit/recorder';
import {Cursor} from '@musiccharts/video-kit/ui';

// A component at its real place and size in the recorded viewport, showing
// the recorded frame for the current GLOBAL film frame:
<RecordedLayer recording={take('editor-drums')} component="pianoRoll" />

// Fill the parent instead; show a given film frame; hold the ends:
<RecordedLayer recording={ref} component="pianoRoll" fit="fill" />
<RecordedLayer recording={ref} component="window" frame={1500} />
<RecordedLayer recording={ref} component="window" hold="clamp" />

// The manifest (null while it loads; the frame waits), per-frame data, and
// the real pointer as a script for the ui area's <Cursor>:
const manifest = useRecording(ref);
const rec = useRecordedFrame(ref); // {manifest, filmFrame, inside, frame: {f, songSec, cursor, ...}}
if (manifest) <Cursor {...recordedCursorPath(manifest, {from, to})} project={p => ...} />;
```

- `RecordedLayer` puts an `<OffthreadVideo>` in a `Sequence` whose start
  makes the right video frame land on the current composition frame: a still
  at film frame f shows exactly the harness's screenshot of f (the gallery's
  `Recorder-FrameCheck` measures 52 dB PSNR against it; the neighbouring
  frame scores 25 dB). Do not wrap it in `<Freeze>` (Freeze does not reach
  OffthreadVideo's frame extraction in renders): pass `frame`.
- `recordedCursorPath(manifest, {from, to, clickFrames})` returns a
  `CursorScript`: a key on every frame the pointer moved (linear, no arc, so
  it retraces the input), presses up to `clickFrames` long (default 0.15 s)
  as clicks and longer ones as drags, and a `visible` window for every time
  the pointer appeared (a take parks it off the app between gestures).
  Positions are viewport CSS px: map them the way you map the layers
  (`project`).
- `useRecordedFrame<M>(ref, frame?)` / `recordedFrameData(manifest, f)`: a
  frame's record, typed by the manifest (`frame` is `M['frames'][number]`).
- `recordedComponent(manifest, name)` and `recordedInteraction(manifest,
kind)` look things up and fail the render when the take lacks them.
- `loadRecording(ref)` fetches a manifest outside a component (for
  `calculateMetadata`). `recordingPath(ref, file)` is a file of the take as
  a public path (`publicUrl` from the load area makes it a src).

## Checks

- A take plays frame for frame, so `useRecording` fails a composition whose
  fps is not the take's.
- A take made for an older edit of the music fails the render. Inside a
  film scene with a music timeline (`useOptionalTimeline`), `useRecording`
  checks the take's recorded song time (`manifest.songTime`) against the
  film's edit on every frame the scene shows, to within half a frame
  (`assertTakeMatchesEdit`); the error names the take, the frame, both song
  times and the command that re-records it. A take pinned to one segment
  (it played that segment's mapping on through a splice) is checked against
  that segment's mapping. Handles outside the scene, a take's own
  standalone preview, and takes that follow no song are not checked.

## Manifests

`manifest.ts` is the core every take shares: `id`, `app` (which recorder
wrote it), `description`, `fps`, `viewport`, `range` (video frame i is film
frame `from + i`), `songTime` (song seconds per frame, one range per segment
of the edit, each marked `pinned` when the take held its segment past a
splice), `components` (`box` in CSS px, `crop` in device px, `file`),
`interactions` (the plan's notes), `frames` (`f`, `cursor` {x, y, down,
visible, over, events}, `songSec`, and the adapter's own fields),
`encoding`, `pageErrors`, `recordedAt`.

`chartEditor.ts` is the chart editor adapter's part: `EditorRecording` adds
`setup`, `layouts[]` (piano-roll bands, rows and lanes, highway panes) and an
`editLog` of note snapshots; each `EditorFrame` adds the frame's `layout`,
its roll view `{leftMs, pxPerMs, follow, playheadX}` and, for editing takes,
the `edit` state (tool, selected notes, the roll's live gesture). Use
`useEditorFrame(ref)` / `editorFrameData(manifest, f)` (a frame's record
with its roll layout and view, panes and edit state resolved) and
`rollX(view, songMs)` (roll.ts, the same function the recorder aims with)
for the x of a song time. The roll's high-DPI stills (`roll-stills.mjs`)
load with `useRollStills(ref)`: their geometry, lyric pill extents and any
overlapping pills; a still's file is `recordingPath(ref, stills.files.wave)`.

## Things to know

- A recording exists only inside its take: frame the cuts inside it, or use
  `hold`.
- The real OS cursor is not in the videos; draw one from the take's pointer.
- A missing manifest or video fails the render with its path and `writtenBy`.
