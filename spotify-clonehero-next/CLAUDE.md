# Music Charts Tools (spotify-clonehero-next)

Next.js 15 app with Clone Hero chart tools. Active development: adding a drum transcription feature as a new page at `/drum-transcription`.

## Getting Started

```bash
yarn install
yarn dev        # Start dev server
yarn test       # Run Jest tests
yarn lint       # ESLint
```

## Tech Stack

- **Framework:** Next.js 15 (App Router) + React 19 + TypeScript (strict)
- **Package manager:** yarn
- **Styling:** Tailwind CSS + shadcn/ui (Radix primitives in `components/ui/`)
- **State:** React state + context (`useState`, `useReducer`, context). No zustand or other state libraries.
- **Database:** SQLocal (SQLite in OPFS) + Kysely
- **Charts:** `@eliwhite/scan-chart` (parse .chart/.mid), `parse-sng` (parse .sng)
- **3D Preview:** THREE.js highway renderer (`lib/preview/highway.ts`, `app/sheet-music/[slug]/CloneHeroRenderer.tsx`)
- **Audio:** `AudioManager` (`lib/preview/audioManager.ts`) — Web Audio API, multiple stems, speed control
- **Notation:** VexFlow (`app/sheet-music/[slug]/SheetMusic.tsx`)
- **Testing:** Jest
- **Auth:** Supabase

## Drum Transcription Feature

Fully browser-based: upload a song → separate stems via Demucs (ONNX + WebGPU) → transcribe drums via ADTOF model (ONNX + WebGPU) → edit on a Clone Hero highway (like Moonscraper) → export as .zip or .sng.

### Hard Constraints

- **WebGPU required.** No WASM fallback. Block access with a clear message if WebGPU is unavailable.
- **No backend.** Everything runs client-side in the browser as a Next.js page.
- **No zustand.** Use React state + context, same patterns as `app/sheet-music/`.
- **No chart-preview npm package.** Use the project's own `CloneHeroRenderer.tsx` and `lib/preview/highway.ts`.
- **AudioManager is the primary audio source.** WaveSurfer is for waveform visualization and seeking only, not playback.
- **Editing happens on the Clone Hero highway** (like Moonscraper), not on a separate grid or sheet music UI.
- **All stems stored separately** in OPFS: `drums.pcm`, `bass.pcm`, `other.pcm`, `vocals.pcm`. No merged `no_drums.pcm`.
- **OPFS for storage** (`navigator.storage.getDirectory()`). No IndexedDB for audio/chart data. Namespace under `drum-transcription/` to avoid collisions.
- **Demo audio** at `public/drumsample.mp3`.
- **Don't duplicate code.** If a utility exists elsewhere in the project, extract it to a shared lib and update the original callsite first (in its own commit), then use it from the new code.
- **Tests required** for all business logic. Use Jest (`yarn test`).
- **Validate in the browser.** Use chrome-devtools MCP tools to test changes as you make them (see Browser Validation section below).

### Code Locations

```
app/drum-transcription/            # Next.js page + React components
  page.tsx                         # Entry: upload → process → edit
  components/                      # UI components (EditorApp, AudioUploader, etc.)
  contexts/                        # React context (EditorContext)
  hooks/                           # useEditorState, useUndoRedo
  commands.ts                      # Undo/redo command pattern

lib/drum-transcription/            # Core logic (testable, no React)
  chart-io/                        # .chart writer, reader, timing, validation, types
  ml/                              # ONNX runtime (WebGPU only), Demucs, ADTOF transcriber
  audio/                           # Decoder, STFT/iSTFT (fft.js), WAV encoder
  export/                          # ZIP (fflate), SNG packaging
  storage/                         # OPFS project management
  __tests__/                       # Jest tests
```

### Existing Utilities — Reuse, Don't Reimplement

| Need | Location |
|------|----------|
| Chart parsing, types (`NoteEvent`, `noteTypes`, `noteFlags`) | `@eliwhite/scan-chart` |
| SNG parsing | `parse-sng` |
| Tick → ms conversion | `app/sheet-music/[slug]/chartUtils.ts` → `tickToMs()` |
| Drum note → instrument mapping | `lib/fill-detector/drumLaneMap.ts` |
| Drum note → VexFlow notation | `app/sheet-music/[slug]/convertToVexflow.ts` |
| OPFS file read/write | `lib/fileSystemHelpers.ts` |
| Audio playback (primary) | `lib/preview/audioManager.ts` |
| Highway 3D renderer | `lib/preview/highway.ts` + `app/sheet-music/[slug]/CloneHeroRenderer.tsx` |
| Sheet music notation | `app/sheet-music/[slug]/SheetMusic.tsx` |
| INI parsing | `lib/ini-parser.ts` |
| UI components | `components/ui/` (shadcn: Button, Dialog, Card, Select, Slider, etc.) |
| CSS class merging | `lib/utils.ts` → `cn()` |
| Toasts | `sonner` (configured in root layout) |

### Reference Projects

| Project | Use |
|---------|-----|
| `~/projects/demucs-next` | Browser Demucs via ONNX + WebGPU. Reference for STFT/iSTFT, segmentation, ONNX session management |
| `~/projects/ADTOF` | Drum transcription model (Frame_RNN). Must be exported to ONNX via tf2onnx |
| `~/projects/Moonscraper-Chart-Editor` | Chart writing, highway editing UX, hotkeys, command pattern |
| `~/projects/GuitarGame_ChartFormats` | Chart format spec (.chart, .mid, .sng, zip), audio file naming |
| `~/projects/SngFileFormat` | SNG binary format spec + reference C# serializer |
| `~/projects/drum-transcription` | ML model README and training context |

## Plans

All work follows the plan-driven workflow in `plans/`. Read the plan before starting work.

### Rules

1. **All work must have a plan.** Find or create one in `plans/todo/` before writing code.
2. **Claim by moving to `in-progress/`.** Only one plan in-progress at a time.
3. **Commit on completion.** Move to `plans/completed/` and commit all changes together.

### Current Plans (dependency order)

**Completed:**

| Plan | Description |
|------|-------------|
| `0001-project-scaffolding` | Page shell, dependencies, directory structure |
| `0002-chart-file-writing` | .chart serializer with scan-chart round-trip tests |
| `0003-audio-acquisition` | File upload, Web Audio decode, OPFS storage, demo file |
| `0004-stem-separation` | Demucs via ONNX + WebGPU, STFT/iSTFT in JS |
| `0005-ml-model-integration` | ADTOF Frame_RNN via ONNX + WebGPU, post-processing |
| `0006-chart-preview-integration` | CloneHeroRenderer + AudioManager integration |
| `0007-editor-core` | Read-only editor page, SheetMusic + highway views, transport |
| `0007a-highway-editing` | Note editing on highway (Moonscraper-style), BPM/TS editing |
| `0007b-editor-workflow` | Confidence viz, undo/redo, auto-save, stem volume controls |
| `0008-pipeline-orchestration` | End-to-end flow: upload → process → edit → export |
| `0009-chart-export-packaging` | ZIP export with chart + stems + song.ini |
| `0010-sng-export` | SNG binary export |
| `0011-chart-edit-bugfixes` | chart-edit bug fixes and test coverage |
| `0012-consolidate-chart-io` | Consolidate drum-transcription chart-io → chart-edit |

**Todo (sequential):**

| Plan | Description | Depends On |
|------|-------------|------------|
| `0013-extract-shared-editor` | Extract editor UI to `components/chart-editor/`, composable panels | 0012 |
| `0014-drum-edit-page` | New `/drum-edit` page with chart loading (SNG/ZIP/folder) | 0013 |
| `0015-moonscraper-layout-timeline` | Moonscraper-inspired layout + timeline minimap | 0013 |
| `0016-grid-navigation-keys-mode` | Grid-based cursor navigation + keyboard note placement (1-5) | 0013 |
| `0017-section-editing` | Add/edit/delete named section markers on highway + timeline | 0015 |
| `0018-tanstack-hotkeys-migration` | Replace raw addEventListener keyboard handling with @tanstack/react-hotkeys | 0013, 0016 |
| `0019-highway-decomposition` | Split highway.ts into modules: HighwayScene, NotesManager, TextureManager | — |
| `0020-scene-integration` | Move overlay drawing (selections, cursor, sections, ghosts) into Three.js scene | 0019 |
| `0021-interaction-manager` | Hybrid hit testing (Three.js raycasts, React decides) + hover glow/outline | 0020 |
| `0022-incremental-editing` | Diff-based note updates — no full rebuild on add/delete/move | 0021 |
| `0023-waveform-highway-surface` | Waveform as highway texture + beat line grid overlay | 0019 |
| `0025-scene-reconciler` | Generic key-based scene reconciler (React-inspired) for notes, sections, lyrics | 0019-0022 |

### Parallelizable Work

After 0013, these can proceed in parallel:
- **Track A:** 0014 (drum-edit page)
- **Track B:** 0015 (layout + timeline) → 0017 (section editing)
- **Track C:** 0016 (grid nav + keys mode)

Highway refactor (0019-0023) is sequential:
- 0019 (decompose) → 0020 (scene integration) → 0021 (interaction) → 0022 (incremental editing)
- 0019 (decompose) → 0023 (waveform) — can parallel with 0020-0022

## Browser Validation

Use the **chrome-devtools MCP** tools to validate all UI work in the browser as you build it. Don't just write code and assume it works — verify it visually and functionally.

### After every meaningful UI change:

1. **Navigate to the page** — `navigate_page` to `http://localhost:3000/drum-transcription` (or whatever route you're working on)
2. **Take a screenshot** — `take_screenshot` to verify the UI renders correctly and looks right
3. **Check for console errors** — `list_console_messages` to catch React errors, failed imports, runtime exceptions, type errors, CORS issues, etc. Fix any errors before moving on.
4. **Check network failures** — `list_network_requests` to verify assets, ONNX models, and audio files load successfully. Look for 404s, CORS blocks, or failed fetches.

### When building interactive features:

5. **Test user flows** — Use `click`, `fill`, `type_text`, `press_key` to simulate user interactions (clicking buttons, uploading files, pressing keyboard shortcuts)
6. **Verify state changes** — After interactions, `take_screenshot` to confirm the UI updated correctly
7. **Test error states** — Try invalid inputs, missing files, and edge cases. Verify error messages appear and console stays clean.

### When working with audio/WebGPU:

8. **Check WebGPU availability** — `evaluate_script` with `!!navigator.gpu` to verify WebGPU is available in the test browser
9. **Monitor memory** — `take_memory_snapshot` if doing heavy processing (Demucs, ONNX inference) to check for leaks
10. **Check OPFS operations** — `evaluate_script` to verify files were written/read correctly from OPFS

### Key things to catch:

- React hydration mismatches (SSR vs client)
- Missing `'use client'` directives causing server component errors
- Broken imports or circular dependencies
- Canvas/WebGL rendering issues (blank highway, missing textures)
- AudioContext errors (user gesture required, suspended context)
- CORS errors from cross-origin headers misconfiguration
- OPFS permission errors
