# 0008 - Pipeline Orchestration

> **Dependencies:** 0003 (audio input), 0004 (stem separation), 0005 (ML transcription), 0007 (editor)
> **Unlocks:** End-to-end pipeline

## Overview

Orchestrate the full browser-based pipeline within the Next.js page at `/drum-transcription`: audio upload → Demucs separation → ML transcription → editor → export. All state flows through Zustand + OPFS. No CLI, no server logic.

---

## 1. Pipeline Flow

```
User uploads audio (or clicks "Try Demo" → fetch('/drumsample.mp3'))
  → Decode to 44.1kHz stereo Float32 (Web Audio API)
  → Store decoded PCM in OPFS via lib/fileSystemHelpers.ts patterns
  → Run Demucs (ONNX + WebGPU) → drums.pcm + no_drums.pcm in OPFS
  → Run drum transcription (ONNX + WebGPU) → notes.chart in OPFS
  → Switch to editor view (React state change, same page)
  → User edits chart
  → Export as .zip or .sng (browser download)
```

---

## 2. State Management

```typescript
// app/drum-transcription/store.ts
import { create } from 'zustand'

interface PipelineState {
  step: 'idle' | 'decoding' | 'separating' | 'transcribing' | 'ready' | 'editing' | 'exporting' | 'error'
  progress: number  // 0-1 within current step
  error?: string
  projectName?: string
}
```

The page renders different views based on `step`:
- `idle` → `<AudioUploader />` with "Try Demo" button + existing project list
- `decoding` / `separating` / `transcribing` → `<ProcessingView />` with progress bars
- `ready` / `editing` → `<EditorApp />` (waveform, drum grid, highway, transport)
- `exporting` → `<ExportDialog />`
- `error` → Error card with retry button (using shadcn `Card` + `Button`)

---

## 3. Pipeline Runner

```typescript
// lib/drum-transcription/pipeline/runner.ts

export async function runPipeline(
  audioFile: File | ArrayBuffer,
  fileName: string,
  onProgress: (state: PipelineState) => void
): Promise<string> {
  const projectName = slugify(fileName)

  // Each step checks OPFS for existing output before running (resumability)
  if (!await stepDone(projectName, 'decode')) {
    onProgress({ step: 'decoding', progress: 0, projectName })
    await decodeAndStore(audioFile, projectName)
  }

  if (!await stepDone(projectName, 'separate')) {
    onProgress({ step: 'separating', progress: 0, projectName })
    await runDemucs(projectName, p => onProgress({ step: 'separating', progress: p, projectName }))
  }

  if (!await stepDone(projectName, 'transcribe')) {
    onProgress({ step: 'transcribing', progress: 0, projectName })
    await runTranscription(projectName, p => onProgress({ step: 'transcribing', progress: p, projectName }))
  }

  onProgress({ step: 'ready', progress: 1, projectName })
  return projectName
}
```

---

## 4. OPFS Project Structure

```
/ (OPFS root)
  drum-transcription/             # Namespace to avoid conflicts with existing OPFS data
    {project-name}/
      project.json                # Pipeline state + metadata
      audio/
        full.pcm                  # Decoded audio (Float32 interleaved, 44.1kHz stereo)
        meta.json                 # Duration, sample rate, etc.
      stems/
        drums.pcm                 # Separated drum stem
        no_drums.pcm              # Accompaniment
      chart/
        notes.chart               # ML-generated chart
        confidence.json           # Per-note ML confidence scores
        notes.edited.chart        # Human-edited chart
```

Uses existing `lib/fileSystemHelpers.ts` patterns for reads/writes. Namespace under `drum-transcription/` to avoid collisions with existing OPFS data (SQLocal DB, chorus caches, etc.).

---

## 5. Existing Project List

On load, scan OPFS `drum-transcription/` for existing projects:

```typescript
async function listProjects(): Promise<string[]> {
  const root = await navigator.storage.getDirectory()
  try {
    const dtDir = await root.getDirectoryHandle('drum-transcription')
    const names: string[] = []
    for await (const [name, handle] of dtDir) {
      if (handle.kind === 'directory') names.push(name)
    }
    return names
  } catch {
    return []
  }
}
```

Show as a list below the upload area. Users can resume editing or re-export.

---

## 6. Implementation Order

### Phase 1: Core plumbing
1. OPFS storage helpers (`lib/drum-transcription/storage/opfs.ts`)
2. Pipeline state (Zustand store)
3. Audio decoder
4. Page shell with upload + processing views

### Phase 2: ML pipeline
5. ONNX runtime setup
6. Demucs pipeline
7. Transcription pipeline

### Phase 3: Editor
8. Chart I/O
9. Editor components
10. chart-preview integration

### Phase 4: Export
11. ZIP/SNG packaging (plan 0009)
