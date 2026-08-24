# 0126 — Set dynamics and sustains from the piano roll

Status: in-progress

The piano roll can switch a drum note between tom and cymbal and can delete
it, but it cannot set the two **dynamics** flags — `accent` and `ghost`. The
only way to set them today is the `NoteInspector` buttons (`A` / `S`), which
sit in a different panel from the notes.

This plan adds them to the note context menu, makes the piano roll draw them,
and fixes the flag model underneath so the two cannot both be set at once.

## The corpus says ghosts on cymbals are real

The question was whether ghost-on-cymbal is a combination worth supporting, or
a charting mistake to exclude. It is neither rare nor accidental.

Measured with `parseChartFile` over both corpora (78,453 chart folders,
24,262 of which carry a drum track):

| | notes | drum charts with ≥1 |
| --- | ---: | ---: |
| ghost, any lane | 719,549 | 7,159 (29.5%) |
| **ghost on a cymbal** | **96,905** | **1,870 (7.7%)** |
| ghost on a tom | 622,494 | — |
| ghost on a kick | 150 | — |
| **accent on a cymbal** | **425,961** | **6,417 (26.4%)** |

Ghost-on-cymbal appears in charts by charters whose other work is careful —
`tomato`, `Pix_`, `MathRabelo`, `Bounty`, `Teffy` — and at volume: 671 in one
chart, 375 in another.

### And not only on the hi-hat

The obvious follow-up was whether this is really a hi-hat idiom that happens
to be spelled as a cymbal flag. It is not. Splitting by cymbal color — yellow
is the hi-hat, blue the ride, green the crash, per `resolveInstrument`
(`lib/drum-mapping/noteToInstrument.ts:211-219`):

| | hi-hat | ride | crash |
| --- | ---: | ---: | ---: |
| ghost notes | 58,546 | 23,529 | 14,830 |
| charts with ≥1 ghost | 1,265 | 811 | 618 |
| accent notes | 303,432 | 92,001 | 30,528 |
| charts with ≥1 accent | 5,480 | 3,103 | 1,322 |

The hi-hat is the plurality but nowhere near the whole story: 39% of ghosted
cymbal notes and 29% of accented ones are on a ride or a crash. Ghosted ride
notes are standard notation for soft bow strokes, and one chart carries 230 of
them. **No restriction by cymbal color.**

### The kick is the exception

Ghost on a **kick** is the one combination the corpus does not support: 150
notes across all 78,453 chart folders, against 96,905 ghosts on cymbals alone.
A kick pedal has no ghosted or accented articulation to play, so those 150 are
charting slips, not notation.

**Decision: `accent` and `ghost` carry an `appliesTo` of every hand-struck
pad, excluding the kick.** The editor will not set a dynamic on a kick, and
`legalizeFlagBits` strips one that a chart already has the first time the note
is edited. Every other lane — every pad, every cymbal color — is allowed.

One existing behavior changes as a consequence: `ToggleKickCommand` converting
an accented pad note into a kick now drops the accent along with the cymbal
flag, for the same reason it already drops the cymbal flag.

## The highway already renders both; the piano roll does not

`loadNoteTextures` (`lib/preview/highway/TextureManager.ts:958-980`) builds its
sprite key from `typeFlag | dynamicFlag | spFlag` and reads `dynamic` off
`interpretDrumNote` (`lib/drum-mapping/noteToInstrument.ts:163-168`).
`loadCymbalTextures` loads the `-ghost` and `-accent` variants for every cymbal
color. So a flag set in this plan shows up on the 3D highway with no renderer
work at all.

The piano roll is the gap. `extractPianoRollNotes`
(`components/chart-editor/piano-roll/notes.ts:112-139`) deliberately omits
`flags` for drum notes — `PianoRollNote.flags` is documented as guitar/bass
only — so `draw.ts` cannot know a note's dynamic even if it wanted to paint it.

## Accent and ghost are mutually exclusive

YARG models a drum note's dynamic as one enum value, not two bits:

```csharp
// YARG.Core/Chart/Notes/DrumNote.cs:120-125
public enum DrumNoteType { Neutral, Ghost, Accent }
```

`interpretDrumNote` already collapses the two bits the same way (`ghost` wins
if both are set). But `toggleFlagBits`
(`lib/chart-edit/entities/notes.ts:203-234`) treats them as independent bits,
so the editor can currently write a note that is both — a state no consumer
can represent and that round-trips to whichever flag the reader checks first.

`toggleFlagBits` already has the machinery for this: the guitar/bass branch
implements exactly "one of N, or none" over `strum|hopo|tap`. That branch is
hard-coded to guitar and bass. Generalize it.

### `exclusiveGroup` on `FlagBinding`

Add one optional field to `FlagBinding`
(`lib/chart-edit/instruments/types.ts:82-108`):

```ts
/** Name of the mutually-exclusive set this flag belongs to. At most one
 *  flag per group is ever set on a note; setting a second clears the
 *  first, and clearing the active one leaves the group empty. Distinct
 *  from `complementFlag`, which is a two-state pair where exactly one
 *  side is always set. */
exclusiveGroup?: string;
```

Then `'dynamics'` on drums' `accent` and `ghost`, and `'technique'` on
five-fret's `strum`/`hopo`/`tap` — which lets the hard-coded guitar/bass
branches in `toggleFlagBits` and `ToggleFlagCommand` become one schema-driven
path rather than two instrument checks.

**Do not** put `cymbal`/`tom` in a group. They are a `complementFlag` pair:
exactly one is always set, which is a different rule.

## What to build

### 1. `exclusiveGroup`, and one exclusion path

- `FlagBinding.exclusiveGroup` as above; set it on drums' `accent`/`ghost`
  and five-fret's `strum`/`hopo`/`tap`. Give the two drum dynamics an
  `appliesTo` of the four hand-struck pads, per the kick decision above.
- In `toggleFlagBits`, replace the `instrument === 'guitar' || 'bass'` branch
  with a group lookup: mask = OR of every bit in the binding's group; set →
  `(bits & ~mask) | bit`; clearing the active one → `bits & ~mask`.
- Same substitution in `ToggleFlagCommand`'s chord-level branch
  (`components/chart-editor/commands.ts:587-614`). Guitar technique stays
  chord-level — that is a separate property from exclusivity, so keep the
  existing "apply across the tick's group" behavior keyed on the instrument,
  not on the group.
- `legalizeFlagBits` must drop all but the highest-precedence bit in a group
  when a malformed chart supplies two, matching `interpretDrumNote`'s
  ghost-over-accent order.

### 2. `SetFlagCommand`

`ToggleFlagCommand` is wrong for a multi-note "Add accent": on a mixed
selection it flips each note independently and inverts the ones that already
had it. The menu items in §4 are set/clear, not toggle.

Add `SetFlagCommand(noteIds, flag, on, trackKey, schema)` beside it in
`commands.ts`. It writes the same bits `toggleFlagBits` would produce for the
requested end state — including the group exclusion — so a set and a toggle
that land on the same state produce the same document.

Keep `ToggleFlagCommand`: the `A`/`S` hotkeys and the `NoteInspector` buttons
are genuine toggles.

### 3. Dynamics in the piano-roll projection

- Widen `extractPianoRollNotes` to carry the dynamic for drums. Prefer a
  narrow `dynamic: 'none' | 'ghost' | 'accent'` field over exposing the raw
  `flags` mask, so the drum projection keeps its documented shape and the
  piano roll does not grow a second way to read flags. Derive it the same way
  `interpretDrumNote` does.
- `notes.test.ts:41` asserts drum notes have `flags === undefined`. That
  assertion stays true under the `dynamic` field; do not widen it to allow a
  raw mask.

### 4. Context-menu items

In `buildNoteMenu` (`PianoRollTimeline.tsx:4066-4162`), between the cymbal
switch and Delete. The rule the menu follows, for a selection of any size:

- **"Add accent"** shows when **any** selected note lacks `accent`.
- **"Remove accent"** shows when **any** selected note has `accent`.
- Same two for ghost.

Kicks are filtered out of the selection before any of this is decided, and
out of the ids the command receives, so a kick in a mixed selection is simply
untouched and a kick-only selection gets no dynamics items at all. The gate is
a new `PianoRollLane.dynamicsOk`, derived from the binding's `appliesTo` the
same way `cymbalOk` already is.

A mixed selection therefore shows both Add and Remove for that flag, which is
what makes each one reachable. A uniform selection shows exactly one.

Because the flags are exclusive, "Add accent" on a ghosted note clears the
ghost — the group rule in §1 handles this with no extra menu logic.

### 4b. A sustain item for five-fret

The same menu gains **"Add sustain" / "Remove sustain"** on any schema with
`supportsSustain` (guitar and bass), under the same any-lacks / any-has rule.

Sustain is a *length*, not an articulation, so it sits outside the
mutually-exclusive technique list and combines with any of them.

**"Add sustain" writes two beats** — `resolution * 2`, a half note in 4/4 —
and it is deliberately not the snap division. The menu item promises one
length and should give that length whatever the snap control happens to read;
the drag-resize is the tool for a tail you want to pick by eye. Because the
tail is absolute rather than a delta, Add stays on offer for an
already-sustained selection at some other length, since that is the only way
to normalize ragged hand-dragged tails to the standard one.

This needs `SetNoteLengthCommand`, for the same reason §2 needs
`SetFlagCommand`: `ResizeNotesCommand` applies a delta, which is right for a
drag and wrong for a menu item that promises a specific length — over a
ragged selection a delta leaves it just as ragged.

**No clamping against the next note.** A two-beat tail will often overlap the
next note on the same fret. The drag-resize already permits that, so the menu
matches it rather than silently handing back a shorter tail than the item
promised.

Drop `flam` and `doubleKick` from the menu. `flam` is chord-level and
`doubleKick` is kick-only; both stay in the `NoteInspector`, which already
shows chord and lane state. This plan is about the two per-note dynamics.

### 5. Piano-roll glyphs

`paintGlyph` (`draw.ts:156-168`) takes `isCymbal` and paints a triangle or a
rounded rect. Give it the dynamic too:

- **ghost** — same shape at ~0.7 scale, ~55% alpha. Reads as "quieter".
- **accent** — full shape plus a 1.5px white outline. Reads as "louder".
- **none** — unchanged, pixel-identical to today.

The add-mode ghost preview calls the same painter (`draw.ts:417`), so a
prospective note keeps matching a real one.

Note the name collision: `draw.ts` already uses "ghost" for the add-mode
preview and for dashed drag origin lines. Name the new parameter `dynamic`,
not `ghost`.

## Tests

- `lib/chart-edit/__tests__/entities.test.ts` — setting `accent` on a ghosted
  note clears `ghost` and vice versa; toggling the active one leaves neither;
  `legalizeFlagBits` collapses a both-set mask to `ghost`; guitar technique
  exclusivity still holds through the generalized path.
- A `commands` test that `SetFlagCommand(…, on: true)` over a mixed selection
  ends with every note flagged, and does not invert the already-flagged ones.
- A piano-roll menu test for the four visibility rules in §4, including the
  mixed selection that shows both Add and Remove.
- Sustain: the tail scales with `resolution` and not with the snap division;
  Add stays offered for an already-sustained note at a non-standard length;
  `SetNoteLengthCommand` drives a ragged selection to one length and is a
  no-op on a schema without `supportsSustain`.
- Per `feedback_unit_tests_for_edge_cases`: a `chart-edit` round-trip test for
  a ghosted cymbal in every cymbal color, asserting the ghost and the cymbal
  flag both survive `writeChartFolder → parseChartFile` — they are separate
  modifier events on one tick in the `.chart` format, so nothing guarantees it
  a priori.
- Kick legality: `setFlagBits` refuses a dynamic on a kick on both drum
  schemas, `legalizeFlagBits` strips one without disturbing `doubleKick`, and
  `lanesForSchema` reports `dynamicsOk: false` for the kick lane only.

## Out of scope

- Highway textures. Already working; plan 0069 catalogued the gaps in the
  baked set (no square accent/ghost variants, static ghost frame) and decided
  to ship nothing. Unchanged here.
- Velocity-based dynamics import beyond what scan-chart already resolves.
- A `dynamics` column in the chart-assist sidebar.
