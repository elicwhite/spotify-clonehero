# Plan 0067: Thread the active InstrumentSchema through all note-mutation paths

> **Origin:** follow-up gap from plans 0037/0038 (found during 0038 browser
> validation). Note *rendering* is schema-driven everywhere; note *mutation*
> is still pinned to `drums4LaneSchema` at every entry point, so editing
> notes on `/guitar-edit` writes or moves drum-typed notes.

## Findings (verified 2026-07-20, with cites)

The generic engine already exists — `lib/chart-edit/entities/notes.ts` has
schema-parameterized `typeToLane` / `laneToType` / `shiftLane` /
`defaultFlagBits` / `padLaneRange` / `parseSchemaNoteId`, and
`AddNoteCommand` takes a schema param. The bug is that callers either omit
the schema (drum default) or import the drum-bound wrappers from
`commands.ts:1183-1220`. Five sites:

1. **`lib/chart-edit/entities/index.ts` noteHandler** — `move()` parses ids
   and moves with `drums4LaneSchema` pinned (`:200-212`, and the comment at
   `:163-167` admits the pin). This breaks `MoveEntitiesCommand('note', …)`
   for every consumer at once (highway SelectMoveTool drag + piano-roll note
   drag). **Failure is silent and wrong, not loud:** drum and guitar lane
   names overlap (`green/red/yellow/blue`), so a guitar "green" note parses
   fine under the drum schema and lane-moves with *drum* lane ordering,
   while `orange`/`open` notes fail `parseSchemaNoteId`'s
   lane-membership check (`notes.ts:50`) and silently refuse to move.
2. **`components/chart-editor/tools/tools.ts`** — the 0038 tool registry:
   drag-anchor parse via `parseSchemaNoteId(entity.id, drums4LaneSchema)`
   (`:121-124`) and `PlaceNoteTool`'s `prospectiveNoteAt(evt.lane, evt.tick)`
   with no schema arg (`:284`) + `AddNoteCommand` without schema (`:286`).
   `ToolContext` was designed (plan 0038) to carry `schema` but doesn't use
   it here.
3. **`components/chart-editor/piano-roll/PianoRollTimeline.tsx`** — the
   scene already computes the correct schema (`:706`,
   `schemaForTrack(activeTrack, parsed.drumType)`) and renders with it, but
   mutation ignores it: click-to-add `prospectiveNoteAt` + `AddNoteCommand`
   without schema (`:1529-1540`); note-drag clamps with drum
   `FIRST_PAD_LANE/LAST_PAD_LANE/KICK_LANE` (`:1751-1753`, preview
   `:2956-2960`); marquee converts lanes with drum `laneToType` (`:1790`).
4. **`components/chart-editor/hooks/useEditorKeyboard.ts`** — place-mode
   lane keys use drum `laneToType`/`defaultFlagsForType`/`getDrumNotes` and
   `AddNoteCommand` without schema (`:509-531`); `LANE_KEY_MAP` is 5 keys,
   guitar needs 6. (The paste path at `:307` already passes `targetSchema` —
   the pattern to copy.)
5. **`components/chart-editor/commands.ts:1183-1220`** — the drum-bound
   wrapper block (`typeToLane`, `laneToType`, `shiftLane`,
   `defaultFlagsForType`, `KICK_LANE`, `FIRST_PAD_LANE`, `LAST_PAD_LANE`)
   is the trap every site above fell into.

## Goal

Editing notes behaves identically on `/drum-edit` and `/guitar-edit`:
place, erase, drag (tick + lane), marquee, and keyboard placement all
operate in the active scope's schema; the drum-bound wrappers are deleted so
the trap can't recur.

## Design

1. **One resolver, threaded everywhere.** Add `selectActiveSchema(state)`
   (or equivalent) next to the EditorSession selectors: resolves
   `schemaForTrack`/`schemaForInstrument` from `activeScope` +
   `parsedChart.drumType`, memoized. PianoRollTimeline's local computation
   (`:706`) hoists to this; a `useActiveSchema()` hook wraps it for
   components.
2. **noteHandler resolves schema from `EntityContext`.** `EntityContext`
   already carries `trackKey`; `listIds`/`locate`/`move` resolve the schema
   from `ctx.trackKey.instrument` + the doc's `drumType` instead of the
   pinned constant. Fixes `MoveEntitiesCommand('note', …)` for all callers.
   Update the pin-acknowledging comment block (`entities/index.ts:160-168`).
3. **`ToolContext.schema` used for real.** Populate it from
   `selectActiveSchema`; SelectMoveTool's anchor parse and PlaceNoteTool's
   prospective/add go through it.
4. **Piano roll mutation uses `scene` schema.** Pass the scene's schema into
   `prospectiveNoteAt`/`AddNoteCommand`; replace the three drum constants
   with `padLaneRange(schema)` + the schema's off-axis lane (kick for drums,
   open for guitar — whatever `padLaneRange` excludes); marquee uses generic
   `laneToType(schema, lane)`.
5. **Keyboard place-mode goes generic.** Generic
   `laneToType(schema)`/`defaultFlagBits(schema)`/`listNotes(track, schema)`;
   pass schema to `AddNoteCommand`; derive lane-key count from
   `schema.lanes.length` (keys 1–6 on guitar).
6. **Delete the wrapper block** in `commands.ts` once callers are migrated
   (no re-export shims; update imports directly).

## Tests

- noteHandler regression: moving an `orange` and an `open` guitar note by
  tick and by lane actually moves it (today: silent no-op), and a `green`
  guitar note lane-shifts in *guitar* lane order.
- Cross-schema mutation parity: place/erase/drag/marquee/keyboard place on
  `guitarSchema` fixtures mirror the existing drum tests.
- Piano-roll drag clamps at guitar's pad-lane boundaries; open behaves like
  kick (no lane axis).
- Drum-page behavior unchanged (existing suites stay green).

## Out of scope

- 5-lane drums wiring (`drumSchemaFor` note in `instruments/drums.ts`) —
  same threading benefits it, but enabling it is its own decision.
- GHLive schema, vocal pitch editing.
