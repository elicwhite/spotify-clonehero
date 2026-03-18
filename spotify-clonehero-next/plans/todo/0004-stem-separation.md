# 0004 - Stem Separation (Demucs via ONNX + WebGPU)

> **Dependencies:** 0001 (ONNX runtime setup, OPFS storage), 0003 (decoded audio in OPFS)
> **Unlocks:** 0005 (ML model integration)
>
> **Integration:** ONNX runtime in `lib/drum-transcription/ml/onnx-runtime.ts`. Demucs pipeline in `lib/drum-transcription/ml/demucs.ts`. STFT/iSTFT in `lib/drum-transcription/audio/stft.ts`. WASM worker fallback in `lib/drum-transcription/ml/onnx-worker.ts`. Cross-origin headers already configured in `next.config.js`.

## Overview

Run Demucs stem separation entirely in the browser using ONNX Runtime Web with WebGPU acceleration. This follows the architecture established by `demucs-next` (`~/projects/demucs-next`). No Python, no subprocess, no server.

---

## 1. Architecture

The Demucs ONNX model contains **only the neural network core**. The STFT preprocessing and iSTFT postprocessing run in JavaScript via `fft.js`.

```
Raw audio (Float32, 44.1kHz stereo)
  → Segment into 10s chunks with 50% overlap
  → For each chunk:
      → Pad (reflect, 1536 samples)
      → STFT (JS, fft.js: NFFT=4096, hop=1024, Hann window)
      → Feed spec_real, spec_imag, audio to ONNX model
      → Model returns separated spec + waveform per source
      → iSTFT (JS, fft.js) on output spectrogram
      → Add time-domain output: result = iSTFT(spec) + wave
  → Overlap-add with linear crossfade
  → Output: drums.pcm + no_drums.pcm
```

---

## 2. ONNX Model Selection

Pre-exported models on HuggingFace (`Ryan5453/demucs-onnx`):

| Model | Size | WebGPU | Quality | Speed |
|-------|------|--------|---------|-------|
| `htdemucs` | 161 MB | Yes | Very good | Fast |
| `htdemucs_6s` | 105 MB | Yes | Good | Medium |
| `hdemucs_mmi` | 320 MB | No (LSTM) | Good | Slow (WASM only) |

**Recommendation: `htdemucs`** — best quality-to-speed ratio, full WebGPU support, and drums are one of Demucs's strongest separation targets.

---

## 3. ONNX Runtime Setup

Load ONNX Runtime from CDN (same pattern as demucs-next — avoids bundling ~20MB of WASM files):

```typescript
// Load ort from CDN as a global script
// In index.html: <script src="https://cdn.jsdelivr.net/npm/onnxruntime-web@dev/dist/ort.all.min.js"></script>

async function createSession(modelUrl: string): Promise<ort.InferenceSession> {
  // Try WebGPU first
  if (navigator.gpu) {
    try {
      const adapter = await navigator.gpu.requestAdapter()
      if (adapter) {
        return await ort.InferenceSession.create(modelUrl, {
          executionProviders: ['webgpu'],
        })
      }
    } catch { /* fall through to WASM */ }
  }

  // WASM fallback (runs in Web Worker — see onnx-worker.ts)
  return createWasmSession(modelUrl)
}
```

### WASM Worker Fallback

When WebGPU is unavailable, run inference in a Web Worker to avoid blocking the UI:

```typescript
// src/ml/onnx-worker.ts
self.onmessage = async (e) => {
  if (e.data.type === 'load') {
    // Import ort via importScripts from CDN
    // Create session with executionProviders: ['wasm'], numThreads: 4
  }
  if (e.data.type === 'run') {
    // Run inference, return Float32Arrays via postMessage
  }
}
```

---

## 4. STFT / iSTFT in JavaScript

The STFT and iSTFT are **not inside the ONNX model** — they must be computed in JS. Use `fft.js` (pure JavaScript FFT, no dependencies).

Key parameters (must match the PyTorch Demucs preprocessing exactly):
- `NFFT = 4096`
- `hop_length = 1024`
- `window = hann(4096)` (normalized)
- STFT output is trimmed: last freq bin removed (2049 → 2048)

Reference implementation: `~/projects/demucs-next/web/src/utils/audio-processor.ts` (~260 lines)

**This is the most error-prone part.** The STFT/iSTFT must exactly match PyTorch's `torch.stft`/`torch.istft` behavior. Incorrect padding, windowing, or normalization will produce garbage output.

### Buffer Management

Pre-allocate all FFT buffers before the segment loop to minimize GC pressure:
```typescript
function createSTFTBuffers(nfft: number) {
  return {
    realInput: new Float64Array(nfft),
    imagInput: new Float64Array(nfft),
    realOutput: new Float64Array(nfft),
    imagOutput: new Float64Array(nfft),
    window: createHannWindow(nfft),
  }
}
```

---

## 5. Segmentation and Overlap-Add

- **Segment size:** 441,000 samples (10 seconds at 44.1kHz)
- **Overlap:** 50% (220,500 samples)
- **Crossfade:** Linear ramp over the overlap region

```typescript
function segmentAudio(audio: Float32Array, channels: number): Float32Array[] {
  const segmentSamples = 441000
  const hopSamples = segmentSamples / 2  // 50% overlap
  const totalSamples = audio.length / channels
  const segments: Float32Array[] = []

  for (let start = 0; start < totalSamples; start += hopSamples) {
    const end = Math.min(start + segmentSamples, totalSamples)
    // Extract segment, zero-pad if shorter than segmentSamples
    segments.push(extractSegment(audio, channels, start, end, segmentSamples))
  }
  return segments
}
```

### Overlap-Add with Linear Crossfade

After processing each segment, stitch them together:
- First half of overlap: fade out previous segment
- Second half of overlap: fade in current segment
- Sum the faded signals in the overlap region

---

## 6. Model I/O

### Inputs (per segment)

| Name | Shape | Type | Description |
|------|-------|------|-------------|
| `spec_real` | `[1, 2, 2048, T]` | Float32 | Real part of STFT |
| `spec_imag` | `[1, 2, 2048, T]` | Float32 | Imaginary part of STFT |
| `audio` | `[1, 2, 441000]` | Float32 | Raw waveform (time branch) |

Where `T` = number of STFT time frames after padding and trimming.

### Outputs (per segment)

| Name | Shape | Type | Description |
|------|-------|------|-------------|
| `out_spec_real` | `[1, S, 2, 2048, T]` | Float32 | Separated spectrograms (real) |
| `out_spec_imag` | `[1, S, 2, 2048, T]` | Float32 | Separated spectrograms (imag) |
| `out_wave` | `[1, S, 2, 441000]` | Float32 | Time-domain branch output |

Where `S` = number of sources (4 for htdemucs: drums, bass, other, vocals).

### Source Order

**Critical:** The source index order must match the model's training order:
```typescript
const MODEL_SOURCES = ['drums', 'bass', 'other', 'vocals'] as const
// drums is index 0
```

---

## 7. Output to OPFS

After separation, write the drum stem (and optionally the accompaniment) to OPFS:

```typescript
async function storeStem(
  projectName: string,
  stemName: string,
  pcmData: Float32Array
): Promise<void> {
  const root = await navigator.storage.getDirectory()
  const projectDir = await root.getDirectoryHandle(projectName)
  const stemsDir = await projectDir.getDirectoryHandle('stems', { create: true })
  const fileHandle = await stemsDir.getFileHandle(`${stemName}.pcm`, { create: true })
  const writable = await fileHandle.createWritable()
  await writable.write(pcmData.buffer)
  await writable.close()
}
```

Store both `drums.pcm` (for ML transcription) and `no_drums.pcm` (mix of bass+other+vocals, for editor playback context).

---

## 8. Progress Reporting

Report progress as: `segmentIndex / totalSegments`:

```typescript
interface SeparationProgress {
  step: 'loading-model' | 'processing' | 'done'
  segment?: number
  totalSegments?: number
  percent: number  // 0-1
}
```

Yield to the UI thread every few segments (via `requestAnimationFrame` or `setTimeout(0)`) to allow React to render progress updates.

---

## 9. Performance Expectations

For a 4-minute song (~24 segments at 10s with 50% overlap):

| Backend | Estimated time | Notes |
|---------|---------------|-------|
| WebGPU | 30-90 seconds | Depends on GPU |
| WASM (4 threads) | 3-8 minutes | CPU-bound |

Model download (~161 MB) is a one-time cost — the browser caches it after the first load.

---

## 10. Error Handling

| Error | Cause | Handling |
|-------|-------|----------|
| WebGPU unavailable | Old browser/hardware | Fall back to WASM worker |
| Model download failure | Network issue | Retry with exponential backoff |
| Out of GPU memory | Very long segment or low VRAM | Reduce segment size or fall back to WASM |
| ONNX inference error | Model incompatibility | Show error, suggest refreshing |
| OPFS write failure | Storage quota | Show storage error |

---

## 11. Key Differences from demucs-next

Our implementation follows demucs-next's architecture but with these differences:
- **Storage:** We use OPFS instead of blob URLs for stems (persistent, can resume)
- **Audio decoding:** Web Audio API only (no mediabunny/ffmpeg.wasm — simpler, covers common formats)
- **Integration:** Output feeds into the drum transcription ML model, not just playback
- **UI:** Progress integrated into the transcription pipeline UI, not a standalone separation tool
