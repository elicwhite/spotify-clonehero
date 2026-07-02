# 0050 — Port sightkick notation engine fixes into convertToVexflow/renderVexflow

## Background

Our sheet-music renderer (`app/sheet-music/[slug]/convertToVexflow.ts` +
`renderVexflow.ts`) was copied from tonygoldcrest/drum-hero in Feb 2025. The
original author has since rewritten it in ~/projects/sightkick
(`src/chart-parser/parser.ts` + `renderer.ts`) fixing many notation bugs. We
want those fixes, while keeping all features our copy has grown.

## What sightkick fixed (to port)

1. **Notation engine rewrite** — the old per-note duration-map approach only
   recognizes gaps that exactly match a table (ppq/3, ppq/6, …), pads with
   subset-sum rests, and iterates tick-by-tick (O(ticks)). The new engine
   notates each beat by generating candidate grids (straight subdivisions,
   triplets, quintuplets, septuplets, recursive half-splits) and picking the
   lowest `complexity + λ·distortion`. Off-grid/humanized charts get readable,
   correct notation; exact charts reproduce literally.
2. **Triplet/tuplet correctness** — explicit `tupletId` on notes plus
   `TupletMeta {numNotes, notesOccupied}` per measure, rendered with
   `num_notes`/`notes_occupied`. Replaces the renderer's guess of grouping
   consecutive `isTriplet` notes into threes (broke on rests inside triplets,
   quintuplets, partial groups).
3. **Flams / never drop a hit** — near-coincident hits in one slot collapse to
   a chord (different drums) or a grace note flam (same drum).
4. **Accents & ghosts** ("Render accidentals") — accent glyph above/beside the
   head, parentheses around ghost heads.
5. **Compound meters** (6/8, 9/8, 12/8) — dotted-beat measures, compound
   divisor table, beam groups of 3, correct measure lengths.
6. **Rest handling fixes** — legal rest values (plain + single-dotted) aligned
   to their own grid, runs of rests merged, half-measure guard so beats 2–3 of
   4/4 don't merge into a mid-bar half rest; empty measure = centred whole
   rest.
7. **Beat bucketing tolerance** — onsets just before a beat/measure boundary
   (negative humanization) snap into the next beat instead of producing a
   64th-note mess.
8. **Double kick** on its own staff position (e/4) vs normal kick (f/4).
9. **`dots: number`** replaces `dotted: boolean`; duration string is built by
   the renderer (`d`-repeat + `r`), fixing dotted-rest durations.
10. Misc: empty `timeSignatures` falls back to 4/4; `endOfTrackTicks` = max
    tick + 1; explicit stem_direction −1.

Not ported (feature, not fix): tempo marks above staves, per-row SVG renderers.

## What ours must keep

- Public API `convertToVexFlow(chart, track): Measure[]`; keys of the
  scan-chart `TimeSignature` object in `Measure.timeSig`.
- `interpretDrumNote()` from `lib/drum-mapping/` as the single source of note
  interpretation (disco flip — sightkick lacks it), extended with the
  double-kick staff position and dynamics from `dynamic`.
- `noteIds` parallel to `notes` (drum-fills overlay), `ms` per note stamped
  from the **original onset tick** (playhead accuracy; regression test
  exists), `startMs/endMs` per measure.
- `Measure.beats` (start/end ticks) for `generateClickTrack`.
- Renderer features: responsive layout + zoom, sections, lyrics, bar numbers,
  practice-mode muting, repeat-measure `RepeatNote`, timePositionMap,
  noteMarkers.

## Steps

1. Rewrite `convertToVexflow.ts` with the ported engine (Onset collection via
   interpretDrumNote carrying per-key note ids and dynamics; measures/meters;
   coincidence resolver; candidate notation; rest merging). New `Note` shape:
   `{notes, noteIds, duration, dots, isRest, tick, ms, tupletId?, graceNotes?,
accents?, ghosts?}`; `Measure` gains `isCompound` + `tuplets`.
2. Update `renderVexflow.ts`: duration string building, dots, tuplet groups
   from metadata, grace notes, ghost parentheses, accent glyphs, compound beam
   groups, stem direction, whole-rest centring; update `measuresAreEqual`.
3. Port sightkick's parser test suite to Jest against our API (+ keep the
   existing ms-preservation regression test).
4. Validate in browser on /sheet-music, /drum-fills practice, /tempo.

## Done when

- `pnpm test` green including ported suite; `pnpm typecheck` green.
- Triplet-heavy and 6/8 charts render correctly in the browser; playhead and
  drum-fills note feedback still line up.
