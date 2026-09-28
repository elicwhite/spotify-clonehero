# clock

Film time: global film frames, scene windows, storyboards, cues, and pulses
on events.

A film is authored in GLOBAL film frames, so a scene reads the same inside
the full film and alone as a preview composition.

```tsx
import {
  defineStoryboard,
  FilmClock,
  SceneWindow,
} from '@musiccharts/video-kit/clock';
import {beatGrid} from '@musiccharts/video-kit/music';
import {timeline} from './music'; // the film's timeline, a value (see music)

// storyboard.ts: scenes on the timeline's bars. Node recorder specs load it too.
const {frameOfBeat: bar} = beatGrid(timeline);
export const board = defineStoryboard([
  {id: 'title', from: bar(0), to: bar(5), bar: 0},
  {id: 'tempo', from: bar(5), to: bar(10), bar: 5},
  {id: 'end', from: bar(10) - 20, to: bar(12), bar: null}, // starts under the last cut
]);

export const Film: React.FC = () => (
  <FilmClock src="generated/audio/mix.wav">
    <SceneWindow {...board.window('title')}>
      <Title />
    </SceneWindow>
    <SceneWindow {...board.window('tempo')}>
      <Tempo />
    </SceneWindow>
  </FilmClock>
);

// A scene's own preview: no FilmClock above, so it is its own clock.
export const TempoPreview: React.FC = () => (
  <SceneWindow {...board.window('tempo')} audio="generated/audio/mix.wav">
    <Tempo />
  </SceneWindow>
);
```

## Time

| Export                                                                 | What it is                                                                                                                      |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `<FilmClock offset? src? volume?>`                                     | Composition frame 0 is film frame `offset`; the soundtrack (a path in `public/`) plays from there. Put it outside any Sequence. |
| `<SceneWindow from durationInFrames name? audio? premountFor? style?>` | Under a FilmClock: a Sequence at `from`. Alone: its own clock starting at `from`, playing `audio` from there.                   |
| `useGlobalFrame()`                                                     | The film frame, at any depth under either                                                                                       |
| `useScene()`                                                           | `{from, durationInFrames, end, frame, local, progress, standalone}` of the enclosing window                                     |
| `<TimeShift by>`                                                       | Renders its children `by` frames later in film time (sampled motion blur is built on it). No audio inside.                      |

## Storyboards and takes

| Export                     | What it is                                                                                                                                                                                                                                                                       |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `defineStoryboard(scenes)` | Scenes `{id, from, to, bar: number \| null, ...extra}`. The board has `scenes`, `durationInFrames` (the film's length: the end of its last scene), `scene(id)`, `window(id)` (SceneWindow props), `sceneBar(id)`, `sceneBeat(frameOfBeat, id)` and `checkStoryboard(frameOfBar)` |
| `oneTake(scenes)`          | A one-take film: scenes `{id, durationInFrames, ...extra}` laid end to end from frame 0, returned as a storyboard (every scene off the bar grid)                                                                                                                                 |

`sceneBeat(tl.frameOfBeat, 'tempo')(1, 2)` is bar 1, beat 2 counted from the
scene's first downbeat, so cues follow any new edit of the music.
`checkStoryboard(bar => tl.frameOfBeat(bar))` lists every bar-aligned scene
whose `from` is not on its bar; the template fails its render on any.

## Events, pulses and cues

An event list is a sorted array of frames (every `TimelineApi` frame list is
one; `lowerBound` and `sortedUnique` live in [motion](../motion/README.md)).

| Export                                                                                  | What it is                                                                                                                               |
| --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `framesSince`, `framesUntil`, `lastEventIndex`, `nextEvent`, `prevEvent`                | Where a frame sits among events                                                                                                          |
| `decayPulse(since, decayFrames, power?)`, `pulseAt(events, frame, decayFrames, power?)` | 1 on an event, decaying to exactly 0                                                                                                     |
| `anticipation(events, frame, leadFrames, power?)`                                       | Rises to 1 on the next event                                                                                                             |
| `useHitPulse(kind \| frames, decaySec?, power?)`                                        | A pulse on the timeline's hits (`'kick'`, `'snare'`, `'crash'`, `'any'`) or any frame list; `decaySec` defaults to the `kickDecay` token |
| `landOn(frames, lead)`                                                                  | Start frames that make fast reveals arrive on the given frames                                                                           |
| `snapToEvent(target, events, maxFrames)`                                                | The event nearest `target` within `maxFrames` (ties go earlier), else `target`                                                           |

```ts
const beat = board.sceneBeat(tl.frameOfBeat, 'title');
// The band's entry: the hit near the scene's second downbeat, or the downbeat itself.
const slam = snapToEvent(beat(1), tl.downbeatHitFrames, 2);
const kick = useHitPulse('kick'); // 0..1, multiply by the accent size
```

## Rules

- Every frame is a pure function of the global film frame: no wall clock,
  no scene-local state for motion that crosses a cut.
- Time points are film frames; durations passed to functions and components
  are frames; a duration in seconds carries `Sec` (`decaySec`).
- Musical cues come from the timeline (`frameOfBeat`, hit frames), never
  typed seconds; a storyboard's frames come from, or are checked against,
  its bars.
- `storyboard.ts` and `oneTake.ts` keep no runtime imports beyond each
  other, so Node tools load them.
- A one-take film derives scene starts from durations; never type them.
- The clock reads the music (pulses on hits); the music never imports the
  clock.
