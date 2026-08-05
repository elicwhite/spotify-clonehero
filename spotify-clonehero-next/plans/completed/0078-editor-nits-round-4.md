# 0078 — Chart editor nits, round 4

Owner punch list for `/chart-editor` (2026-08-04). Eighteen items, grouped by
the files each one owns so the work can run in parallel without collisions.

## Group A — piano roll (`components/chart-editor/piano-roll/*`)

1. **No visible scrollbars.** The piano roll regained visible scrollbars on
   macOS; it must scroll without them again. The left sidebar keeps its
   visible scrollbar.
2. **A/B loop renders on the piano roll.** Blue start/end flags in the section-
   marker strip, blue shading between them, right-click on the shaded region
   opens a "Clear loop" context menu, and both flags are draggable.
3. **Waveform source picker drops `Click`.** The metronome/click track must
   not appear as a selectable waveform source.
4. **Resize handle is obvious.** The drag bar between highway and piano roll
   gets a visible grip (three dots).
5. **Instrument+difficulty headers lose the filled/unfilled circle** in the
   multi-instrument stacked layout.
6. **"Insert note" context-menu item** on an instrument's note lane, inserting
   at the right-click tick snapped by the current grid-snap setting.

## Group B — left sidebar (`components/chart-editor/LeftSidebar.tsx`, `sidebar/*`)

7. **One source of left padding.** Two nested elements still contribute left
   spacing; collapse to one.
8. **Chart Assist CTA row.** Every card's CTA must sit consistently on the same
   line as (or a line apart from) "Learn More" — today Add Leading Silence and
   Generate Tempo Map wrap it.
9. **Chart Matrix "Add Instrument" dropdown closes on outside click.**
10. **Stems M/S buttons get "Mute"/"Solo" tooltips.**

## Group C — highway (`components/chart-editor/highway/*`, `lib/preview/highway/*`)

11. **No section markers on the chart-editor highway.**
12. **Highway names centered at the bottom** of each highway instead of a
    top-left label.

## Group D — transport + site header

13. **Log In button doesn't resize.** The header button starts large and
    shrinks once the editor's density scope mounts.
14. **Speed % leaves the transport bar**; the cursor / place / undo / redo tool
    actions move there from the sidebar utility cluster.

## Group E — context menus

15. **Compact editor context menus.** `ContextMenuPopover` (piano roll) and the
    Chart Matrix menu use the site's roomy spacing; they should match the
    editor's compact density.

## Group F — loop playback

16. **A/B loop actually loops.** Setting markers doesn't make playback jump
    back to the start after passing the end.

## Verification

`pnpm test`, `pnpm typecheck`, `pnpm lint`, plus browser QA on
`/chart-editor`.
