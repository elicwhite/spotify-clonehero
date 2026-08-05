# 0082 — Tempo track editing, lyric editing, and the clipboard

Owner punch list for `/chart-editor` (2026-08-05).

## Tempo track

1. **Phantom "Remove time signature change".** Right-clicking near a downbeat
   offers to remove a time signature change where none is drawn. The hit test
   and what the lane renders disagree.
2. **Make this a downbeat, and propagate.** The generated tempo map drifts: at
   some point the song's downbeat lands slightly earlier than the grid. The
   user wants to right-click a position, declare it a downbeat, and have every
   later bar line follow. That requires the measure *before* the new downbeat
   to take a time signature that makes it the right length.
3. **Time signature markers are not draggable** on the piano roll.
4. **Inserting a time signature snaps to 1/4.** It should respect the current
   grid-snap setting, so a downbeat can land on a 16th. Same consequence as
   item 2: the preceding measure's signature has to absorb the difference.

Items 2 and 4 are one capability underneath: place a bar line at an arbitrary
tick and rewrite the preceding measure so the grid stays consistent.

## Text editing

5. **Textbox hotkeys.** While a text input has focus, editor hotkeys must not
   fire. Cmd+A selects the text in the box, not every note on the grid; Cmd and
   arrow keys move the caret. Applies to the piano roll's inline lyric editor
   and to the Song Details modal.

## Lyrics lane

6. **Delete removes a selected lyric.**
7. **Phrase starts and ends are invisible.** They need solid vertical lines at
   the phrase edges.

## Clipboard

8. **Paste does nothing.** Copy works; paste must place the copied content at
   the playhead. Lyrics paste exactly at the playhead. Notes paste grid-aligned,
   preserving the subdivision structure they were copied from.

## Verification

`pnpm test`, `pnpm typecheck`, prettier, plus browser QA on `/chart-editor`.
