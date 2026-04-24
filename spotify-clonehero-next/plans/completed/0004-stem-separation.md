# 0004 - Stem Separation (Demucs via ONNX + WebGPU)

> **Dependencies:** 0001 (ONNX runtime setup, OPFS storage), 0003 (decoded audio in OPFS)
> **Unlocks:** 0005 (ML model integration)
>
> **Integration:** ONNX runtime in `lib/drum-transcription/ml/onnx-runtime.ts`. Demucs pipeline in `lib/drum-transcription/ml/demucs.ts`. STFT/iSTFT in `lib/drum-transcription/audio/stft.ts`. Cross-origin headers already configured in `next.config.js`.
>
> **References:**
>
> - For any questions about how to make Demucs work in the browser not covered in this plan, read the code at `~/projects/demucs-next`.
> - The spec for which audio file names are supported in Clone Hero charts can be found at `~/projects/GuitarGame_ChartFormats`. Reference this when naming output stems.

## Overview

Run Demucs stem separation entirely in the browser using ONNX Runtime Web with WebGPU acceleration. This follows the architecture established by `demucs-next` (`~/projects/demucs-next`). No Python, no subprocess, no server.

**WebGPU is required.** If `navigator.gpu` is not available or no adapter can be obtained, the page should show a clear message like "WebGPU is required for this feature" and block access to the transcription tool. There is no WASM fallback.

---

## 1. Architecture

The Demucs ONNX model contains **only the neural network core**. The STFT preprocessing and iSTFT postprocessing run in JavaScript via `fft.js`.

```
Raw audio (Float32, 44.1kHz stereo)
  -> Segment into 10s chunks with 50% overlap
  -> For each chunk:
      -> Pad (reflect, 1536 samples)
      -> STFT (JS, fft.js: NFFT=4096, hop=1024, Hann window)
      -> Feed spec_real, spec_imag, audio to ONNX model
      -> Model returns separated spec + waveform per source (4 sources)
      -> iSTFT (JS, fft.js) on output spectrogram
      -> Add time-domain output: result = iSTFT(spec) + wave
  -> Overlap-add with linear crossfade
  -> Output: drums.pcm, bass.pcm, other.pcm, vocals.pcm
```

---

## 2. ONNX Model Selection

Pre-exported models on HuggingFace (`Ryan5453/demucs-onnx`):

| Model         | Size   | WebGPU    | Quality             | Speed  |
| ------------- | ------ | --------- | ------------------- | ------ |
| `htdemucs`    | 161 MB | Yes       | Very good           | Fast   |
| `htdemucs_6s` | 105 MB | Yes       | Good                | Medium |
| `hdemucs_mmi` | 320 MB | No (LSTM) | N/A (requires WASM) | N/A    |

**Recommendation: `htdemucs`** -- best quality-to-speed ratio, full WebGPU support, and drums are one of Demucs's strongest separation targets.

---

## 3. ONNX Runtime Setup

Load ONNX Runtime from CDN (same pattern as demucs-next -- avoids bundling ~20MB of WASM files):

```typescript
// Load ort from CDN as a global script
// In index.html: <script src="https://cdn.jsdelivr.net/npm/onnxruntime-web@dev/dist/ort.all.min.js"></script>

async function createSession(modelUrl: string): Promise<ort.InferenceSession> {
  if (!navigator.gpu) {
    throw new Error('WebGPU is required for this feature');
  }

  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    throw new Error('WebGPU is required for this feature');
  }

  return await ort.InferenceSession.create(modelUrl, {
    executionProviders: ['webgpu'],
  });
}
```

The calling code should catch this error and display a user-facing message blocking access to the transcription pipeline.

---

## 4. STFT / iSTFT in JavaScript

The STFT and iSTFT are **not inside the ONNX model** -- they must be computed in JS. Use `fft.js` (pure JavaScript FFT, no dependencies).

Key parameters (must match the PyTorch Demucs preprocessing exactly):

- `NFFT = 4096`
- `hop_length = 1024`
- `window = hann(4096)` (normalized)
- STFT output is trimmed: last freq bin removed (2049 -> 2048)

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
  };
}
```

---

## 5. Segmentation and Overlap-Add

- **Segment size:** 441,000 samples (10 seconds at 44.1kHz)
- **Overlap:** 50% (220,500 samples)
- **Crossfade:** Linear ramp over the overlap region

```typescript
function segmentAudio(audio: Float32Array, channels: number): Float32Array[] {
  const segmentSamples = 441000;
  const hopSamples = segmentSamples / 2; // 50% overlap
  const totalSamples = audio.length / channels;
  const segments: Float32Array[] = [];

  for (let start = 0; start < totalSamples; start += hopSamples) {
    const end = Math.min(start + segmentSamples, totalSamples);
    // Extract segment, zero-pad if shorter than segmentSamples
    segments.push(extractSegment(audio, channels, start, end, segmentSamples));
  }
  return segments;
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

| Name        | Shape             | Type    | Description                |
| ----------- | ----------------- | ------- | -------------------------- |
| `spec_real` | `[1, 2, 2048, T]` | Float32 | Real part of STFT          |
| `spec_imag` | `[1, 2, 2048, T]` | Float32 | Imaginary part of STFT     |
| `audio`     | `[1, 2, 441000]`  | Float32 | Raw waveform (time branch) |

Where `T` = number of STFT time frames after padding and trimming.

### Outputs (per segment)

| Name            | Shape                | Type    | Description                                     |
| --------------- | -------------------- | ------- | ----------------------------------------------- |
| `out_spec_real` | `[1, 4, 2, 2048, T]` | Float32 | Separated spectrograms (real) for all 4 sources |
| `out_spec_imag` | `[1, 4, 2, 2048, T]` | Float32 | Separated spectrograms (imag) for all 4 sources |
| `out_wave`      | `[1, 4, 2, 441000]`  | Float32 | Time-domain branch output for all 4 sources     |

The model always outputs all 4 sources: drums (index 0), bass (index 1), other (index 2), vocals (index 3). Each source is extracted by slicing the source dimension.

### Source Order

**Critical:** The source index order must match the model's training order:

```typescript
const MODEL_SOURCES = ['drums', 'bass', 'other', 'vocals'] as const;
// drums=0, bass=1, other=2, vocals=3
```

---

## 7. Output to OPFS

After separation, store all 4 stems individually to OPFS:

```typescript
async function storeStem(
  projectName: string,
  stemName: string,
  pcmData: Float32Array,
): Promise<void> {
  const root = await navigator.storage.getDirectory();
  const projectDir = await root.getDirectoryHandle(projectName);
  const stemsDir = await projectDir.getDirectoryHandle('stems', {create: true});
  const fileHandle = await stemsDir.getFileHandle(`${stemName}.pcm`, {
    create: true,
  });
  const writable = await fileHandle.createWritable();
  await writable.write(pcmData.buffer);
  await writable.close();
}

// Store all 4 stems
for (const [i, name] of MODEL_SOURCES.entries()) {
  await storeStem(projectName, name, separatedSources[i]);
}
```

### OPFS Project Structure

```
drum-transcription/
  {project-name}/
    audio/
      full.pcm                  # Decoded audio (Float32 interleaved, 44.1kHz stereo)
      meta.json                 # Duration, sample rate, etc.
    stems/
      drums.pcm                 # Separated drum stem
      bass.pcm                  # Separated bass stem
      other.pcm                 # Separated other/instruments stem
      vocals.pcm                # Separated vocals stem
    chart/
      notes.chart               # ML-generated chart
      notes.edited.chart        # Human-edited chart
      confidence.json           # Per-note ML confidence scores
```

The `drums.pcm` stem feeds into the ML transcription model (plan 0005). All stems are available for editor playback (plan 0007) and chart export packaging (plan 0009).

---

## 8. Progress Reporting

Report progress as: `segmentIndex / totalSegments`:

```typescript
interface SeparationProgress {
  step: 'loading-model' | 'processing' | 'done';
  segment?: number;
  totalSegments?: number;
  percent: number; // 0-1
}
```

Yield to the UI thread every few segments (via `requestAnimationFrame` or `setTimeout(0)`) to allow React to render progress updates.

---

## 9. Performance Expectations

For a 4-minute song (~24 segments at 10s with 50% overlap):

| Backend | Estimated time | Notes          |
| ------- | -------------- | -------------- |
| WebGPU  | 30-90 seconds  | Depends on GPU |

Model download (~161 MB) is a one-time cost -- the browser caches it after the first load.

---

## 10. Error Handling

| Error                  | Cause                         | Handling                                                    |
| ---------------------- | ----------------------------- | ----------------------------------------------------------- |
| WebGPU unavailable     | Old browser/hardware          | Show "WebGPU is required for this feature" and block access |
| Model download failure | Network issue                 | Retry with exponential backoff                              |
| Out of GPU memory      | Very long segment or low VRAM | Reduce segment size, show error                             |
| ONNX inference error   | Model incompatibility         | Show error, suggest refreshing                              |
| OPFS write failure     | Storage quota                 | Show storage error                                          |

---

## 11. Key Differences from demucs-next

Our implementation follows demucs-next's architecture but with these differences:

- **Storage:** We use OPFS instead of blob URLs for stems (persistent, can resume)
- **Audio decoding:** Web Audio API only (no mediabunny/ffmpeg.wasm -- simpler, covers common formats)
- **Integration:** Output feeds into the drum transcription ML model, not just playback
- **UI:** Progress integrated into the transcription pipeline UI, not a standalone separation tool
- **All 4 stems stored:** We keep drums, bass, other, and vocals separately for export packaging and editor playback
