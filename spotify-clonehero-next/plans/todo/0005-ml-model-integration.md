# 0005 - ML Model Integration (ONNX + WebGPU)

> **Dependencies:** 0001 (types, ONNX runtime setup), 0002 (chart writing for output), 0004 (stem separation for input)
> **Unlocks:** 0007 (web editor - confidence data), 0008 (pipeline orchestration)
>
> **Integration:** Shares ONNX runtime from `lib/drum-transcription/ml/onnx-runtime.ts` with Demucs (plan 0004). Transcription pipeline in `lib/drum-transcription/ml/transcriber.ts`. Post-processing output uses chart types from `lib/drum-transcription/chart-io/types.ts`. Drum lane mapping references existing `lib/fill-detector/drumLaneMap.ts`.

## Overview

Run the drum transcription ML model in the browser via ONNX Runtime Web + WebGPU. The model takes the separated drum stem from Demucs, produces per-frame multi-label predictions, and post-processing converts those into discrete drum events for the chart.

The ONNX runtime infrastructure (WebGPU/WASM backend selection, worker fallback) is shared with the Demucs step — the same `onnx-runtime.ts` module handles both models.

---

## 1. Model Export to ONNX

The drum transcription model (CNN + transformer, developed separately in PyTorch) must be exported to ONNX for browser inference:

```python
# In the model's repository
import torch

model = load_trained_model("checkpoints/best.pt")
model.eval()

# Example input shapes (adjust to match actual model)
dummy_input = torch.randn(1, 1, 128, 431)  # [batch, channels, mel_bins, time_frames]

torch.onnx.export(
    model,
    dummy_input,
    "drum_transcription.onnx",
    input_names=["mel_spectrogram"],
    output_names=["predictions"],
    dynamic_axes={
        "mel_spectrogram": {3: "time_frames"},
        "predictions": {1: "time_frames"},
    },
    opset_version=17,
)
```

### ONNX vs PyTorch Boundary

**Like Demucs, the ONNX model should contain only the neural network.** Audio preprocessing (mel spectrogram computation) runs in JavaScript. This keeps the model portable and avoids ONNX operator limitations.

---

## 2. Audio Preprocessing in JavaScript

The browser-side preprocessing converts the drum stem PCM into mel spectrograms:

```typescript
async function computeMelSpectrogram(
  audioData: Float32Array,  // Mono, 44.1kHz
  config: SpectrogramConfig
): Promise<Float32Array> {
  // 1. STFT via fft.js (same library used by Demucs step)
  // 2. Compute mel filterbank
  // 3. Apply filterbank to get mel spectrogram
  // 4. Log compression: log(1 + mel)
  // 5. Normalize (using training statistics from model repo)
  // Returns: Float32Array of shape [n_mels, n_frames]
}

interface SpectrogramConfig {
  sampleRate: number      // 44100
  nFft: number            // 2048
  hopLength: number       // 441 (10ms) or 512 (~11.6ms) — must match model training
  nMels: number           // 128 or 256 — must match model training
  fMin: number            // 20
  fMax: number            // 16000
}
```

**Critical:** These parameters must exactly match the model's training configuration. Get them from the model repository.

### Mel Filterbank

Compute the mel filterbank matrix once and cache it:
```typescript
function createMelFilterbank(
  sampleRate: number, nFft: number, nMels: number, fMin: number, fMax: number
): Float32Array[]
```

This is a pure math function — port from `librosa.filters.mel`.

---

## 3. ONNX Inference

Use the same runtime setup from plan 0004 (shared with Demucs):

```typescript
async function runTranscriptionInference(
  melSpectrogram: Float32Array,
  nMels: number,
  nFrames: number,
  session: ort.InferenceSession
): Promise<Float32Array> {
  const inputTensor = new ort.Tensor('float32', melSpectrogram, [1, 1, nMels, nFrames])
  const results = await session.run({ mel_spectrogram: inputTensor })
  inputTensor.dispose()

  // Output shape: [1, n_frames, n_classes]
  // Values: sigmoid probabilities per class per frame
  const predictions = results.predictions
  const data = predictions.data as Float32Array
  predictions.dispose()
  return data
}
```

### Chunked Inference

For long songs, process in overlapping chunks (e.g., 10-second windows) and stitch predictions:
- Use the center region of each chunk (discard edge predictions)
- No crossfade needed for predictions — just take the most confident prediction at overlap boundaries

---

## 4. Output Parsing

The model outputs per-frame probabilities for each drum class:

```typescript
interface ModelOutput {
  /** Per-frame predictions: shape [n_frames, n_classes] */
  predictions: Float32Array
  /** Number of time frames */
  nFrames: number
  /** Number of drum classes */
  nClasses: number
  /** Class names in order */
  classNames: string[]  // ['kick', 'snare', 'closedHiHat', 'openHiHat', 'tom', 'ride', 'crash']
}

interface RawDrumEvent {
  timeSeconds: number
  drumClass: string
  confidence: number
}

function parseModelOutput(output: ModelOutput, hopLength: number, sampleRate: number): RawDrumEvent[] {
  const frameDuration = hopLength / sampleRate
  const events: RawDrumEvent[] = []

  for (let frame = 0; frame < output.nFrames; frame++) {
    for (let cls = 0; cls < output.nClasses; cls++) {
      const confidence = output.predictions[frame * output.nClasses + cls]
      if (confidence > 0.1) {  // Low initial threshold; refined in post-processing
        events.push({
          timeSeconds: frame * frameDuration,
          drumClass: output.classNames[cls],
          confidence,
        })
      }
    }
  }
  return events
}
```

---

## 5. Post-Processing Pipeline

Same as the original plan — pure JavaScript, no external dependencies:

```
Raw predictions (per-frame probabilities)
  → Per-class thresholding (configurable per instrument)
  → Peak picking (local maxima in confidence curve)
  → Refractory period filtering (prevent double-triggers)
  → Multi-label conflict resolution (hi-hat open/closed exclusivity)
  → Discrete drum events with timestamps and confidence scores
```

### Default Thresholds
```typescript
const DEFAULT_THRESHOLDS: Record<string, number> = {
  kick: 0.5, snare: 0.5, closedHiHat: 0.4,
  openHiHat: 0.5, tom: 0.5, ride: 0.45, crash: 0.5,
}
```

### Refractory Periods
```typescript
const REFRACTORY_MS: Record<string, number> = {
  kick: 50, snare: 40, closedHiHat: 30,
  openHiHat: 80, tom: 50, ride: 30, crash: 100,
}
```

---

## 6. Class-to-Chart Mapping

Same mapping as before — this is pure logic, unchanged by browser architecture:

| Model Class | Chart Note | Cymbal Marker | Notes |
|-------------|-----------|---------------|-------|
| kick | 0 | — | |
| snare | 1 | — | |
| closedHiHat | 2 | 66 | Yellow cymbal |
| openHiHat | 2 | 66 | Yellow cymbal (same lane) |
| tom | 3 | — | Default to blue; editor can reassign |
| ride | 3 | 67 | Blue cymbal |
| crash | 4 | 68 | Green cymbal |

---

## 7. Tick Quantization

Convert seconds → ticks using the tempo map. Same algorithm as plan 0002's `msToTick`, unchanged by browser architecture.

---

## 8. Confidence in Editor Events

```typescript
interface EditorDrumEvent {
  id: string
  tick: number
  msTime: number
  noteNumber: number
  cymbalMarker: number | null
  modelClass: string
  confidence: number | null  // null for manually added
  reviewed: boolean
  source: 'model' | 'manual'
}
```

---

## 9. Performance Expectations (Browser)

| Song Duration | WebGPU | WASM |
|--------------|--------|------|
| 3 min | 2-8 sec | 10-30 sec |
| 5 min | 4-15 sec | 20-60 sec |

The drum transcription model is much smaller than Demucs, so inference is faster. The bottleneck is mel spectrogram computation in JavaScript.

---

## 10. Fallback: Mock Transcription

Until the real model is exported to ONNX, use mock implementations:

### Option A: Static fixtures
Ship pre-generated prediction JSONs in `test/fixtures/` for development:
```
test/fixtures/
  model-output-rock-beat.json
  model-output-fill.json
  model-output-empty.json
```

### Option B: Existing chart as "model output"
Parse a `.chart` file with scan-chart, convert to `RawDrumEvent[]`, optionally perturb timings.

### Interface contract
```typescript
interface DrumTranscriber {
  transcribe(audioData: Float32Array, sampleRate: number): Promise<RawDrumEvent[]>
}

class OnnxTranscriber implements DrumTranscriber { /* real ONNX inference */ }
class FixtureTranscriber implements DrumTranscriber { /* load from JSON */ }
class ChartTranscriber implements DrumTranscriber { /* parse existing chart */ }
```

All implementations conform to the same interface — the pipeline swaps them without code changes.

---

## 11. Model Hosting

Host the ONNX model on a CDN (HuggingFace, GitHub Releases, or Cloudflare R2). The browser downloads and caches it on first use. Estimated model size: 20-100 MB depending on architecture.

ONNX Runtime's `InferenceSession.create()` accepts a URL directly and handles caching.
