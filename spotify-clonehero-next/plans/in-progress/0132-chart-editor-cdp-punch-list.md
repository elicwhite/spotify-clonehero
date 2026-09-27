# 0132 — Four chart-editor bugs found driving the editor over CDP

Status: in-progress

Four defects in `/chart-editor`, found by driving the real editor over the
Chrome DevTools Protocol. Each one got a failing test before its fix.

## 1. The selection goes stale after a note drag

A note's id is its position (`tick:type`, from `schemaNoteId`), and a
selection holds the track-qualified form (`drums:expert|480:redDrum`). A drag
commits `MoveEntitiesCommand('note', …)`, which renames every note it moves —
the note handler's `moveMany` even returns the new ids — but neither commit
path read them: not the piano roll's pointer-up (`PianoRollTimeline.tsx`),
and not the highway's `selectMoveTool.onPointerUp` (`tools/tools.ts`). The
selection kept the old names, which then pointed at nothing. The moved notes
lost their halo, and Cmd+C, which copies the selected notes of the active
track, copied nothing.

- `commands.ts` — `MoveEntitiesCommand.movedIds(doc)`: where each moved id
  lands when the command runs on `doc`, from the same handler call `execute`
  makes. Pure, like `execute`; it moves a copy.
- `editing/dragCommit.ts` — what a drag commits: `noteDragCommit` (the
  highway: the selected notes on one track) and `selectionDragCommit` (the
  piano roll: those notes plus co-selected lyrics, whose ids are tick-keyed
  too, in one `BatchCommand`). Each returns the command and the selection it
  leaves behind.
- The selection is part of the edit. `executeCommand(command, selection)`
  sends it in `EXECUTE_COMMAND`; the reducer applies it with the doc and
  keeps the selection from before the step on the undo entry, and `UNDO` /
  `REDO` swap it back with the doc, the way `visible` already works. A
  separate re-select dispatch would leave undo naming the moved positions —
  and where a drop replaced another note, naming that note, which a Delete
  would then remove. Steps that carry no selection leave undo's selection
  alone, so no other command's undo changes. `ExecuteCommand` is the one
  type every surface that forwards `executeCommand` declares, so none can
  drop the selection.
- The section drag has the same hazard — a section's id is its tick, and a
  drop onto another section replaces it — so it sends its selection the same
  way. Paste still re-selects with a separate dispatch; after its undo the
  pasted ids name empty positions, so nothing wrong can be selected. Cut
  clears the selection.

Tests: a piano-roll drag in time and across lanes keeps the moved notes
selected under their new ids; a mixed note+lyric drag keeps both; undoing a
note drag, or a section drag that replaced another section, restores the old
selection; the highway tool re-selects what it moved, and its undo/redo swap
the selection even where the drop replaced a note; `dragCommit` unit tests
(clamp at tick 0, other tracks, lyric clamp, zero moves); reducer tests for
the selection in `EXECUTE_COMMAND`, `UNDO` and `REDO`; a rejected command
leaves the selection alone.

## 2. `editor_select_note` builds ids that match nothing

`EditorMCPTools.tsx` built `${tick}:${type}` from the numeric `NoteType`
(`6912:15`), but a note id spells the type by name (`6912:redDrum`). The
select reported success, and an `editor_delete_selected` after it deleted
nothing.

- Find the note with `findNote` and select it by the editor's own `noteId`.
- Say so when the active track has no such note, or when the editor is not
  on a notes track, instead of selecting an id that names nothing.

Tests: `editor_select_note` then `editor_delete_selected` removes the note;
a miss and a vocals scope select nothing.

## 3. A bare "1" in Place Note mode

The report: in Place Note mode a bare "1" placed a note instead of selecting
the Cursor tool. That was the documented design (plan 0016): in Place Note
mode the number keys were lane keys — "1" the drums kick and the guitar green
fret — and the tool keys worked only outside it.

Decision (Eli): remove the lane hotkeys. The number keys select tools in
every mode — 1 Cursor, 2 Place Note, bare or with Mod — and no number key
places a note. `useEditorKeyboard` loses its lane-key handler and
`LaneDefinition.defaultKey` goes with it (flag keys keep theirs). Notes are
placed with the pointer; a 5-lane kick, which the highway's tie-break gives
to blue, is placed on the piano roll's kick row.

Tests: a bare 1 and Mod+1 select Cursor in Place Note mode, a bare 2 selects
Place Note again, and no number key adds or removes a note. Plans 0025 (§8.1)
and 0036 now say the lane keys are gone.

## 4. A stems-only package plays its vocals as the "full mix"

`decodeChartPackageAudio` (`hooks/projectAudio.ts`) promoted the first file
into the full-mix slot when a package had no `song` file. For a package of
drums/bass/guitar/rhythm/vocals it could pick `vocals`. The song's waveform
was then the vocals alone, and because `vocals` was no longer a stem,
`TrackEditPage`'s lyrics-row waveform (`stemPcm(stems, VOCALS_STEM)`) never
drew and `useSeparatedStems` thought the package had no vocals.

- A package of stems with no `song` file has no full-mix file. Every file is
  a stem, and the full mix is their sum (`mixInterleavedYielding`, beside
  `mixToInterleavedStereo` in `lib/preview/waveformMix.ts`), drawn and
  measured as the song. Its `fullMixName` is `null`. "A one-file package"
  counts the package's files, not the ones that decoded, so a `song` that
  fails beside one stem does not turn that stem into the song.
- `useShiftedAudio` takes `fullMixName: string | null` with no default (the
  drum-transcription host passes `'song'`): a full mix with no name is
  shifted with everything else but registered as no track. The stems already
  play, so the mixer shows each file once and nothing plays twice.
- `packageFiles` lists the package's own files. A padded export ships them
  and never the sum, and `useSeparatedStems` reads vocals from them the way
  the drums check already did.
- A single-file package keeps its one file as the full mix.

Tests: the decode sums a stems-only package and keeps every file a stem,
also when its `song` fails to decode; the `AudioManager` gets each stem once
and no track for the sum; the export skips the sum; `/chart-editor` on such
a package lists each file once, draws the sum on the highway, and draws the
lyrics-row waveform from `vocals`; a package whose one file is `vocals` gets
no separated vocals on top.

## Found on the way, left for their own tasks

- Dragging a lyric chip does not move co-selected notes: that commit path
  passes track-qualified ids to `MoveEntitiesCommand('note', …)`, which
  parses local ids only. It also re-selects its lyrics with a separate
  dispatch, and `moveLyric` can drop a lyric on the tick of another one, so
  after an undo the selection can name that other lyric — the hazard §1
  closes for notes and sections.
- The highway's note drag feeds track-qualified ids to `selectionLaneSpan`,
  so a multi-note lane drag is clamped as if it were one note and can stack
  notes on the edge lane.
- A package with a `song` file still draws `song` alone as the song, though
  beside other stems `song` is only the backing track. Drawing the sum of
  every file there too would give one rule for both shapes.
- Undo restores a drag's selection even after the user has switched to
  another track. Note actions filter to the active track, so no note is at
  risk, but the old track's notes show selected again.

## Verification

- Each new test failed before its fix and passes after.
- `pnpm test` (inside a `.claude/worktrees/` checkout, with
  `--testPathIgnorePatterns '/node_modules/' '/\.next/'`), `pnpm typecheck`,
  `pnpm lint`.
