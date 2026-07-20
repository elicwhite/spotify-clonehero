# 0065 — /tempo: adopt the shared chart editor layout

## Goal

Replace `/tempo`'s bespoke `ResultsView` layout with the shared `ChartEditor` shell used by `/drum-transcription`, so both pages have identical layout and behavior.

## Requirements

1. `/tempo` uses `ChartEditorProvider` + `ChartEditor` (same fixed-viewport flex layout as `/drum-transcription`): top bar with export button (ExportDialog) top-right, LeftSidebar, highway, TransportControls playback bar, PianoRollTimeline at the bottom. No page-level scrolling; highway must not resize/jump.
2. Piano roll on `/tempo` shows the tempo grid and sections but **no notes** (and no lyrics row). Controlled via a tempo-page capability set (no note lanes / note editing).
3. Leading-silence button present, wired the same as drum-transcription: `planLeadingSilence` → `AddLeadingSilenceCommand`, and the audio-anchor watch effect that rebuilds the padded AudioManager/waveform PCM when the first tempo is modified. Extract the padded-audio rebuild logic from `EditorApp` into a shared hook/lib first (own commit) rather than duplicating.
4. Highway shows tempo and time-signature markers (comes free via `HighwayEditor`/`chartToElements`).
5. Remove the tempo/time-signature list from the left column (the piano roll now covers it). Keep tempo-page-specific controls (variant Original/New toggle, snap-notes switch, start over, etc.) as `leftPanelChildren`.
6. Remove `h-screen w-screen` from the tempo results view; participate in the app layout with `flex flex-col flex-1 min-h-0 overflow-hidden` like `DrumTranscriptionClient`.

## Done when

- `/tempo` results view is visually/structurally identical to `/drum-transcription`'s editor chrome.
- `pnpm typecheck`, `pnpm test`, `pnpm lint` pass.
