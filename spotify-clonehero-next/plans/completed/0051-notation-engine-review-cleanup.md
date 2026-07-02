# 0051 — Notation engine structural cleanup (post-review of 0050)

Code-quality review of commit 79b6f6a flagged structural problems in the
sightkick notation-engine port. This plan applies the fixes; behavior is
unchanged (same 1174-test suite passes untouched except one import line).

## Changes

1. **Delete `PositionedNote`.** The `{note, onset}` wrapper existed only to
   carry the original onset out of `buildGrid` so `ms` could be stamped later.
   Replaced with `Note.sourceTick` (the hit's original chart tick, set at
   construction); the parser stamps `ms` in one pass at the end. Removes the
   wrapper interface, the `.note.` indirection through the candidate machinery,
   and the cross-function mutation.
2. **`Head` model.** `Onset`'s four parallel structures (`keys`, `idOf`,
   `accents`, `ghosts`) plus two more for grace chords collapse into
   `Head {key, id, accent, ghost}` with `Onset {tick, heads, graceChords?}`.
   One conversion at the `buildGrid` boundary produces the VexFlow-facing
   parallel arrays on `Note` (which keeps its shape — consumers unchanged).
3. **Split the 1,181-line file** into:
   - `notation/types.ts` — `Head`, `Note`, `TupletMeta`
   - `notation/durations.ts` — pure written-duration math (naming, chunking,
     rest re-grouping)
   - `notation/engine.ts` — the candidate-search engine + `notateMeasure`
   - `convertToVexflow.ts` — chart integration: onset collection, measures,
     bucketing, public `Measure`/`Beat` types (295 lines)
     Imports updated directly (no re-export shims); dropped the unused
     `DrumNoteInstrument` re-export.
4. **Renderer type boundary.** Removed the `@ts-ignore` stash-and-cast of
   `ms`/`sourceNote` onto VexFlow `StaveNote`s; the post-draw loop pairs drawn
   notes with source notes by shared index. Marker collection deduplicated via
   a local `pushMarker`.
5. **`measuresAreEqual` → `measureRenderKey`.** Repeat detection compares one
   canonical JSON projection per measure instead of four `JSON.stringify`
   calls per note pair plus per-note tuplet `findIndex`.
6. **Deleted the `meters` parallel array** in the parser; meters derive from
   `measure.timeSig` via `makeMeter` (cheap, pure).

## Done when

- `pnpm test`, `pnpm typecheck`, eslint/prettier green; no file over 1k lines.
- Pneuma/Deathwalker render identically in the browser.
