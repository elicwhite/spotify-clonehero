# 0079 — Chart editor nits, round 5 + song.ini metadata modal

Owner punch list for `/chart-editor` (2026-08-04, second batch), grouped by
file ownership so the work can run in parallel.

## Group A — piano roll

1. **Only visible tracks appear in the stacked list.** The piano roll lists
   collapsed instrument+difficulty rows for tracks that are NOT selected in the
   Chart Matrix. Only Chart-Matrix-visible tracks should be listed.
2. **Loop items on the section-row context menu.** The ruler/section row's
   right-click menu offers "Set repeat loop start" when no start is set (which
   also places an end marker, exactly like pressing A in the sidebar) and the
   matching end item.

## Group B — context menu placement

3. **Flip to fit.** The right-click menu can run off the bottom of the page —
   most visibly on the piano roll's instrument+difficulty list. It must pick its
   open direction from the space actually available.

## Group C — loop playback

4. **Dragging the end flag behind the playhead must still loop.** Set an A/B
   region, drag the end flag to before the current playhead, press play: the
   song runs past the region instead of looping.

## Group D — highway

5. **Drum fret spacing on the hit line.** No longer scrunched, but now slightly
   too far apart. Match the reference screenshot's spacing.

## Group E — Chart Assist

6. **No "Re-" button labels.** Sections' CTA is always "Generate" (the
   existing has-sections warning stays).
7. **Drum transcription CTA is "Run", never disabled** for want of separated
   drum stems. Drum transcription never operates on user-uploaded stems: like
   the tempo map, the pipeline merges the user's original stems (excluding the
   click track), then re-separates that mix with BS-Roformer.
8. **Tempo map copy is less optimistic** about generated tempo-map quality, and
   its "Learn more" reads as written prose rather than the raw talking points it
   currently contains.
9. **"Learn more" copy assumes the reader knows the domain.** Sections' entry
   should say we use LinkSeg (https://github.com/morgan76/LinkSeg) to identify
   song sections with classic Western section names, and that the user may need
   to rename them or add more. Apply the same "don't explain the basics" edit
   across every "Learn more".

## Group F — song.ini metadata modal (own agent)

10. The `Title by Artist - Charted by Charter` header element opens a modal for
    editing what gets written to `song.ini`: name/artist/charter as today, plus
    Album, Genre, Year, and per-instrument difficulty for the instruments the
    chart includes.
11. Difficulty is where the automated tooling lands. Port the deterministic
    Expert-drum difficulty calculator from
    `~/projects/drum-to-chart/analysis/drum_difficulty/` and surface a
    recommendation.
12. Prototype **three** distinct UIs for presenting recommended difficulty,
    rendered sequentially in the modal for comparison. They must each answer the
    edge cases: the chart already carries a difficulty we agree with; one we
    disagree with; and a user-set difficulty that the chart has since drifted
    away from.

## Verification

`pnpm test`, `pnpm typecheck`, prettier, plus browser QA on `/chart-editor`.
