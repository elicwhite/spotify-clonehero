# The chart editor adapter

Records the running `/chart-editor` with the generic recorder (`../../`,
see its README): a fresh import of the chart through the editor's own load
screen, the view set up with real clicks, keys and wheel events, the
editor's playback pinned to the film's song time on every frame, and its
piano-roll geometry, highway panes and editing state written into the
manifest (`EditorRecording` in src/recorder).

| File               | What                                                                                                                                                                                                                                           |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `probe.js`         | `window.__recEditor`: the editor's own objects, found through React's fibers (`__recFiber`): the AudioManager (and `pin(songSec)`), transport, the roll's view, scene, gestures and lyric pills (geometry only), the Chart Matrix, `dispatch`. |
| `session.mjs`      | `chartsFromFlags` / `chartOf` (`--chart <name>=<path>`), `importChart`, `clearCharter`, `setPanelHeight`, `setVisibleTracks`, `zoomRoll`, `panRollTo`, `measureComponents`, `GEOMETRY_JS`.                                                     |
| `layout.mjs`       | The piano roll's band layout: `rollLayout`, `rollPoint`, `laneBand`, `frameGeometry`, `tickToMs`; a song time's x is src/recorder's `rollX`.                                                                                                   |
| `spec-kit.mjs`     | What editor specs use: `EDITOR_COMPONENTS`, live targets `at(sec, lane)` and `atTick(tick, lane)`, `tool(name, input)`, `panRoll`.                                                                                                             |
| `record.mjs`       | The take CLI: `recordCli` (../../record-cli.mjs) with the editor's steps.                                                                                                                                                                      |
| `roll-stills.mjs`  | High-DPI stills of the piano roll at a fixed view.                                                                                                                                                                                             |
| `example.spec.mjs` | An example take with generic moves only and no song seconds.                                                                                                                                                                                   |

## Setup

A production build of the app (no HMR, no dev overlay), from the app's
folder:

```sh
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 \
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=placeholder NEXT_TELEMETRY_DISABLED=1 npx next build
# same env:
npx next start -p <port>
```

And the recorder's Chrome (../../README.md).

## Record a take

```sh
node --import tsx kit/scripts/recorder/apps/chart-editor/record.mjs \
  --cdp http://127.0.0.1:<cdp port> --app-url http://localhost:<port>/chart-editor \
  --spec <film>/specs/<id>.spec.mjs \
  --chart main="<chart folder | .zip | .sng>" [--chart tiers="<folder>"] \
  --timeline <film>/public/generated/timeline.json \
  --storyboard <film>/src/storyboard.ts \
  --out <film>/public/generated/rec \
  [--range a-b] [--preroll-sec 1.5] [--handle-sec 0.5] [--keep <dir> --frames 1500,1600] [--no-encode]
```

The clock start and the page's date are fixed by default (60 s, 2026-01-01
12:00 UTC at the pre-roll start; `--clock-start-sec`, `--clock-date`), like
every recorder's; run it without flags for the full list.

The example (`example.spec.mjs`, the kit's test chart with a click track,
511 frames) records in about 85 s plus about 10 s of setup, and two takes
of it are byte-identical on every component.

Setup order: fresh import, the Charter emptied, panel height (a reload),
visible tracks, zoom, the spec's `prepare`; then the clock stops, the
editor's own `editor_seek` puts the playhead at the pre-roll start and
`editor_play` starts playback. With `roll.leftSec` the harness pans the roll
there 0.2 s into the pre-roll (a horizontal wheel over it: the product's
own pan, which also turns its follow mode off, so the view holds still while
the playhead moves). Where a take crosses a splice of the film's edit, the
editor seeks there exactly as the soundtrack cuts. The harness fails the
take if the editor ever reports another time than the film's song time.

The film credits no charter, so every take empties the song's Charter in
the product's own song-details dialog (the song header's "Edit song
details", the Charter field cleared, Save); the header then names only the
song and the artist. Do not blank `charter` in the song.ini instead: the
import reads a missing charter as "Unknown Charter".

## Editor specs

The generic spec (../../spec.ts) plus these fields:

```js
import {Plan} from '../../gestures.mjs'; // from a film: '@musiccharts/video-kit/scripts/recorder/gestures.mjs'
import {EDITOR_COMPONENTS, atTick} from './spec-kit.mjs';
import {quintOut} from '@musiccharts/video-kit/motion'; // a glide's easing (default inOutCubic)

export default {
  id: 'editor-example',
  description: 'What the take shows, for the manifest.',
  chart: 'main', // which --chart to open
  scene: 'editor', // the storyboard scene the take is for
  songBar: 12, // optional: fail unless the scene opens on this song bar
  window: {bars: 2}, // optional, with its reason: {bars: n} ends after n bars, {tail: n} n frames after the scene
  panelHeight: 420, // piano-roll panel height (160..560)
  tracks: ['guitar:expert'], // visible tracks in pane order (real Chart Matrix clicks)
  roll: {pxPerMs: 0.2}, // zoom ({spanSec} or {pxPerMs}); `leftSec` holds the view still there
  components: [...EDITOR_COMPONENTS, 'highway-guitar-expert'],
  fixedComponents: {toast: {x: 1516, y: 978, width: 388, height: 102}}, // boxes for UI that appears mid-take
  songSegment: ({tl, beat}) => tl.songAt(beat(0)).segment, // optional: play one segment throughout (no seek at a splice)
  editLog: {track: ['guitar', 'expert'], windowMs: [0, 30000]}, // optional: per-frame edit state + note snapshots
  live: {elements: {generate: 'button[aria-label="..."]'}}, // boxes read every frame, by CSS selector
  async prepare(page, ctx) {}, // setup before the clock stops (ctx: the hook context, ../../spec.ts)
  plan({tl, fps, beat, start}) {
    return new Plan({fps});
  },
};
```

Targets are functions of `live`: `at(sec, laneName, {edge, dx, dy, row})` in
the piano roll (lane names as the roll shows them: `Open`..`Orange`,
`Red`..`Kick`), `atTick(tick, laneName)` (timed by the roll's own tempo map),
or your own function of `live.roll` (the roll's view, layout and notes; read
it with `rollLayout` and `tickToMs`) and `live.elements`.

`tool(name, input)` calls one of the editor's own WebMCP tools and waits for
the editor to commit: `editor_add_note`, `editor_select_note`,
`editor_delete_selected`, `editor_toggle_flag`, `editor_list_notes`,
`editor_seek`, `editor_set_tool`, `editor_undo`, `editor_redo`,
`editor_state`. Notes added in a frame are drawn in that frame: chart data
can be animated per frame through the product's own commands.

A worker the product starts (the difficulty reducer, say) runs in real
time: gate it (`armWorkerGate` on the frame of the click, then
`deliverWhen` on the frames that should show its progress; worker-gate.mjs).
Its model host lists only the production origin in its CORS policy:
`enableCorsBridge(page, {urlPattern, origin})` in `prepare`.

## Gotchas (all found the hard way)

- A note move gives the notes new ids; the product keeps the old ids
  selected, so Cmd+C after a move copies nothing. Copy before moving.
- In Place Note mode a bare `1`-`5` is a lane key (it places a note). Switch
  tools with Cmd+1 / Cmd+2.
- A marquee press must start on empty lane space: more than 8 px from any
  note head and more than 7 px from a sustain's tail end, or it grabs the
  note or starts a resize.
- Paste lands at the playhead, rounded to the grid: pick the frame whose
  playhead rounds to the target tick.
- Sidebar tooltips open after 300 ms of hover; a click closes them until the
  pointer leaves the trigger.
- Chrome scales CDP wheel deltas by (screen DPR / emulated DPR): 1 at 2x on
  a 2x Mac. The setup zoom and pan loops correct for it; plan wheel steps do
  not.
- The lyrics row draws a vocals waveform only when a separated vocals stem
  exists.
- Never read, print or store lyric text: the probes return lyric geometry
  only. No song, artist or charter names in specs or comments.

## Stills

```sh
node --import tsx kit/scripts/recorder/apps/chart-editor/roll-stills.mjs \
  --cdp http://127.0.0.1:<cdp port> --app-url http://localhost:<port>/chart-editor \
  --chart main="<chart folder>" --spec <film>/stills/<id>.spec.mjs --out <film>/public/generated/rec
```

A stills spec: `{id, chart (default 'main', one of the --chart names, as in
a take spec), tracks, panelHeight, roll: {spanSec | pxPerMs, leftSec},
playheadSec, deviceScale, panel}`. It writes the roll's top bands with and
without the lyrics row's waveform, optionally the whole panel, and a JSON of
the geometry, the lyric pills' extents and any overlapping pills; a film
reads it with `useRollStills(ref)` (src/recorder).
