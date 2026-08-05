# 0081 — Chart editor nits, round 6 + difficulty suggestions

Owner punch list for `/chart-editor` (2026-08-04/05, third and fourth batches).

## Highway frets

1. **Inner ring takes the lane colour.** The button reads as an outer coloured
   ring, the silver bezel, then a second ring of the same colour around the
   dome. `inner_color` was drawn beneath `head`, which is opaque across its
   whole silhouette, so tinting it had no effect; the fix is render order.
2. **No pick arc on drums.** The raised dark arc behind the button belongs to
   the fretted instruments only.
3. **Pad spacing.** `PAD_X_STEP` set from the fret art's measured visible ring
   width rather than its sprite box.

## Difficulty suggestions

4. **Drums** use the frozen upstream calculator from
   `~/projects/drum-to-chart/analysis/drum_difficulty/`, ported to TypeScript
   and verified by execution against the Python.
5. **Guitar and bass** have no upstream equivalent (the repo's
   `guitar_reduction_*` work is difficulty reduction scored by `edit_rate`, not
   a `song.ini` estimator). Their constants were fitted for this project
   against the local 78,456-chart corpus, following the drum plan's evaluation
   contract. The fitting pipeline lives in the research repo at
   `~/projects/drum-to-chart/analysis/fret_difficulty/`, not here.
6. **Suggestion chip** is the shipped presentation, with copy naming the top
   contributing factors. Factor names are neutral dimensions ("strumming
   speed"), not claims about the chart.

## Song Details modal

7. Bass difficulty was not being detected from an existing `song.ini`.
8. Stripped to pills plus factor sentences: no preamble, no per-row state
   lines, no bass caveat, no Drums or Keys rows.
9. `song.ini` fields the editor does not expose (keys difficulty, `icon`,
   custom keys) must survive an export byte-identical.

## Sidebar and chrome

10. **Sidebar type up 1px** throughout.
11. **Export** is two large side-by-side buttons, `.zip` and `.sng`, instead of
    a format dropdown.

## Copy

12. **No em dashes** anywhere in this tool's user-facing copy.
13. **Sections Learn More** links LinkSeg properly, drops the "hears
    boundaries, not meaning" claim and the entire second paragraph.
14. **Leading silence** drops the "charts built from a song..." sentence.
15. **Drum transcription** recommends settling the tempo map first, or
    re-running after tempo edits.

## Standing rules adopted

- No script checked into this repo hard-codes a filesystem path. Corpus-fitting
  pipelines live in the research repo; this repo carries frozen constants plus
  provenance.

## Verification

`pnpm test`, `pnpm typecheck`, prettier, plus browser QA on `/chart-editor`.
