# Plan 0067: Thread the active InstrumentSchema through all note-mutation paths

> **Origin:** follow-up gap from plans 0037/0038 (found during 0038 browser
> validation). Note _rendering_ is schema-driven everywhere; note _mutation_
> is still pinned to `drums4LaneSchema` at every entry point.
> **Revised 2026-07-20** after contrarian review: corrected the failure-mode
> analysis, added four missed mutation surfaces, the highway-geometry
> blocker, and the sustain scope decision.

## Findings (verified, with cites)

The generic engine already exists — `lib/chart-edit/entities/notes.ts` has
schema-parameterized `typeToLane` / `laneToType` / `shiftLane` /
`defaultFlagBits` / `padLaneRange` / `parseSchemaNoteId`, and
`AddNoteCommand` takes a schema param. Threading is also already ~40% done:
paste passes a schema (`useEditorKeyboard.ts:284-308`), cut uses
`listNotes(track, schema)` (`:243-246`), and `MoveEntitiesCommand` carries an
`EntityContext` from every call site. The pinned sites:

1. **`lib/chart-edit/entities/index.ts` noteHandler** — `move()` parses ids
   with `drums4LaneSchema` pinned (`:200-216`; comment at `:163-167` admits
   it). Drum and guitar **NoteType names do not overlap**
   (`redDrum/greenDrum/…` vs `green/red/…`), so every guitar note id fails
   `parseSchemaNoteId`'s lane-membership check (`notes.ts:50`) → **all
   guitar note moves are total silent no-ops** (highway SelectMoveTool drag
   and piano-roll drag alike).
2. **`tools/tools.ts`** — drag-anchor parse via
   `parseSchemaNoteId(id, drums4LaneSchema)` (`:121-124`);
   `PlaceNoteTool`'s `prospectiveNoteAt` + `AddNoteCommand` without schema
   (`:284-291`). `ToolContext` has **no schema field** to use
   (`tools/types.ts:77-95`) and types `activeNotes: DrumNote[]` (`:81`).
3. **`PianoRollTimeline.tsx`** — computes the correct schema for rendering
   (`:706`) but mutation ignores it: click-to-add without schema
   (`:1529-1540`); drag clamped by drum
   `FIRST_PAD_LANE/LAST_PAD_LANE/KICK_LANE` (`:1751-1753`, `:2956-2960`);
   marquee via drum `laneToType` (`:1790`); `ToggleFlagCommand` without
   schema (`:2269`).
4. **`useEditorKeyboard.ts`** — place-mode lane keys via drum wrappers +
   `AddNoteCommand` without schema (`:509-531`); `Mod+A`/select-all uses
   `getDrumNotes` (`:339`) → select-all on guitar selects nothing;
   `FLAG_SHORTCUT_MAP`/`LANE_KEY_MAP` are module-level constants baked from
   the drum schema (`:78-92`); flag hotkey dispatches `ToggleFlagCommand`
   without schema (`:565`). Paste's `schemaForInstrument` drops `drumType`
   (`:284-288`) — should route through the same resolver as everything else.
5. **Flag/inspector/MCP surfaces** —
   `ToggleFlagCommand` defaults to `drums4LaneSchema` (`commands.ts:420`)
   and **no dispatch site passes a schema** (`NoteInspector.tsx:78`,
   `EditorMCPTools.tsx:367`, plus the two above) → on guitar,
   HOPO/tap/strum flags can't be toggled at all. `NoteInspector.FLAG_ITEMS`
   is pinned to `drums4LaneSchema.flagBindings` and always shows Kick
   (`NoteInspector.tsx:31-32`). `EditorMCPTools` is wholesale drum-pinned
   (`getDrumNotes`, drum label maps, wrapper `typeToLane` —
   `EditorMCPTools.tsx:22-38, 257-263`). `ToggleKickCommand` is inherently
   drum-only (`commands.ts:483-511`) — benign no-op on guitar, but should be
   capability/scope-gated explicitly.
6. **The root trap** — the drum-bound wrapper block
   (`commands.ts:1183-1220`). Its only non-test consumers are tools.ts,
   PianoRollTimeline, and EditorMCPTools — all migrating — so it is
   deletable. The separate `helpers/drum-notes.ts` layer stays:
   `lib/drum-transcription/chart-types.ts:27` and `validate.ts:226` are
   legitimate drum-domain consumers; only _editor_ uses of `getDrumNotes`
   migrate to `listNotes(track, schema)`.

### Blocker discovered in review: highway geometry

`InteractionManager` builds `LANE_X_POSITIONS` at module level from
`drums4LaneSchema` and **throws** for lanes without `worldXOffset`
(`lib/preview/highway/InteractionManager.ts:21-27`; same pattern in
`SceneOverlays.ts:17-22`) — and no guitar lane defines `worldXOffset`.
Highway hit-testing/placement on guitar is structurally impossible today;
schema threading in tools.ts fixes nothing on the highway until guitar lanes
get geometry and InteractionManager/SceneOverlays take a schema instead of a
module constant.

### Schema gap: open is not lane-shift-excluded

`guitarSchema` has no `laneShiftExcludes`; open is lane 0 with
`fullWidth: true` (renderer-only) (`instruments/guitar.ts:72-85`). So
`padLaneRange(guitarSchema)` includes open, and "open behaves like kick"
requires a schema change, plus `computeNoteDragDelta`'s required numeric
`kickLane` (`editing/gestures.ts:53, 82-84`) becoming an optional excluded
lane.

## Goal

Editing notes behaves identically on `/drum-edit` and `/guitar-edit`:
place, erase, drag (tick + lane), marquee, select-all, keyboard placement,
and flag toggling (HOPO/tap/strum) all operate in the active scope's schema,
on both the piano roll and the highway; the drum-bound wrappers are deleted
so the trap can't recur.

## Design

1. **One resolver, threaded everywhere.** `selectActiveSchema(state)` in
   `lib/chart-editor-core/selectors.ts` (precedent: `selectActiveTrack`,
   `selectors.ts:66-72`; state has `chartDoc.parsedChart.drumType` +
   `activeScope`). No memoization needed — schemas are module singletons.
   A `useActiveSchema()` hook wraps it. Paste also routes through it.
   Explicit threading, **not** an ambient active-schema registry: commands
   execute after construction (undo/redo replay), so ambient reads can
   disagree with the scope a command was created under, and chart-review
   mounts multiple editors.
2. **noteHandler resolves schema from `EntityContext`.** All
   `MoveEntitiesCommand('note', …)` sites already pass ctx with `trackKey`;
   the handler has `doc` for `drumType`. Missing ctx → existing null-track
   no-op stays. Update the pin comment (`entities/index.ts:160-168`).
3. **`ToolContext` gains `schema`** (populated from `selectActiveSchema`);
   SelectMoveTool anchor parse and PlaceNoteTool go through it;
   `activeNotes: DrumNote[]` generalizes to schema notes.
4. **Schema change for five-fret:** `laneShiftExcludes: [noteTypes.open]`
   on guitar/bass/keys/rhythm schemas (matching the kick analogy already
   drawn in `instruments/types.ts:58-65`); `computeNoteDragDelta`'s
   `kickLane` → optional `excludedLane`. Piano-roll drag/preview/marquee use
   `padLaneRange(schema)` + generic `laneToType(schema, lane)`.
5. **Flags schema-driven.** `ToggleFlagCommand` gets the schema at all four
   dispatch sites; `NoteInspector` derives `FLAG_ITEMS` from
   `schema.flagBindings` (Kick button only when the schema has a kick
   lane); `FLAG_SHORTCUT_MAP`/`LANE_KEY_MAP` become per-schema derivations
   (schema `defaultKey` fields already carry the key assignments — open
   without a `defaultKey` simply gets no key). `ToggleKickCommand` gated to
   drum scope.
6. **Keyboard:** place-mode + select-all via generic
   `laneToType(schema)`/`defaultFlagBits(schema)`/`listNotes(track,
schema)`; schema passed to `AddNoteCommand`.
7. **`EditorMCPTools` migrates** off `getDrumNotes`/drum label maps to the
   active schema (labels from `schema.lanes[].label`).
8. **Highway geometry:** add `worldXOffset` to the five-fret lanes (values
   from the existing guitar render path in
   `lib/preview/highway/trackToElements.ts`/`NotesManager.ts`);
   `InteractionManager`/`SceneOverlays` take the schema at construction
   instead of reading `drums4LaneSchema` at module level.
9. **Delete the wrapper block** (`commands.ts:1183-1220`) once callers are
   migrated. No re-export shims.

## Forward-compatibility notes (from the chart-preview review, 2026-07-20)

`~/projects/chart-preview` (Geomitron's actively-maintained preview lib)
renders 6-fret GHL and richer drum modifiers; plan 0068 tracks feature
parity. Shape 0067's APIs so 0068 doesn't have to rework them:

- **`InteractionManager`/`SceneOverlays` schema injection (point 8) must
  carry geometry wholesale**, not assume 5/6 evenly-spaced lanes: 6-fret has
  3 visual slots shared by black/white lanes and a narrower highway
  (chart-preview: 0.7 vs drums 0.9 vs five-fret 1.0). Put `highwayWidth` on
  `InstrumentSchema` when adding `worldXOffset` to the five-fret lanes, and
  derive both from the schema in one place.
- **Don't make `parseSchemaNoteId`/selection assume every rendered note is a
  real chart note.** chart-preview synthesizes barre-chord note types
  (custom ids 99991-3) in a pre-render pass; 0068 will want an equivalent
  render-side normalization (disco flip does the same for drums). Mutation
  ids should stay real-note-only; renderer elements may be derived.
- The existing `variant` lane disambiguator (5-lane drums) is the intended
  mechanism for 6-fret's black/white-share-a-slot problem — nothing in 0067
  should collapse lanes by index alone.

## Tests

- noteHandler regression: guitar notes (green, orange, open) move by tick
  and lane (today: total silent no-op); lane-shift uses guitar lane order;
  open refuses lane-shift once `laneShiftExcludes` lands.
- Cross-schema mutation parity: place/erase/drag/marquee/select-all/
  keyboard-place/flag-toggle on `guitarSchema` fixtures mirror drum tests.
- `ToggleFlagCommand` toggles HOPO on a guitar note; NoteInspector shows
  guitar flag items and no Kick button on guitar scope.
- InteractionManager constructed with `guitarSchema` hit-tests all 6 lanes.
- Drum-page behavior unchanged (existing suites stay green).

## Out of scope (explicit)

- **Sustain editing** (drag-to-extend). All add paths hard-code `length: 0`
  and no gesture exists; `supportsSustain` is render-only today. Real gap
  for a guitar editor — deliberately its own follow-up plan, since it's a
  new gesture + command, not schema threading.
- 5-lane drums wiring (`drumSchemaFor`), and the latent `drums5LaneSchema`
  dual-`greenDrum` id ambiguity — the `tick:typeName` id format can't
  distinguish variant lanes; revisit if/when 5-lane ships.
- GHLive schema, vocal pitch editing.

## Status (2026-07-20)

All 9 tasks implemented via workflow wf_bb984f13-2e6 (sonnet implement → fable review → commit per task). Browser-validated on /guitar-edit: note place + undo on highway, note drag + undo in piano roll (previously silent no-ops), drum-edit unchanged, zero console errors. typecheck/lint/1945 Jest tests green.
