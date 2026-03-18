# 0001 - Project Scaffolding & Architecture

> **Dependencies:** None (this is the foundation)
> **Unlocks:** All other plans

## Overview

Add a drum transcription feature to the existing spotify-clonehero-next app as a new page at `/drum-transcription`. This leverages the existing Next.js 15 setup, shadcn/ui components, `@eliwhite/scan-chart`, OPFS helpers, and audio infrastructure. No separate project needed.

---

## 1. New Code Locations

### Page (Next.js App Router)

```
app/drum-transcription/
  page.tsx                       # Entry page: upload → process → edit flow
  components/
    AudioUploader.tsx            # Drag-and-drop + "Try Demo" button
    ProcessingView.tsx           # Progress bars during Demucs + ML inference
    EditorApp.tsx                # Top-level editor layout
    WaveformPanel.tsx            # WaveSurfer waveform display
    DrumLaneGrid.tsx             # Primary editing canvas
    HighwayPreview.tsx           # chart-preview 3D highway
    TransportControls.tsx        # Play/pause/seek/speed
    NoteInspector.tsx            # Selected note properties
    ExportDialog.tsx             # Export format selection + download
  store.ts                       # Zustand editor state
  commands.ts                    # Undo/redo command pattern
```

### Library (shared logic, testable)

```
lib/drum-transcription/
  chart-io/
    writer.ts                    # .chart file serializer
    reader.ts                    # Wraps scan-chart parseChartFile
    timing.ts                    # msToTick (inverse of existing tickToMs)
    validate.ts                  # Pre-write validation
    song-ini.ts                  # song.ini serializer
    types.ts                     # ChartDocument, DrumNote, etc.
  ml/
    onnx-runtime.ts              # ONNX session creation, WebGPU/WASM backend
    onnx-worker.ts               # Web Worker for WASM fallback
    onnx-worker-client.ts        # Promise wrapper for worker
    demucs.ts                    # Demucs separation pipeline
    transcriber.ts               # Drum transcription inference + post-processing
  audio/
    decoder.ts                   # Web Audio API decode + resample to 44.1kHz
    stft.ts                      # STFT/iSTFT via fft.js
    wav-encoder.ts               # PCM → WAV encoding
  export/
    zip.ts                       # ZIP packaging via fflate
    sng.ts                       # SNG packaging
  storage/
    opfs.ts                      # OPFS project management (extends existing helpers)
  __tests__/
    chart-writer.test.ts         # Round-trip tests with scan-chart
    timing.test.ts               # msToTick / tickToMs consistency
    stft.test.ts                 # STFT/iSTFT correctness
    wav-encoder.test.ts          # WAV header validity
    export.test.ts               # ZIP/SNG round-trip tests
    song-ini.test.ts             # INI serialization
```

---

## 2. Existing Utilities to Reuse — DO NOT Reimplement

| Need | Existing Code | Notes |
|------|--------------|-------|
| Chart parsing | `@eliwhite/scan-chart` | `parseChartFile()`, `NoteEvent`, `noteTypes`, `noteFlags` |
| SNG parsing | `parse-sng` | Extract .sng archives |
| Tick → ms | `app/sheet-music/[slug]/chartUtils.ts` → `tickToMs()` | Consider moving to `lib/` for sharing |
| Drum lane mapping | `lib/fill-detector/drumLaneMap.ts` | `DrumVoice`, `NoteType` → voice |
| OPFS helpers | `lib/fileSystemHelpers.ts` | `writeFile()`, `readJsonFile()`, `readTextFile()` |
| INI parsing | `lib/ini-parser.ts` | Parse song.ini |
| Audio playback | `lib/preview/audioManager.ts` | Web Audio API, speed control |
| UI components | `components/ui/` | Button, Dialog, Card, Select, Slider, etc. |
| Icons | `lucide-react` | Already installed |
| Toasts | `sonner` | Already configured in root layout |
| CSS utility | `lib/utils.ts` → `cn()` | Tailwind class merging |

---

## 3. New Dependencies to Install

| Package | Purpose |
|---------|---------|
| `fft.js` | Pure JS FFT for STFT/iSTFT (Demucs preprocessing) |
| `zustand` | Editor state management with undo/redo |
| `fflate` | Browser-native ZIP compression for export |
| `wavesurfer.js` | Waveform display in editor |

ONNX Runtime Web is loaded from CDN (not bundled), following demucs-next's pattern.

---

## 4. Page Registration

Add a card on the home page (`app/page.tsx`) linking to `/drum-transcription`:

```tsx
<Link href="/drum-transcription">
  <Card>
    <CardHeader>
      <CardTitle>Drum Transcription</CardTitle>
      <CardDescription>
        Upload a song, separate drums, auto-transcribe, and export as a Clone Hero chart
      </CardDescription>
    </CardHeader>
  </Card>
</Link>
```

The page is a client component (`'use client'`) since it uses Web Audio API, ONNX Runtime, OPFS, and canvas rendering.

---

## 5. Shared Types

```typescript
// lib/drum-transcription/chart-io/types.ts
// Reuse scan-chart types directly — import NoteEvent, NoteType, noteFlags from @eliwhite/scan-chart
```

See plan 0002 for full type definitions.

---

## 6. Implementation Order

1. **Add dependencies** — `fft.js`, `zustand`, `fflate`, `wavesurfer.js`
2. **Create page shell** — `app/drum-transcription/page.tsx` with upload UI
3. **OPFS storage** — `lib/drum-transcription/storage/opfs.ts`
4. **Chart I/O** — writer + types (plan 0002)
5. **Audio decoder** (plan 0003)
6. **ONNX runtime** (plan 0004)
7. **Demucs pipeline** (plan 0004)
8. **Transcription** (plan 0005)
9. **Editor UI** (plan 0007)
10. **Export** (plan 0009)
