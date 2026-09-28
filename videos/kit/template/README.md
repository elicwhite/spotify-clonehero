# {{FILM_TITLE}}

A product video made with the video kit. See `videos/README.md` for the
whole pipeline and the kit's blocks.

## Commands

Run these in this folder. Anything that opens Chrome (studio, stills,
renders) needs a local port, and in a sandboxed shell the sandbox disabled.

| Command                  | What it does                                                                                                                      |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm studio`            | Remotion Studio: the film (`Film`) and each scene on its own (`Scenes/scene-*`)                                                   |
| `pnpm typecheck`         | TypeScript over `src/`                                                                                                            |
| `pnpm still --frame=150` | One still of the film to `out/still.png`                                                                                          |
| `pnpm pacing`            | The pacing audit of `src/pacing.ts`: every line is on screen long enough to read, and no longer                                   |
| `pnpm render`            | The picture, muted, in chunks with retries, to `out/picture.mp4` (add `--scale 2` to supersample, `--chunk-size 600`, `--resume`) |

With a soundtrack (all paths are the film's own; nothing in
`public/generated/` is committed):

```sh
# The soundtrack and its timeline, from a chart folder and an edit config
node --import tsx node_modules/@musiccharts/video-kit/scripts/audio/soundtrack.ts \
  --config src/soundtrack.config.ts --chart <chart folder> --out public/generated

# The delivery files: master, web and 720p variants, poster first
node --import tsx node_modules/@musiccharts/video-kit/scripts/render/deliver.ts \
  --picture out/picture.mp4 --mix public/generated/audio/mix.wav \
  --out-dir out/final --name {{FILM_SLUG}} [--poster out/poster.mp4]
```

Then `src/music.ts` exports the generated timeline instead of the tempo
bed, so the storyboard, the cues and the pacing sheet all read the song's
own beats, and names the soundtrack's files by their paths in `public/`:

```ts
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

`src/Film.tsx` needs no change. Its one `Music` wrapper gives the film and
every scene preview the same timeline and curves, and both play
`soundtrack.mix` (the film from its `FilmClock`, a preview from its
`SceneWindow`), so a scene that reads `tl.envelopeAt` renders the same in
its preview as in the film:

```tsx
const Music: React.FC<{children: ReactNode}> = ({children}) => (
  <TimelineProvider
    timeline={timeline}
    peaks={soundtrack.peaks}
    envelopes={soundtrack.envelopes}>
    {children}
  </TimelineProvider>
);

// Film:    <Music><FilmClock src={soundtrack.mix}>...scenes...</FilmClock></Music>
// Preview: <Music><SceneWindow {...board.window(id)} audio={soundtrack.mix}>...</SceneWindow></Music>
```

The film now typechecks and bundles only with its `public/generated/` in
place: a fresh checkout runs the soundtrack build first.

## Layout

| File                           | What it holds                                                                                             |
| ------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `productApp.config.ts`         | Where the app is; read by remotion.config.ts and the kit's tools                                          |
| `src/format.ts`                | The film's frame rate and size                                                                            |
| `src/music.ts`                 | The timeline and the soundtrack's files: a 120 BPM tempo bed and no files until the film has a soundtrack |
| `src/storyboard.ts`            | Scene windows on the timeline's bars, and the film's length; Node tools load it too                       |
| `src/cues.ts`                  | The copy and every cue frame, from the timeline                                                           |
| `src/pacing.ts`                | The pacing sheet, from the same cues                                                                      |
| `src/scenes/`                  | One component per scene                                                                                   |
| `src/Film.tsx`, `src/Root.tsx` | The film, its scene previews and the `Music` wrapper they share; the compositions                         |
| `public/product`               | A link to the app's `public/assets`: the product's own art                                                |
| `public/generated/`            | Song material the scripts write; gitignored                                                               |
