# music

The timeline contract between a soundtrack build and a film, the one way a
timeline is built, and the API a scene reads musical time from.

A film's timeline is a value in one module, `src/music.ts`, which its
storyboard, cues, pacing sheet and Node tools import when they load:

```ts
// src/music.ts, once the soundtrack build has written public/generated/
import generated from '../public/generated/timeline.json';
import {assertTimeline} from '@musiccharts/video-kit/music';

export const timeline = assertTimeline(
  generated,
  'public/generated/timeline.json',
);

// or, on a music bed with a steady tempo, before or instead of a song:
export const timeline = tempoTimeline({bpm: 120, durationSec: 44, fps: 30});
```

The film hands it to the provider, with the curves as paths in `public/`,
and every scene reads musical time from the provider:

```tsx
import {useGlobalFrame} from '@musiccharts/video-kit/clock';
import {TimelineProvider, useTimeline} from '@musiccharts/video-kit/music';
import {timeline} from './music';

export const Film: React.FC = () => (
  <TimelineProvider
    timeline={timeline}
    peaks="generated/peaks.json"
    envelopes="generated/envelopes.json"
    writtenBy="the soundtrack build">
    <Scene />
  </TimelineProvider>
);

const Scene: React.FC = () => {
  const tl = useTimeline();
  const frame = useGlobalFrame();
  const drop = tl.frameOfBeat(8); // bar 8's downbeat
  const crashes = tl.drumFrames({kit: 'crash'});
  const beat = tl.beatAt(frame)?.beat; // 0..3 in 4/4
  const drums = tl.envelopeAt('drums', frame);
  // ...
};
```

`<TimelineProvider src="generated/timeline.json">` fetches the timeline
itself while the frame waits. Use it only where nothing reads the timeline
at module load and the composition must bundle before the file exists (a
gallery block, a QA composition): a missing file then fails that render
alone, naming `writtenBy`. A film's storyboard is built at load, so a film
imports it.

## The contract (`contract.ts`, types only)

`timeline.json` is a `Timeline`:

| Field                                  | What it holds                                                       |
| -------------------------------------- | ------------------------------------------------------------------- |
| `version`                              | `TIMELINE_VERSION` (2)                                              |
| `fps`, `durationSec`, `durationFrames` | The film's rate and length                                          |
| `meta`                                 | `{title, artist}`: credits only, read at render time                |
| `tempo`                                | `{bpm, beatSec, barSec}`                                            |
| `beats`, `bars`                        | The beat grid in video time (`Beat.bar`, `Beat.beat` count from 0)  |
| `segments`                             | The edit: each plays `songStart..songEnd` at `videoStart..videoEnd` |
| `notes.drums`, `notes.guitar`          | Chart notes in video time                                           |
| `vocals.syllables`, `vocals.phrases`   | Sung timing, never text                                             |
| `hits`                                 | `{kick, snare, crash, any}` hit times in video seconds              |
| `mix`                                  | Optional notes on what the build did to the mix                     |

`peaks.json` is `Peaks = {rate, stems}` (peak per bin, `rate` bins per
second) and `envelopes.json` is `Envelopes = {fps, stems}` (RMS per bin).
`stems` maps each stem's name to its curve; `mix` is always present.

Every time is in VIDEO seconds from the film's first frame, and every
`frame` is `Math.round(t * fps)`.

## Building a timeline

| Export                                                                         | What it is                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `makeTimeline(parts)`                                                          | The one builder: times in video seconds in, a checked `Timeline` out. It places every frame, sorts, fills the defaults (one segment playing the song from its start; hits from the audible drum notes) and runs the contract check. The soundtrack writer and `tempoTimeline` both build through it. |
| `tempoTimeline({bpm, beatsPerBar?, durationSec, fps, firstBeatSec?, meta?})`   | Beats and bars from a steady tempo, one segment, no notes                                                                                                                                                                                                                                            |
| `TIMELINE_VERSION`, `timelineProblems(value)`, `assertTimeline(value, source)` | The contract version and check                                                                                                                                                                                                                                                                       |

## Reading it

| Export                                                                  | What it is                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<TimelineProvider timeline \| src, peaks?, envelopes?, writtenBy?>`    | Each input an object or a path in `public/`; paths load once per page while the frame waits. Checks the contract and that the timeline's fps is the composition's.                                                                                                                                                                  |
| `useTimeline()`, `useOptionalTimeline()`                                | The `TimelineApi` (the second returns null without a provider)                                                                                                                                                                                                                                                                      |
| `TimelineApi`                                                           | `frameOfBeat`, `exactFrameOfBeat`, `timeOfBeat`, `beatAt(frame)`, `beats`, `hitFrames`, `downbeatHitFrames`, `stopFrames`, `drumFrames(filter)`, `syllableFrames`, `tuttiFrames(toleranceSec?)`, `drumsBetween`/`guitarBetween`/`syllablesBetween`, `envelopeAt(stem, frame)`, plus `timeline`, `meta`, `fps`, `peaks`, `envelopes` |
| `buildTimelineApi(timeline, {peaks?, envelopes?})`                      | The same API, pure (Node scripts)                                                                                                                                                                                                                                                                                                   |
| `loadTimeline(path, {writtenBy?})`                                      | Fetch and check timeline.json                                                                                                                                                                                                                                                                                                       |
| `beatGrid(timeline)`                                                    | Bar/beat to frames and seconds, and `beatAt(frame)`, pure                                                                                                                                                                                                                                                                           |
| `segmentIndexAt`, `segmentIndexOfSong`, `songTimeAt`, `videoTimeOfSong` | Video time ↔ song time through the edit, pure                                                                                                                                                                                                                                                                                      |

The API's tolerances are seconds, whatever the frame rate:
`HIT_TOLERANCE_SEC` (a kick or crash this near a downbeat hits it),
`TUTTI_TOLERANCE_SEC` (the default for `tuttiFrames`), and the stop check's
windows.

## Rules

- Never hand-type seconds for a musical event: ask the timeline.
- The timeline's `fps` is the composition's; build or regenerate it at the
  film's rate.
- Song material (audio, charts, timelines, names) is generated into a
  film's gitignored `public/generated/`; the kit hard-codes no file name.
- `envelopeAt` throws for a stem that is not there instead of reading 0.
- `contract.ts`, `make.ts`, `beatGrid.ts`, `songTime.ts`, `tempo.ts`,
  `validate.ts` and `api.ts` are pure; Node scripts import them.
- The music never imports the clock.
