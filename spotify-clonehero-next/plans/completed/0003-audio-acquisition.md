# 0003 - Audio Input

> **Dependencies:** 0001 (project structure, OPFS storage)
> **Unlocks:** 0004 (stem separation)
>
> **Integration:** Uses existing `lib/fileSystemHelpers.ts` for OPFS writes. Demo file at `public/drumsample.mp3`. Audio decoder in `lib/drum-transcription/audio/decoder.ts`. Upload UI in `app/drum-transcription/components/AudioUploader.tsx`.

## Overview

The app runs fully in the browser — no yt-dlp, no backend. Users provide audio via file upload or by using the built-in demo sample (`drumsample.mp3`). Audio is decoded to 44.1kHz stereo Float32 PCM via the Web Audio API and stored in OPFS.

---

## 1. Input Methods

### File Upload
- Standard `<input type="file" accept="audio/*">` or drag-and-drop zone
- Supported formats: anything the browser can decode (MP3, WAV, FLAC, OGG, AAC, M4A, WebM)
- No format conversion needed — Web Audio API handles decoding

### Demo Sample
- `public/drumsample.mp3` ships with the app (320kbps, 44.1kHz stereo)
- One-click "Try Demo" button fetches it via `fetch('/drumsample.mp3')`
- Enables users to explore the full pipeline without uploading anything

---

## 2. Audio Decoding

Use the Web Audio API to decode any supported audio format to raw PCM:

```typescript
async function decodeAudio(arrayBuffer: ArrayBuffer): Promise<AudioBuffer> {
  // OfflineAudioContext at 44.1kHz ensures consistent sample rate
  // regardless of source format
  const tempCtx = new AudioContext()
  const decoded = await tempCtx.decodeAudioData(arrayBuffer)
  await tempCtx.close()

  // Resample to 44.1kHz if needed
  if (decoded.sampleRate !== 44100) {
    const offlineCtx = new OfflineAudioContext(
      2, // stereo
      Math.ceil(decoded.duration * 44100),
      44100
    )
    const source = offlineCtx.createBufferSource()
    source.buffer = decoded
    source.connect(offlineCtx.destination)
    source.start()
    return offlineCtx.startRendering()
  }

  return decoded
}
```

### Output Format
- **Sample rate:** 44100 Hz (Demucs native rate)
- **Channels:** 2 (stereo) — mono files are duplicated to stereo
- **Format:** Float32 PCM (AudioBuffer's native format)

---

## 3. OPFS Storage

After decoding, store the raw PCM data in OPFS for the pipeline to consume:

```typescript
async function storeAudio(
  projectName: string,
  audioBuffer: AudioBuffer
): Promise<void> {
  const root = await navigator.storage.getDirectory()
  const projectDir = await root.getDirectoryHandle(projectName, { create: true })
  const audioDir = await projectDir.getDirectoryHandle('audio', { create: true })

  // Store as raw Float32 interleaved PCM (compact, no encoding overhead)
  const left = audioBuffer.getChannelData(0)
  const right = audioBuffer.getChannelData(1)
  const interleaved = new Float32Array(left.length * 2)
  for (let i = 0; i < left.length; i++) {
    interleaved[i * 2] = left[i]
    interleaved[i * 2 + 1] = right[i]
  }

  const fileHandle = await audioDir.getFileHandle('full.pcm', { create: true })
  const writable = await fileHandle.createWritable()
  await writable.write(interleaved.buffer)
  await writable.close()

  // Store metadata
  const metaHandle = await audioDir.getFileHandle('meta.json', { create: true })
  const metaWritable = await metaHandle.createWritable()
  await metaWritable.write(JSON.stringify({
    sampleRate: 44100,
    channels: 2,
    samples: left.length,
    durationMs: (left.length / 44100) * 1000,
  }))
  await metaWritable.close()
}
```

### OPFS Project Structure

```
/ (OPFS root)
  drum-transcription/             # Namespaced to avoid conflicts with existing OPFS data
    {project-name}/
      audio/
        full.pcm              # Decoded audio (Float32 interleaved)
        meta.json             # Sample rate, channels, duration
      stems/
        drums.pcm             # Separated drum stem
        bass.pcm              # Separated bass stem
        other.pcm             # Separated other stem
        vocals.pcm            # Separated vocals stem
      chart/
        notes.chart           # ML-generated chart
        notes.edited.chart    # Human-edited chart
      project.json            # Project metadata and state
```

Note: The `drum-transcription/` namespace prevents collisions with existing OPFS data used by other features (SQLocal DB at root, `serverData/`, `localData/`, etc.).

---

## 4. Metadata Extraction

Limited metadata is available in the browser (no yt-dlp JSON dump):
- **File name** — used as the song name (strip extension)
- **Duration** — from `AudioBuffer.duration`
- **Sample rate** — from decoded AudioBuffer (before resample)
- **File size** — from the original File object

```typescript
interface AudioMetadata {
  name: string
  originalFileName: string
  durationMs: number
  originalSampleRate: number
  fileSizeBytes: number
}
```

For the demo sample, hardcode metadata: `{ name: 'Demo Drum Sample', ... }`.

---

## 5. Error Handling

| Error | Cause | Handling |
|-------|-------|----------|
| Decode failure | Unsupported codec (rare) | Show error with supported formats list |
| File too large | Very long audio (>30 min) | Warn user; processing will be slow |
| OPFS write failure | Storage quota exceeded | Show storage error, suggest clearing old projects |
| No audio channels | Corrupt file | Show error |

---

## 6. UI Components

### `<AudioUploader>`
- Drag-and-drop zone with file picker fallback
- "Try Demo" button that loads `drumsample.mp3`
- Shows file name, duration, size after selection
- "Start Processing" button to begin the pipeline

### Upload Flow
```
User drops file  →  decode via Web Audio API  →  store in OPFS  →  begin pipeline
     or
User clicks "Try Demo"  →  fetch('/drumsample.mp3')  →  same flow
```

---

## 7. Integration with Step 2 (Demucs)

The Demucs pipeline reads audio from OPFS as a Float32Array:

```typescript
async function loadAudioForDemucs(projectName: string): Promise<Float32Array> {
  const root = await navigator.storage.getDirectory()
  const projectDir = await root.getDirectoryHandle(projectName)
  const audioDir = await projectDir.getDirectoryHandle('audio')
  const fileHandle = await audioDir.getFileHandle('full.pcm')
  const file = await fileHandle.getFile()
  return new Float32Array(await file.arrayBuffer())
}
```

Demucs expects `[2, N]` (channels-first) — the loader reshapes the interleaved `[N*2]` data accordingly.
