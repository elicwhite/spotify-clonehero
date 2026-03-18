# Music Charts Tools (spotify-clonehero-next)

Next.js 15 app with multiple Clone Hero tools. The drum transcription feature is the primary active development area.

## Tech Stack

- **Framework:** Next.js 15 (App Router) + React 19 + TypeScript (strict)
- **Styling:** Tailwind CSS + shadcn/ui (Radix primitives)
- **Database:** SQLocal (SQLite in OPFS) + Kysely (type-safe queries)
- **Charts:** `@eliwhite/scan-chart` (parse .chart/.mid), `parse-sng` (parse .sng archives)
- **3D Preview:** THREE.js (Clone Hero highway renderer)
- **Notation:** VexFlow (sheet music rendering)
- **Auth:** Supabase
- **Testing:** Jest

## Drum Transcription Feature

Fully browser-based drum transcription: upload a song, separate the drum stem via WebGPU-accelerated Demucs, run an ML model for automatic transcription, then edit and correct the result. The final output is a Clone Hero `.chart` file. No backend — everything runs client-side.

### Pipeline Overview

1. **Audio input** — User uploads an audio file (or uses the built-in demo `drumsample.mp3`)
2. **Stem separation** — Demucs via ONNX Runtime Web + WebGPU isolates the drum track
3. **Automatic transcription** — Drum transcription ML model via ONNX Runtime Web + WebGPU
4. **Human editing** — Web-based editor for reviewing and correcting the transcription
5. **Export** — Download as a packaged Clone Hero archive (.zip or .sng)

### Architecture Constraints

- **Fully browser-based.** No backend, no server logic, no CLI. Runs as a Next.js page.
- **WebGPU first, WASM fallback.** Use ONNX Runtime Web with WebGPU EP. Fall back to WASM (in a Web Worker) when WebGPU is unavailable.
- **OPFS for storage.** Use `navigator.storage.getDirectory()` for file handles. No IndexedDB for audio/chart data. Existing `lib/fileSystemHelpers.ts` patterns.
- **Demo audio included.** `public/drumsample.mp3` ships as a default demo.
- **Cross-origin headers** already configured in `next.config.js` for SharedArrayBuffer.

### Key Existing Utilities to Reuse

| Utility | Location | Use |
|---------|----------|-----|
| Chart parsing | `@eliwhite/scan-chart` | `parseChartFile()`, `NoteEvent`, `noteTypes`, `noteFlags` |
| SNG parsing | `parse-sng` | Extract `.sng` archives |
| Tick↔ms conversion | `app/sheet-music/[slug]/chartUtils.ts` | `tickToMs()` |
| Drum lane mapping | `lib/fill-detector/drumLaneMap.ts` | `NoteType` → drum voice |
| VexFlow conversion | `app/sheet-music/[slug]/convertToVexflow.ts` | Chart → notation |
| OPFS helpers | `lib/fileSystemHelpers.ts` | `writeFile()`, `readJsonFile()`, `readTextFile()` |
| Audio playback | `lib/preview/audioManager.ts` | Web Audio API + playback speed |
| Chart loading | `lib/preview/chorus-chart-processing.ts` | `getChartAndAudioFiles()` |
| INI parsing | `lib/ini-parser.ts` | Parse `song.ini` |
| Fill detection | `lib/fill-detector/` | Drum fill analysis |
| UI components | `components/ui/` | shadcn/ui (Button, Dialog, Card, etc.) |

### New Code Locations

```
app/drum-transcription/          # Next.js page + components
  page.tsx                       # Entry page
  components/                    # Editor UI components
lib/drum-transcription/          # Core logic (chart I/O, ML, audio processing)
  chart-io/                      # .chart writer, timing, validation
  ml/                            # ONNX runtime, Demucs, transcription model
  audio/                         # Audio decoding, STFT/iSTFT, WAV encoding
  export/                        # ZIP/SNG packaging
  storage/                       # OPFS project management
```

### Reference Projects

- `~/projects/demucs-next` — Browser Demucs via ONNX + WebGPU. Key files: `web/src/hooks/useDemucs.ts`, `web/src/utils/audio-processor.ts`, `web/src/utils/onnx-runtime.ts`
- `~/projects/Moonscraper-Chart-Editor` — `.chart` file format reference: `ChartWriter.cs`, `ChartIOHelper.cs`
- `~/projects/drum-transcription` — ML model README, project context

### Clone Hero Chart Format

Charts use a text-based `.chart` format with INI-like sections. Drum note encoding:

| Note # | Meaning |
|--------|---------|
| 0 | Kick |
| 1 | Red (snare) |
| 2 | Yellow (hi-hat/tom) |
| 3 | Blue (tom/ride) |
| 4 | Orange (tom/crash) |
| 32 | Double kick (Expert+) |
| 64-68 | Pro drums cymbal markers |
| 33-37 | Accent flags |
| 39-43 | Ghost flags |

### Export Format

The final export is a **packaged archive** (`.zip` or `.sng`) containing:
- `notes.chart` — the drum chart
- `song.ini` — Clone Hero metadata
- `drums.wav` — drum stem audio
- `song.wav` — full mix or accompaniment

All export code must have unit tests verifying round-trip through `scan-chart`'s `scanChartFolder` / `parse-sng`.

## Workflow: Plan-Driven Development

All work on the drum transcription feature follows a plan-driven workflow using `plans/`.

### Plan structure

```
plans/
  todo/         # Planned work, not yet started
  in-progress/  # Actively being worked on
  completed/    # Finished work
```

Plans are numbered markdown files: `0001-descriptive-name.md`.

### Rules

1. **All work must have a plan.** Before writing any code, create or identify the corresponding plan in `plans/todo/`. If no plan exists for the work you're about to do, create one first.
2. **Claim work by moving to in-progress.** When starting work on a plan, move it from `todo/` to `in-progress/`.
3. **Commit on completion.** When a plan's work is done and verified, move it from `in-progress/` to `completed/` and create a git commit with all changes from that plan.
4. **One plan at a time.** Only one plan should be in `in-progress/` at a time to keep commits focused.

### Testing

**Tests are required for all business logic.** Any module containing logic (chart serialization, tick/time conversion, audio processing helpers, STFT/iSTFT, etc.) must have corresponding tests. Tests should be written alongside the implementation, not after. Use `yarn test` (Jest) for unit tests.
