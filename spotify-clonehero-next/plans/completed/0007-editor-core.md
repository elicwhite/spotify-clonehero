# 0007 - Editor Core: Page Shell, Audio, and Read-Only Viewing

> **Dependencies:** 0002 (chart I/O), 0006 (chart preview integration), 0005 (confidence data format)
> **Unlocks:** 0007a (highway editing), 0007b (editor workflow)
>
> **Location:** This is a Next.js route at `app/drum-transcription/page.tsx` inside `~/projects/spotify-clonehero/spotify-clonehero-next/`. Uses yarn, Tailwind for styling, React state/context for state management (no zustand).
>
> **Shared code:** Before building, extract shared drum note mapping code into `lib/drum-mapping/` so both `SheetMusic` and the editor share a single source of truth (see section 2).

## Overview

The editor core is the foundation: a page that loads a transcription result from OPFS, displays it read-only via the existing SheetMusic notation view and CloneHeroRenderer highway, plays audio via AudioManager, and provides WaveSurfer for seeking/navigation. No editing capabilities yet -- that comes in 0007a.

This plan is intentionally scoped to read-only viewing with audio playback. The goal is to get the page working end-to-end with real data before adding editing complexity.

---

## 1. Tech Stack

This is a standard Next.js page in the existing project. Nothing special:

| Layer              | Choice                                                                           |
| ------------------ | -------------------------------------------------------------------------------- |
| Framework          | Next.js (existing project)                                                       |
| Package manager    | yarn                                                                             |
| Language           | TypeScript (strict)                                                              |
| Styling            | Tailwind CSS                                                                     |
| State management   | React state + context (no zustand)                                               |
| Audio playback     | `AudioManager` from `lib/preview/audioManager.ts` (primary source)               |
| Seeking/navigation | WaveSurfer.js 7+ (visual waveform, click-to-seek, minimap)                       |
| Notation view      | `SheetMusic` component from `app/sheet-music/[slug]/SheetMusic.tsx` (reused)     |
| Highway view       | `CloneHeroRenderer` from `app/sheet-music/[slug]/CloneHeroRenderer.tsx` (reused) |
| Chart parsing      | `scan-chart` (`parseChartFile`) -- already a dependency                          |

---

## 2. Shared Code Extraction (prerequisite)

Before building the editor page, extract shared code so both the SheetMusic page and the editor use the same logic without duplication.

### 2.1 `lib/drum-mapping/noteToInstrument.ts`

Extract `convertNoteToString()` from `app/sheet-music/[slug]/convertToVexflow.ts` into a shared library. This function maps `NoteEvent` (with its `type` and `flags`) to a `DrumNoteInstrument` string (`'kick'`, `'snare'`, `'hihat'`, `'high-tom'`, `'mid-tom'`, `'floor-tom'`, `'crash'`, `'ride'`).

```typescript
// lib/drum-mapping/noteToInstrument.ts
import {NoteEvent, noteTypes, noteFlags} from '@eliwhite/scan-chart';

export type DrumNoteInstrument =
  | 'kick'
  | 'snare'
  | 'high-tom'
  | 'mid-tom'
  | 'floor-tom'
  | 'hihat'
  | 'crash'
  | 'ride';

export function noteEventToInstrument(note: NoteEvent): DrumNoteInstrument {
  // Move the body of convertNoteToString here
}
```

Update `convertToVexflow.ts` to import from the shared lib instead of defining its own copy. The existing `DrumNoteInstrument` type and `convertNoteToString` function move to the lib; `convertToVexflow.ts` imports them.

### 2.2 `lib/drum-mapping/instrumentToVexflow.ts`

The VexFlow-specific mapping (`DrumNoteInstrument` to VexFlow position string like `'c/5'`) stays in `convertToVexflow.ts` since it is VexFlow-specific. But the `mapping` object should import `DrumNoteInstrument` from the shared lib.

### 2.3 `lib/chart-utils/tickToMs.ts`

Move `tickToMs` from `app/sheet-music/[slug]/chartUtils.ts` to `lib/chart-utils/tickToMs.ts`. Update the original to re-export from the new location. The editor will need this for time coordinate conversion.

### 2.4 Update existing callsites

After extraction, update `app/sheet-music/[slug]/convertToVexflow.ts` and any other files to import from the new shared locations. Run the existing app to verify nothing breaks.

---

## 3. Page Structure

### 3.1 Route

`app/drum-transcription/page.tsx` -- a Next.js page component.

### 3.2 Layout

```
+------------------------------------------------------------------+
|  Toolbar: Song Title - Artist  |  Transport Controls             |
+------------------------------------------------------------------+
|                                                                    |
|  +------------------------------------------------------------+  |
|  |  WaveSurfer Minimap (full song overview, click to navigate) |  |
|  +------------------------------------------------------------+  |
|                                                                    |
|  +------------------------------------------------------------+  |
|  |  WaveSurfer Waveform (zoomable, click to seek)              |  |
|  +------------------------------------------------------------+  |
|                                                                    |
|  +---------------------------+  +-----------------------------+  |
|  |                           |  |                             |  |
|  |  SheetMusic Notation      |  |  CloneHeroRenderer          |  |
|  |  (existing component,     |  |  (highway view, synced      |  |
|  |   read-only, scrolls      |  |   to AudioManager)          |  |
|  |   with playback)          |  |                             |  |
|  |                           |  |                             |  |
|  +---------------------------+  +-----------------------------+  |
|                                                                    |
+------------------------------------------------------------------+
```

All styling with Tailwind. The layout is a vertical stack with the notation and highway side by side at the bottom.

### 3.3 Component Tree

```
<DrumTranscriptionPage>           -- route component, loads data from OPFS
  <EditorProvider>                -- React context for shared state
    <Toolbar />                   -- song info, zoom controls, speed control
    <WaveSurferPanel />           -- minimap + waveform (seeking only)
    <div className="flex">
      <SheetMusic />              -- existing component, reused directly
      <CloneHeroRenderer />       -- existing component, reused directly
    </div>
    <TransportControls />         -- play/pause/seek/speed
  </EditorProvider>
</DrumTranscriptionPage>
```

---

## 4. EditorContext (React Context)

No zustand. Use React context + useReducer for the editor state that multiple components need to share.

```typescript
// app/drum-transcription/EditorContext.tsx

interface EditorState {
  // Chart data (read-only in this plan)
  chart: ParsedChart | null;
  track: ParsedChart['trackData'][0] | null;

  // Audio
  isPlaying: boolean;
  currentTimeMs: number;
  playbackSpeed: number;

  // View
  zoom: number;
}

type EditorAction =
  | {type: 'SET_CHART'; chart: ParsedChart; track: ParsedChart['trackData'][0]}
  | {type: 'SET_PLAYING'; isPlaying: boolean}
  | {type: 'SET_CURRENT_TIME'; timeMs: number}
  | {type: 'SET_PLAYBACK_SPEED'; speed: number}
  | {type: 'SET_ZOOM'; zoom: number};

// Context provides state + dispatch + refs to AudioManager and WaveSurfer
interface EditorContextValue {
  state: EditorState;
  dispatch: React.Dispatch<EditorAction>;
  audioManagerRef: RefObject<AudioManager | null>;
  wavesurferRef: RefObject<WaveSurfer | null>;
}
```

The AudioManager instance is held in a ref, not in React state, because it is a mutable class with its own internal state. Components that need it access it via `editorContext.audioManagerRef.current`.

---

## 5. Data Loading from OPFS

### 5.1 Loading Flow

When the page mounts:

1. Read chart text from OPFS: `{project}/chart/notes.chart` (or `notes.edited.chart` if it exists -- prefer the edited version).
2. Parse with `parseChartFile(chartData, 'chart')` from `scan-chart`.
3. Find the expert drums track in `parsedChart.trackData`.
4. Read audio files from OPFS: `{project}/stems/drums.*` and `{project}/stems/song.*` (or similar).
5. Create an `AudioManager` instance with the audio files.
6. Wait for `audioManager.ready`.
7. Load audio into WaveSurfer (for visual display only -- WaveSurfer does not play audio).
8. Set state via `dispatch({ type: 'SET_CHART', chart, track })`.

### 5.2 Project Selection

For now, use URL query params to specify the project name: `/drum-transcription?project=my-song`. The project name maps to an OPFS directory. If no project param, show a simple project picker that lists available OPFS directories.

---

## 6. Audio Architecture

### 6.1 AudioManager is Primary

`AudioManager` from `lib/preview/audioManager.ts` owns all audio playback. It handles:

- Play, pause, seek (via `play({ time })`, `pause()`, `resume()`)
- Playback speed (via `setTempo()`)
- Multiple tracks (drums, song, etc.)
- Current time tracking (via `currentTime` getter)

Do not copy AudioManager. Import and use it directly.

### 6.2 WaveSurfer is for Seeking Only

WaveSurfer displays the waveform visually and provides click-to-seek and minimap navigation. It does NOT play audio. Configure WaveSurfer with:

- `backend: 'WebAudio'`
- `interact: true` (enable click-to-seek)
- Media element set to a silent/muted source, or use WaveSurfer's `media` option with a muted audio element

When the user clicks on the WaveSurfer waveform:

1. WaveSurfer fires a `seek` event with a position (0-1).
2. The handler calls `audioManager.play({ percent: position })`.
3. AudioManager handles the actual audio seek.

During playback, an animation frame loop reads `audioManager.currentTime` and updates WaveSurfer's visual position via `wavesurfer.seekTo(currentTime / duration)` so the playhead tracks correctly. WaveSurfer is display-only; AudioManager is the source of truth.

### 6.3 Syncing Components

An `animationFrame` loop runs during playback:

```typescript
function animationLoop() {
  if (audioManagerRef.current?.isPlaying) {
    const currentTime = audioManagerRef.current.currentTime;
    const currentTimeMs = currentTime * 1000;

    // Update WaveSurfer visual position
    wavesurferRef.current?.seekTo(currentTime / duration);

    // Update React state (throttled to ~30fps to avoid excess renders)
    dispatch({type: 'SET_CURRENT_TIME', timeMs: currentTimeMs});
  }
  requestAnimationFrame(animationLoop);
}
```

SheetMusic and CloneHeroRenderer both receive `currentTime` and `audioManagerRef` as props (same as they do on the sheet-music page today). They handle their own internal sync.

---

## 7. Transport Controls

A `<TransportControls>` component with Tailwind styling:

- **Play/Pause** toggle button
- **Seek backward/forward** by beat (using tempo map to calculate beat positions)
- **Speed control**: buttons or slider for 0.25x, 0.5x, 0.75x, 1x, 1.25x, 1.5x, 2x (calls `audioManager.setTempo()`)
- **Position display**: current time in `M:SS.mmm` format and beat/measure position
- **Jump to start/end**

### Keyboard shortcuts (transport only, editing shortcuts come in 0007a):

| Key          | Action                  |
| ------------ | ----------------------- |
| `Space`      | Play/Pause              |
| `Left/Right` | Step by beat            |
| `Home/End`   | Jump to start/end       |
| `+` / `-`    | Zoom in/out (time axis) |

---

## 8. WaveSurfer Panel

### 8.1 Minimap

Use WaveSurfer's `MinimapPlugin` for a full-song overview bar at the top. Click anywhere on it to jump to that position. This provides quick navigation without zooming all the way out.

### 8.2 Waveform

The main waveform view, zoomable via scroll wheel or +/- keys. Click to seek. During playback, the waveform view auto-scrolls to keep the playhead visible.

Configure with:

- `minPxPerSec: 50` (reasonable zoom minimum)
- `cursorColor` and `progressColor` for visual distinction
- `height: 128` (or configurable)

---

## 9. Reusing SheetMusic and CloneHeroRenderer

### 9.1 SheetMusic

Import `SheetMusic` from `app/sheet-music/[slug]/SheetMusic.tsx` and pass the required props:

```typescript
<SheetMusic
  chart={chart}
  track={track}
  currentTime={state.currentTimeMs / 1000}
  showBarNumbers={true}
  enableColors={true}
  showLyrics={false}
  zoom={state.zoom}
  onSelectMeasure={(time) => audioManagerRef.current?.play({ time })}
  triggerRerender={rerenderKey}
  practiceModeConfig={null}
  onPracticeMeasureSelect={() => {}}
  selectionIndex={null}
  audioManagerRef={audioManagerRef}
/>
```

SheetMusic already handles rendering drum notation with VexFlow, playhead tracking, and measure click-to-seek. No duplication needed.

### 9.2 CloneHeroRenderer

Import `CloneHeroRenderer` from `app/sheet-music/[slug]/CloneHeroRenderer.tsx` and pass:

```typescript
<CloneHeroRenderer
  metadata={metadata}
  chart={chart}
  track={track}
  audioManager={audioManager}
/>
```

The highway already syncs to AudioManager's current time. In 0007a, we will extend it to support editing interactions.

---

## 10. Implementation Steps

1. **Extract shared code** (section 2): Move `convertNoteToString`, `DrumNoteInstrument` type, and `tickToMs` to shared libs. Update existing callsites. Verify sheet-music page still works.

2. **Create route and context**: Set up `app/drum-transcription/page.tsx` with `EditorContext`, basic Tailwind layout.

3. **OPFS data loading**: Implement the loading flow (section 5). Display a loading state while data loads. Show an error state if the project is not found.

4. **AudioManager integration**: Create AudioManager from loaded audio files. Wire up play/pause/seek.

5. **WaveSurfer panel**: Add WaveSurfer for visual waveform display. Wire up click-to-seek (WaveSurfer seek event -> AudioManager.play). Wire up animation frame loop for visual position sync.

6. **SheetMusic integration**: Render the existing SheetMusic component with the parsed chart data. Verify notation renders correctly and playhead tracks with audio.

7. **CloneHeroRenderer integration**: Render the highway view. Verify it syncs with AudioManager playback.

8. **Transport controls**: Add play/pause, seek, speed controls. Wire up keyboard shortcuts.

9. **Test end-to-end**: Load a real transcription result from OPFS, verify audio plays, notation and highway display correctly, seeking works from both WaveSurfer and transport controls.

---

## 11. What This Plan Does NOT Cover

- Note editing (select, move, add, delete) -- see **0007a**
- BPM/time signature editing -- see **0007a**
- Waveform on highway background -- see **0007a**
- Confidence visualization and review workflow -- see **0007b**
- Undo/redo, copy/paste -- see **0007b**
- Auto-save, stem volume controls -- see **0007b**
