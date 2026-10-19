# 5-fret difficulty golden fixtures

Hand-authored synthetic charts for the Expert guitar/bass intensity calculator
(`lib/chart-difficulty/fretDifficulty.ts`).

## `fret-synthetic-01`

Written by hand for this test. It is not derived from any real chart: every
tempo, time signature, tick and lane in it was chosen to exercise a specific
feature. No corpus data of any kind is checked in here.

`notes.chart` carries a `[Song]` header with placeholder identity (`Resolution`
is 192, which the note ticks are meaningless without), a `[SyncTrack]` with
three tempos and a time-signature change, and Expert guitar (`[ExpertSingle]`)
and Expert bass (`[ExpertDoubleBass]`) tracks. `song.ini` carries placeholder
`name`/`artist`/`charter` only. There is no audio.

### Structure

| Ticks       | Section | Bars    | Tempo | Sig | What it exercises                                                           |
| ----------- | ------- | ------- | ----- | --- | --------------------------------------------------------------------------- |
| 0-1535      | Intro   | 2 @ 4/4 | 100   | 4/4 | Open notes, long sustains, sparse onsets — the low end of the density range |
| 1536-7679   | Verse   | 8 @ 4/4 | 100   | 4/4 | Eighth-note riff, 2-note chords, lane movement, anchor breaks               |
| 7680-10751  | Burst   | 4 @ 4/4 | 132   | 4/4 | Sixteenth runs — `fine_frac` and a `peak_density_p95` well above the mean   |
| 10752-12287 | Tail    | 2 @ 4/4 | 132   | 4/4 | Eighth chords with tap-flagged notes                                        |
| 12288-14015 | Bridge  | 3 @ 3/4 | 132   | 3/4 | Time-signature change, forced HOPOs, taps, an open                          |
| 14016-16319 | Outro   | 3 @ 4/4 | 92    | 4/4 | 2- and 3-note chords with long sustains                                     |

Bass shadows the same sections one lane at a time: mostly single notes with a
handful of two-lane chords, its own sixteenth passages under the burst, and
whole-bar sustains through the outro — the sparser profile the bass constants
were fitted on.

Every one of the eight scored features lands non-degenerately: guitar and bass
both carry chords (`mean_chord_size` above 1), sustains, HOPO/tap notes, fine
subdivisions, and real per-bar anchor and lane movement. Both instruments score
tier 3, mid-scale rather than against a 0 or 6 clamp, so a drift in either
direction fails the test rather than being absorbed by the clip.

## How the expected outputs were produced

The golden values in `__tests__/fretDifficulty.test.ts` come from the
`drum-to-chart` research repo's

```
node analysis/fret_difficulty/parity.mjs <this-repo>/lib/chart-difficulty/__fixtures__/fret-synthetic-01
```

which is the research feature extractor the frozen corpus constants were fitted
with. (That script imports `@eliwhite/scan-chart`; run it from a directory where
that resolves — e.g. copy `parity.mjs` and `features.mjs` into this repo and run
them here.) The shipped TypeScript calculator reproduces every value to twelve
decimal places, so a change to either side that breaks the agreement fails the
test.
