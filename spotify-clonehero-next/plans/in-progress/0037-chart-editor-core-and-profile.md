# Plan 0037: Headless editor core + gated dispatch + schema-driven note editing

> **Rewritten 2026-07-20** after an architecture review of the shipped code (an
> earlier draft proposed replacing all 26 command classes with a generic
> `ChartOperation` CRUD language; the review below explains why that was cut
> back to the note family only).
> **Dependencies:** 0036 (hotkey registry) — soft. **Parallel:** 0039.
> **Unlocks:** 0038 (projections, tool plugins, /guitar-edit).

## Findings that shaped this plan (verified, with cites)

- **Undo is already pure snapshot replay.** The reducer pushes the pre-command
  doc onto `undoDocStack` at `EXECUTE_COMMAND`
  (`ChartEditorContext.tsx:366-439`); `useUndoRedo` reinstalls docs directly.
  The 26 commands' hand-written `undo()` methods and their inverse-capture
  state are **dead in production** (only `BatchCommand`'s own recursion calls
  `.undo()`, and never on the undo path). Do not build an invertible-op
  history; delete the dead code instead.
- **Commands double as pure doc→doc functions** — the piano-roll computes its
  tempo _preview_ via `new MoveTempoMarkerCommand(...).execute(base)`
  (`PianoRollTimeline.tsx:1635`). Any replacement must preserve
  pure-function application.
- **There is no dispatch gating at all today** — `executeCommand` applies any
  command regardless of capabilities (`useEditCommands.ts:40-66`). UI +
  `EditorMCPTools` gating are the only defenses.
- **Only ~6 of 26 commands are drum-typed** (`AddNote`, `DeleteNotes`,
  `ToggleFlag`, `ToggleKick`, lane helpers pinned to `drums4LaneSchema`,
  `commands.ts:1163-1230`). The other ~18 (tempo ×6, downbeats ×3, sections,
  lyrics/phrases, timesig) are instrument-agnostic. The lane math is
  **duplicated verbatim** between `commands.ts:1163-1224` and
  `lib/chart-edit/entities/index.ts:129-184`.
- **Per-edit cloning is the real memory cost, not the snapshot stack.** Note
  edits deep-copy every note in every track (`cloneDocWithTracks`,
  `commands.ts:114-124`; `cloneDocFor('note')`, `entities/index.ts:383-391`).
  Fine at ~3k drum notes; O(all tracks × difficulties) per keystroke once
  multi-instrument charts are edited.
- **Three unstated blockers for the difficulty-picker / multi-instrument goal:**
  1. Selection ids are scope-blind (`"tick:type"`), and the reducer does
     **not** clear selection on `SET_ACTIVE_SCOPE`
     (`ChartEditorContext.tsx:497-499`) — switching difficulty with a live
     selection silently retargets commands.
  2. `state.clipboard` is `DrumNote[]` (`ChartEditorContext.tsx:155`) —
     drum-typed and scope-less.
  3. Tempo/timesig aren't `EntityKind`s (`entities/index.ts:51-56`), so
     capability gating has nothing to key on for them.
- `EditorMCPTools`' `editor_state` hardcodes drums/expert
  (`EditorMCPTools.tsx:136-141`).

## Goal

1. **Headless core.** Extract reducer, snapshot history, selection, and a
   subscribe surface from `ChartEditorContext.tsx` into a React-free
   `lib/chart-editor-core/EditorSession`; the provider becomes a
   `useSyncExternalStore` adapter. Rendering becomes subscription-driven:
   elements derive from `selectRenderDoc(state)` in one place, replacing the
   three duplicated imperative reconciler pushes in `useEditCommands.ts`
   (execute/undo/redo).
2. **Snapshot-only history, honestly.** Delete every command `undo()` method
   and its capture state. Scope `cloneDocFor`/`cloneDocWithTracks` to the
   target track (take the `TrackKey`/`EntityContext`) so per-edit cost is
   O(one track).
3. **Capability enforcement in dispatch via command metadata.** Every
   `EditCommand` declares `readonly entityKinds` (edited-**intent** kinds — a
   tempo move that KEEP-MS-remaps note ticks declares `'tempo'`, not
   `'note'`) and an operation class (`add|delete|update|move`).
   `BatchCommand` gates as the union of its members. `EditorCapabilities`
   gains `editableEntities` + `allowedOperations`; `EditorSession.dispatch`
   rejects violations. Add `'tempo'`/`'timesig'` entity-kind values.
4. **Schema-driven note family (the only command rewrite).** Replace the ~6
   drum-typed note commands with a note adapter parameterized by
   `InstrumentSchema`, operating on scan-chart `NoteEvent`s: add / delete /
   move / flag-toggle work for any instrument's lanes and flags. Collapse the
   duplicated lane math into `lib/chart-edit/entities/`. Retire the DrumNote
   facade (`DrumNoteType`, `DrumNoteFlags`, `drumNoteTypeMap`,
   `noteTypeToDrumNote`) in the same arc; friendly labels come from
   `InstrumentSchema.lanes[].label`. Tempo/downbeat/section/lyric/phrase
   commands stay as they are, metadata-tagged.
5. **Scope-aware identity.** Structured `EntityRef` `{kind, scope, key}`
   through selection and the MCP surface; **clear or rescope selection on
   `SET_ACTIVE_SCOPE`**; make the clipboard scope-aware and schema-typed
   (notes as `NoteEvent` + source scope, translated on paste via the target
   schema). Fix `editor_state`'s hardcoded drums/expert to report the active
   scope.

## Non-goals (explicitly rejected)

- **No generic `ChartOperation` CRUD language across all kinds.** Review
  finding: dispatch gating doesn't need it (metadata is equally expressive),
  MCP doesn't need it (`EditorMCPTools` already adapts commands to per-verb
  JSON-schema tools), and the tempo family would end up as snapshot "custom"
  ops — classes with new spelling. The op-shaped rewrite is done only where
  it multiplies across instruments: notes.
- **No invertible undo.** Snapshots are the shipped, correct mechanism.

## Tasks (one PR each, gated by the 0032 suite + browser validation)

1. Extract `EditorSession` (pure relocation; provider becomes adapter) +
   subscription-driven element derivation. No behavior change.
2. Delete dead `undo()` methods + capture state; track-scoped cloning.
   (0032's execute/undo tests convert to execute + snapshot-restore tests.)
3. Command metadata + dispatch gating; add tempo/timesig kinds; rejection
   tests per capability preset; keep `EditorMCPTools` gating as a secondary
   layer.
4. Schema-driven note adapter replacing the note-family commands; dedupe lane
   math into `entities/`; migrate `useHighwayMouseInteraction`,
   `useEditorKeyboard`, `prospectiveNote`, `NoteInspector`, `EditorMCPTools`.
5. Retire the DrumNote facade across remaining consumers
   (`lib/drum-transcription/{chart-types,ml/class-mapping}`, `helpers/drum-notes.ts`, …).
6. Structured `EntityRef` + selection rescope-on-scope-change + scope-aware
   clipboard + `editor_state` scope fix.

## Tests

- 0032 suite passes after each PR (undo assertions move to snapshot-restore).
- Gating: each preset × disallowed command kind/op → rejected; batch union
  gating; TEMPO preset allows tempo moves that remap note msTimes.
- Note adapter: add/delete/move/flag parity tests on drums (existing
  fixtures) and guitar (`guitarSchema`), plus lane-math single-source test.
- Scope: selection cleared/rescoped on difficulty change; cross-difficulty
  paste lands in the target track.

## Out of scope

- Renderer changes, projection contract, tool plugins, `/guitar-edit`,
  audio provider extraction — all 0038.

## Status (2026-07-20)

All 6 tasks implemented via workflow wf_9d5544d1-687 (sonnet implement → fable review → commit per task), commits fcf3eec…3f6fcef + cleanup 1b1739d. typecheck/lint/full Jest suite green. Browser validation pending (extension not connected; sandbox dev server cannot read .env).
