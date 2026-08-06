# 0089 — Drag notes across lanes, including kick

## What the user asked for

1. Select a run of notes and drag them to another lane — e.g. a run of blue
   cymbals to yellow. On release, a moved note that lands exactly on an
   existing note in that lane dedupes with it.
2. A note can be dragged onto kick. Today it can't.

## Why it isn't a one-liner

### (a) Lane change is locked for multi-selections

`computeNoteDragDelta` (`components/chart-editor/editing/gestures.ts`) sets
`laneLocked = selectionSize > 1`, so a multi-note drag moves in time only.
That is the whole feature in item 1.

Lifting the lock needs a **group clamp**. Today `laneDelta` is derived from
the anchor alone and each note independently clamps inside `shiftLane`. With
one note that's the same thing; with several it silently _squashes_ the
selection — drag a red+yellow pair down far enough and both pile onto green,
losing the interval. The clamp has to be computed from the selection's own
lane span so the shape is preserved and the drag just stops at the edge.

### (b) Kick is excluded from the lane axis by schema

`drums4LaneSchema.laneShiftExcludes = [noteTypes.kick]`, consumed by
`padLaneRange` and `shiftLane`. It is deliberate: kick spans the full highway
instead of sitting in a pad lane.

The exclusion is shared with the **arrow-key** lane nudge, and the two
gestures do not want the same rule:

- An arrow key is a _relative_ nudge. Sliding into kick because you held Down
  one beat too long is an accident.
- A drag _points at_ a lane. Releasing over the kick row is unambiguous.

So the exclusion stays for arrow keys and stops applying to drags, rather
than being removed from the schema. Same reasoning covers guitar's open note,
which rides the identical code path.

### (c) The ordering hazard — the real reason this is a plan

`MoveEntitiesCommand.execute` loops `handler.move` per id, and each `moveNote`
does `removeNote` then `addNote` against the doc _as mutated so far_. Notes
are identified by `(tick, type)`, so a note that moves onto a slot another
selected note has not vacated yet collides mid-loop.

Lane dragging makes this reachable constantly. Drag `{blue@100, yellow@100}`
up one lane: blue→yellow lands on yellow@100 while yellow@100 is still there
and still the id the next iteration will look up. The second move then either
finds the wrong note or no note.

`addNote` compounds it: it pushes into the group at that tick **without
checking whether that type is already present**, so the intermediate state can
hold two identical notes.

Fix: make a note move **batch-resolved** — read every source note from the
original state, remove them all, then add every destination. Dedupe falls out
of the add phase rather than being a separate pass.

## Plan

1. `lib/chart-edit/entities/notes.ts`
   - `shiftLane` gains an axis option so a drag can address every lane
     (`'all'`) while arrow keys keep the pad-only axis (`'pads'`, default).
   - New `moveNotes` (plural): resolves all sources against the original
     track, removes them, then adds all destinations. Two destinations that
     collide on `(tick, type)` collapse to one; the moved note's flags win,
     since that is the note the user was manipulating.
   - `addNote` refuses to create a second note of the same `(tick, type)` —
     an invalid state in `.chart` regardless of how it was reached.
2. `lib/chart-edit/entities/index.ts` — note handler exposes a batch `move`.
3. `components/chart-editor/commands.ts` — `MoveEntitiesCommand` uses the
   batch path for notes.
4. `components/chart-editor/editing/gestures.ts` — `computeNoteDragDelta`
   takes the selection's lane span instead of just its size; group clamp;
   drags address the full lane axis.
5. Both callsites (`PianoRollTimeline.tsx`, `tools/tools.ts`) pass the span.

## Tests

- Multi-note drag preserves the interval between selected notes.
- Group clamp stops at the edge instead of squashing.
- Drag onto kick, and off kick, both work; arrow keys still refuse.
- `{blue@100, yellow@100}` shifted one lane produces two notes, not one or
  three (the ordering hazard, as a direct regression test).
- Landing exactly on an existing note dedupes to one, keeping the dragged
  note's flags.
- Guitar open note behaves like kick on the same paths.
