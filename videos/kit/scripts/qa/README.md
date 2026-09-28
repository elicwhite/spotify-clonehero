# scripts/qa

Checks a film must pass: the picture never freezes, copy stays long enough
to read and nothing moves while it is read, and the product highway puts
every note on the strikeline on its frame. Commands below run from
`videos/kit` with `node --import tsx`; each exits 1 when its check fails.

## Motion audit (frozen frames)

```bash
node --import tsx scripts/qa/motionAudit.ts --in <film.mp4> [--range <from-to>] \
  [--threshold 0.35] [--min-run-sec 0.333] [--width 480] [--csv <file>]
```

ffmpeg decodes the film to small grey raw frames (`--width` wide, aspect
kept); each frame's motion is its mean absolute difference from the frame
before, in 0-255 levels. A run where the motion stays under `--threshold`
for at least `--min-run-sec` reads as a frozen frame on screen and is
reported with its frames and times. The frame rate comes from the file.
`--range` limits the search to those frames of the file (inclusive; frame
0 is its first); `--csv` writes every frame's motion. With fewer frame
pairs in the window than a still run needs, the audit fails rather than
passing on nothing.

The threshold depends on the film's look (a dark, sparse frame changes less
per pixel than a busy one under the same camera move) and on `--width`, so
calibrate it per film:

1. Render, at the audit's size and encode, one stretch that should count as
   still (a held frame) and one with the slowest motion you accept (the idle
   drift, say).
2. Run the audit on each with `--csv`, and read the summary's percentiles.
   A held frame reads near 0 (encoder noise: under 0.01 on a CRF 16 H.264
   render). The slow stretch's median is what acceptable motion looks like:
   on a dark UI frame a 1.5 %/s push reads about 0.35, right at the default
   threshold, and a 0.5 %/s push about 0.1, which the default would call
   still.
3. Set `--threshold` between the two, well above the held value, and
   `--min-run-sec` to the longest pause you accept (default a third of a
   second).

The default is 0.35 at 480 px: a picture that always drifts at least
1.5 %/s passes it.

## Pacing audit (reading time)

```bash
node --import tsx scripts/qa/pacingAudit.ts --sheet <film/src/pacing.ts> [--export pacing] \
  [--rules <rules.json|module.ts>] [--rules-export rules]
```

The sheet is the film's `PacingSheet` (`pacing.ts`), imported by Node
directly: keep that module free of React and Remotion imports, as a
storyboard is, so the audit never bundles the film. All frames are global
film frames:

```ts
export const pacing: PacingSheet = {
  fps: 30,
  text: [
    {
      id: 'hook',
      kind: 'headline',
      words: 'Your library is already a setlist.',
      fullyIn: 18,
      out: 90,
    },
  ],
  actions: [
    {id: 'drums-click', at: 610},
    {id: 'rows-cascade', at: 700, holds: false},
  ],
  camera: [{from: 540, to: 570}],
};
```

- `text`: `{id, kind, words, fullyIn, out}`. `words` is the block's text (a
  string or a list of words); the audit counts it, so a count is never
  typed by hand. `fullyIn` is the frame the whole block is on screen,
  `out` the frame it starts to leave.
- `actions`: clicks, flips, panels opening. `holds: false` marks one with no
  result to hold on its own (rows cascading in as a view arrives).
- `camera`: frames where the camera visibly moves (a glide, whip or rack;
  not the slow drift).

The default rules (`PACING_RULES`): the camera settles, the copy lands and
is read, then the UI acts, and every block is sized to its words.

| Rule                        | Default                                                                                                                                                                                                                        |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Reading time from `fullyIn` | headline 0.8 s + 0.3 s per word; callout 0.5 s + words / 3.5; ledger 2.3 s                                                                                                                                                     |
| Longest hold                | reading time + 1.2 s (ids starting `end-` exempt)                                                                                                                                                                              |
| Camera                      | no move overlaps a block's reading window                                                                                                                                                                                      |
| Actions                     | none lands inside a headline's reading window                                                                                                                                                                                  |
| Results                     | an action's result holds 1.0 s before the next headline starts arriving (its words start 0.6 s before it is fully in), and 1.0 s before the next camera move; an action during a move fails; `holds: false` actions are exempt |

`--rules` replaces any of these fields (`reading` merges by kind, so a film
can add a kind or retune one): `{"maxExtraSec": 2, "reading": {"caption":
{"baseSec": 0.5, "perWordSec": 0.25}}}`.

## Highway sync

```bash
node --import tsx scripts/qa/highwaySync.ts --timeline <timeline.json|module.ts> \
  --chart <chart folder> [--export timeline]
```

For every Expert drum and guitar note in the timeline, the note's song time
comes from the chart as the app parses it (scan-chart), and the frame the
highway draws comes from `songTimeAt`, the mapping the kit's product
highway uses. The app places a note at `noteWorldY(noteSec, nowSec)`
(`src/highway/floor.ts`), so it is on the strikeline at the frame that
minimises the distance; that must be the timeline's `frame` for every note.
It reports the largest note-to-frame gap against half a frame. The gallery's
smoke check (a highway frame that is not black, a note on the strikeline at
its time) lives with the highway blocks.

Unit tests: `test/pacing-rules.test.ts`; the still-run detection is in
`test/render-plan.test.ts`, and `test/e2e-audio.test.ts` runs the sync
check on the synthetic chart's soundtrack.
