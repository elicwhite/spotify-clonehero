# ui

On-screen pieces: the cursor, click rings, callouts, marks inside a plane,
chips, eyebrows and chapter slates, playheads, beat markers and waveforms.
Every time point is a FILM frame, and so is every duration you pass; the
defaults are written in seconds and converted with the fps, and anything in
seconds says so in its name (`startSec`, `headlineDelaySec`). Sizes you pass
are composition px; defaults are reference px scaled by the format. Nothing
takes a frame override: re-time a piece with the clock's `TimeShift`.

```tsx
import {Callout, ChapterSlate, Cursor} from '@musiccharts/video-kit/ui';
import {recordedCursorPath} from '@musiccharts/video-kit/recorder';

<ChapterSlate
  accent={lane.yellow}
  eyebrow="Drum transcription"
  headline="Turn a song into a first-pass drum chart"
  caption="A trained model listens to the audio and proposes notes."
  enterAt={beat(8)}
  exitAt={beat(11, 3)}
/>;

// A scripted cursor on plane px, drawn through the camera.
<Cursor
  path={[
    {at: f0, x: 900, y: 700},
    {at: f0 + 24, x: 1280, y: 134},
  ]}
  clicks={[f0 + 30]}
  visible={[{appearAt: f0 - 10, hideAt: f0 + 90}]}
  project={p => project(pose, lens, p)}
/>;

// The real pointer of a recording, retraced.
<Cursor {...recordedCursorPath(manifest)} />;

<Callout
  at={f}
  exitAt={f + 150}
  anchor={project(pose, lens, cell)}
  label={{x: 1290 * unit, y: 240 * unit}}>
  Every score shows its work.
</Callout>;
```

## The cursor (`cursor.tsx`, `ClickRing.tsx`)

| Export                                                                       | What it is                                                                                                                                               |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CursorScript`                                                               | `{path, clicks?, drags?, visible?}`: everything a cursor does. The recorder's `recordedCursorPath(manifest)` returns one; so can a script.               |
| `CursorKey`                                                                  | `{at, x, y, ease?, arc?}`: arrive at (x, y) at film frame `at`. Default ease `CURSOR_EASE` (quick to leave, soft to land) and a 0.06 sideways arc.       |
| `CursorWindow`                                                               | `{appearAt, hideAt?}`: a window the arrow is shown in. No `visible` means always shown.                                                                  |
| `Cursor({...script, project, size, look, rippleColor, motionBlur, opacity})` | The macOS-style arrow: `project` maps path points (plane px) to the screen so the arrow keeps its size on a turning plane; `look` `'dark'` or `'light'`. |
| `cursorAt(path, frame)`                                                      | Where a path puts the cursor (pure).                                                                                                                     |
| `cursorVisibility(visible, frame, fps)`                                      | Its opacity (pure).                                                                                                                                      |
| `ClickRing({x, y, at, color, from, to, duration, width, core})`              | An expanding ring where a click lands, with a centre flash. The cursor's ripples are small ones.                                                         |

## Callouts and plane marks (`Callout.tsx`, `planeMarks.tsx`)

| Export                                                                                      | What it is                                                                                                                                                   |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Leader({at, exitAt, anchor, label, via, from, color, width, ring, pulse, halo, duration})` | A line from a label point through optional corners to an exact point, drawn on from `at`; a ring springs open, a dot sits and a slow pulse rings the anchor. |
| `Callout({...leader, children, align, look, labelStyle})`                                   | A leader and its label: a dark card with an accent rim (`look="box"`) or mono uppercase text (`"plain"`), beside the label point, away from the anchor.      |
| `PlaneRing({at, exitAt, box, pad, radius, color, fill})`                                    | A glowing outline around a control, drawn inside a `PlaneView` in plane px so it tilts with the plane.                                                       |
| `PlaneFlash({at, box, color, duration})`                                                    | A ring pulsing out of a control as it changes state.                                                                                                         |

## Slates and labels (`Eyebrow.tsx`, `ChapterSlate.tsx`, `slateTiming.ts`, `Chip.tsx`)

| Export                                                                                                                                                                          | What it is                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Eyebrow({text, accent, x, y, maxWidth, enterAt, exitAt, enter, tone})`                                                                                                         | An accent bar that draws from the left and a mono label typed (`'type'`), decoded or slid in. `accent` is a plain colour; `x`/`y` place it absolutely, kept inside the title-safe box, else it lays out in the flow. A label wider than `maxWidth` (placed: up to the safe box's right edge) wraps.                                                              |
| `ChapterSlate({accent, eyebrow, headline, caption, x, y, enterAt, headlineAt, captionAt, exitAt, eyebrowExitAt, exit, headlineSize, headlineMaxWidth, captionMaxWidth, scrim})` | Eyebrow, headline (h1, two lines at most) and caption at `x, y` (default the layout's slate position), drifting up over its life. Position and widths stay inside the title-safe box; where it is narrower than the headline measure (portrait), the headline scales down with it and keeps its line breaks. `exit` is `'maskUp'`, `'whip'` or your `SlateExit`. |
| `chapterSlateTiming(props, fps)`, `eyebrowGone(text, timing, fps)`, `eyebrowLabelTiming(...)`                                                                                   | The slate's and eyebrow's timing exactly as they draw it (`kineticTimeline` per line): when the caption starts, when each part leaves, and the first whole frame everything is gone. Node-safe (`slateTiming.ts`), for pacing sheets.                                                                                                                            |
| `SLATE_EXITS`, `SlateExit {headline, caption, headlineDelaySec, captionDelaySec, headlineStaggerSec?, captionStaggerSec?}`                                                      | The standard exits (`maskUp`, `whip`) and the shape of your own, in seconds after `exitAt`.                                                                                                                                                                                                                                                                      |
| `Chip({label, accent, lead, size, shape, highlight})`                                                                                                                           | A mono label in a pill; the accent tints it, `highlight` makes it glow; `lead` is a dot, a lucide icon or nothing.                                                                                                                                                                                                                                               |

## Time and audio (`Playhead.tsx`, `BeatMarker.tsx`, `Waveform.tsx`)

| Export                                                                                                                                               | What it is                                                                                                                                                                                                                                              |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Playhead({x, top, height, color, glowColor, width, glow, handle, label})`                                                                           | A thin glowing line with a handle. Playheads and scrolling time are the only linear motion.                                                                                                                                                             |
| `BeatMarker({x, baseline, height, downbeat, label, landAt, color, highlight, highlightColor, glow})`                                                 | A beat line that lands with a squash and one rebound and pops its mono label.                                                                                                                                                                           |
| `Waveform({peaks, rate} or {stem}, startSec, endSec, width, height, ...)`                                                                            | Mirrored rounded bars on a canvas over song seconds `[startSec, endSec]`, split colours at `playheadX`, `reveal` from the centre, `fadeEdges`. With `peaks` it never touches the timeline; with `stem` (default `'mix'`) it reads the timeline's peaks. |
| `waveformBars({peaks, rate, startSec, endSec, width, pitch, ...})`, `clipPeaks(peaks, rate, fromSec, toSec)`, `peakMax(peaks, rate, fromSec, toSec)` | The bar geometry (each bar owns a fixed slot of time, `tSec`, so scrolling never shimmers), a copy with bins outside a window zeroed, the loudest bin in a window.                                                                                      |

## Rules

- The cursor is always the same arrow; recorded and scripted paths are the
  same `CursorScript`.
- Callouts sit in negative space and point at exact pixels: project plane
  points through the camera (`camera`'s `project`) rather than measuring.
- Marks that must tilt with a plane go inside it (`PlaneView` `overlay`);
  marks that must stay flat go on top, at projected points.
