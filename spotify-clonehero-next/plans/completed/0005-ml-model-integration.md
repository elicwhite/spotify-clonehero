# 0005 - ML Model Integration (ONNX + WebGPU)

> **Dependencies:** 0001 (types, ONNX runtime setup), 0002 (chart writing for output), 0004 (stem separation for input)
> **Unlocks:** 0007 (web editor - confidence data), 0008 (pipeline orchestration)
>
> **Integration:** Shares ONNX runtime (WebGPU only, no WASM fallback) from `lib/drum-transcription/ml/onnx-runtime.ts` with Demucs (plan 0004). Transcription pipeline in `lib/drum-transcription/ml/transcriber.ts`. Post-processing output uses chart types from `lib/drum-transcription/chart-io/types.ts`. Drum lane mapping references existing `lib/fill-detector/drumLaneMap.ts`.

## Overview

Run the ADTOF drum transcription model (Frame_RNN) in the browser via ONNX Runtime Web + WebGPU. This is an interim solution using the pre-trained ADTOF model while the custom ML model (in `~/projects/drum-transcription`) is still under development.

ADTOF is a CRNN (Convolutional Recurrent Neural Network) built in TensorFlow/Keras. It takes a log-filtered spectrogram, processes it through CNN layers followed by 3 bidirectional GRU layers, and outputs per-frame sigmoid probabilities for 5 drum classes. The model must be converted from TensorFlow to ONNX for browser inference.

The ONNX runtime infrastructure (WebGPU only — no WASM fallback, per plan 0004) is shared with the Demucs step — the same `onnx-runtime.ts` module handles both models.

---

## 1. Model Export to ONNX

The ADTOF Frame_RNN model is a TensorFlow/Keras model. The pre-trained weights live at `~/projects/ADTOF/adtof/models/Frame_RNN_adtofAll_0` (~5.2 MB). Export via `tf2onnx`:

```python
# export_adtof_onnx.py — run in the ADTOF project environment
# Requires: pip install tf2onnx

from adtof.model.model import Model
import tf2onnx
import tensorflow as tf

# Load the pre-trained model
model, hparams = Model.modelFactory(
    modelName="Frame_RNN", scenario="adtofAll", fold=0
)
assert model.weightLoadedFlag, "Pre-trained weights not found"

keras_model = model.model

# The model input shape is (batch, time_frames, n_bins, 1)
# n_bins = 84 (12 bands/octave, fmin=20, fmax=20000, frameSize=2048, sr=44100)
# time_frames is variable (None)
input_spec = (tf.TensorSpec((1, None, 84, 1), tf.float32, name="spectrogram"),)

onnx_model, _ = tf2onnx.convert.from_keras(
    keras_model,
    input_signature=input_spec,
    opset=17,
    output_path="adtof_frame_rnn.onnx",
)
print("Exported to adtof_frame_rnn.onnx")
```

### Verifying the export

```python
import onnxruntime as ort
import numpy as np

session = ort.InferenceSession("adtof_frame_rnn.onnx")
# Test with a dummy input: 10 seconds at 100 fps = 1000 frames, 84 frequency bins
dummy = np.random.randn(1, 1000, 84, 1).astype(np.float32)
result = session.run(None, {"spectrogram": dummy})
print(result[0].shape)  # Expected: (1, 1000, 5)
```

### ONNX vs TensorFlow Boundary

**Like Demucs, the ONNX model contains only the neural network.** Audio preprocessing (spectrogram computation) runs in JavaScript. This keeps the model portable and avoids ONNX operator limitations with madmom's custom signal processing.

### Model Architecture Summary

The Frame_RNN is a CRNN with same-padding:

- **CNN encoder:** 2 conv blocks, each with 2x Conv2D(3x3) + BatchNorm + MaxPool(1x3) + Dropout(0.3). Filter counts: [32, 64].
- **Context stacking:** Flatten CNN output per time step (no additional context frames needed since context=9 equals the CNN receptive field).
- **RNN:** 3x Bidirectional GRU layers with 60 units each.
- **Output:** Dense layer with sigmoid activation, 5 classes.
- **Total size:** ~5.2 MB weights. ONNX model expected to be ~5-8 MB.

---

## 2. Audio Preprocessing in JavaScript

ADTOF uses madmom's `LogarithmicFilteredSpectrogram` for preprocessing. This must be replicated in JavaScript.

```typescript
async function computeLogFilteredSpectrogram(
  audioData: Float32Array, // Mono, 44100 Hz
  config: SpectrogramConfig,
): Promise<Float32Array> {
  // 1. STFT via fft.js: frame_size=2048, hop_length=441 (fps=100)
  // 2. Compute magnitude spectrogram
  // 3. Apply logarithmic filterbank (triangular filters, 12 bands/octave)
  //    - 84 frequency bins from 20 Hz to 20000 Hz
  //    - Normalized triangular filters (norm=True, overlap=True)
  // 4. Log compression: log(magnitude + 1) (madmom's LogarithmicFilteredSpectrogram default)
  // Returns: Float32Array of shape [n_frames, 84]
}

interface SpectrogramConfig {
  sampleRate: number; // 44100
  frameSize: number; // 2048
  fps: number; // 100 (frames per second, so hop_length = 44100/100 = 441)
  bandsPerOctave: number; // 12
  fMin: number; // 20
  fMax: number; // 20000
}
```

**Critical:** These parameters must exactly match ADTOF's training configuration. The values above come from `adtof/model/hyperparameters.py` (the `Frame_RNN` model inherits from `default`).

### Logarithmic Filterbank

ADTOF uses madmom's `LogarithmicFilterbank` rather than a standard mel filterbank. The key differences:

- Frequency bands are spaced logarithmically (12 bands per octave) rather than on the mel scale
- Triangular filters with normalization
- This produces 84 frequency bins for the given fmin/fmax/bandsPerOctave

Port the filterbank computation from madmom:

```typescript
function createLogFilterbank(
  sampleRate: number, // 44100
  frameSize: number, // 2048
  bandsPerOctave: number, // 12
  fMin: number, // 20
  fMax: number, // 20000
): Float32Array[]; // 84 triangular filters
```

The filterbank matrix is computed once and cached. This is deterministic pure math -- port from `madmom.audio.filters.LogarithmicFilterbank`.

### Hop Length / FPS

ADTOF uses `fps=100` (frames per second), which at 44100 Hz sample rate gives `hop_length = Math.round(44100 / 100) = 441`. This is the same library used by the madmom processors internally.

---

## 3. ONNX Inference

Use the same runtime setup from plan 0004 (shared with Demucs):

```typescript
async function runTranscriptionInference(
  spectrogram: Float32Array, // shape: [n_frames, 84]
  nFrames: number,
  session: ort.InferenceSession,
): Promise<Float32Array> {
  // ADTOF input shape: [batch=1, time_frames, n_bins=84, channels=1]
  const inputTensor = new ort.Tensor('float32', spectrogram, [
    1,
    nFrames,
    84,
    1,
  ]);
  const results = await session.run({spectrogram: inputTensor});
  inputTensor.dispose();

  // Output shape: [1, n_frames, 5]
  // Values: sigmoid probabilities per class per frame
  const predictions = results[Object.keys(results)[0]];
  const data = predictions.data as Float32Array;
  predictions.dispose();
  return data;
}
```

### Chunked Inference

For long songs, ADTOF's own inference code processes in overlapping windows. The Frame_RNN uses:

- Window size: 60000 frames (10 minutes at 100 fps) -- effectively the whole song for most tracks
- Warmup (overlap): `trainingSequence` = 412 frames at each end
- Step: `window - 2 * warmup`

For browser inference, use a simpler strategy since most songs fit in a single window at 100 fps (a 5-minute song is only 30,000 frames). If chunking is needed:

- Process in windows of 30,000 frames with 412-frame overlap
- Use the center region of each chunk (discard the warmup region at edges)

---

## 4. Output Parsing

The model outputs per-frame probabilities for 5 drum classes. ADTOF's class labels are defined by General MIDI pitch numbers:

```typescript
/** ADTOF's 5 output classes, in order */
const ADTOF_CLASSES = [
  {index: 0, midiPitch: 35, name: 'BD', description: 'Bass Drum'},
  {index: 1, midiPitch: 38, name: 'SD', description: 'Snare Drum'},
  {
    index: 2,
    midiPitch: 47,
    name: 'TT',
    description: 'Tom-Tom (all toms grouped)',
  },
  {
    index: 3,
    midiPitch: 42,
    name: 'HH',
    description: 'Hi-Hat (open + closed grouped)',
  },
  {
    index: 4,
    midiPitch: 49,
    name: 'CY+RD',
    description: 'Cymbal + Ride (all cymbals grouped)',
  },
] as const;

interface ModelOutput {
  /** Per-frame predictions: shape [n_frames, 5] */
  predictions: Float32Array;
  nFrames: number;
  nClasses: 5;
  classes: typeof ADTOF_CLASSES;
}

interface RawDrumEvent {
  timeSeconds: number;
  drumClass: string; // 'BD' | 'SD' | 'TT' | 'HH' | 'CY+RD'
  midiPitch: number; // 35, 38, 47, 42, or 49
  confidence: number;
}

function parseModelOutput(output: ModelOutput, fps: number): RawDrumEvent[] {
  const frameDuration = 1.0 / fps; // 1/100 = 0.01 seconds
  const events: RawDrumEvent[] = [];

  for (let frame = 0; frame < output.nFrames; frame++) {
    for (let cls = 0; cls < output.nClasses; cls++) {
      const confidence = output.predictions[frame * output.nClasses + cls];
      if (confidence > 0.1) {
        // Low initial threshold; refined in post-processing
        events.push({
          timeSeconds: frame * frameDuration,
          drumClass: output.classes[cls].name,
          midiPitch: output.classes[cls].midiPitch,
          confidence,
        });
      }
    }
  }
  return events;
}
```

---

## 5. Post-Processing Pipeline

ADTOF uses madmom's `NotePeakPickingProcessor` for post-processing. This must be ported to JavaScript:

```
Raw predictions (per-frame sigmoid probabilities, shape [n_frames, 5])
  -> Per-class peak picking (madmom-style, with per-class thresholds)
  -> Discrete drum events with timestamps and confidence scores
```

### Peak Picking Algorithm

ADTOF's peak picking uses madmom's `NotePeakPickingProcessor` with these parameters:

```typescript
interface PeakPickingParams {
  smooth: number; // 0 (no smoothing)
  preAvg: number; // 0.1 seconds (pre-average window)
  postAvg: number; // 0.01 seconds (post-average window)
  preMax: number; // 0.02 seconds (pre-max window)
  postMax: number; // 0.01 seconds (post-max window)
  combine: number; // 0.02 seconds (combine window)
  fps: number; // 100
}
```

The algorithm (from madmom source):

1. **Moving average:** Compute local average using `preAvg` and `postAvg` windows
2. **Moving maximum:** Compute local max using `preMax` and `postMax` windows
3. **Threshold + local max test:** A frame is a peak if:
   - Its value exceeds the threshold
   - Its value equals the local maximum
   - Its value exceeds the local average
4. **Combine:** Merge detections within `combine` window (keep the one with highest activation)

### Default Thresholds (from trained model)

ADTOF's Frame_RNN model has per-class optimized thresholds:

```typescript
const ADTOF_THRESHOLDS: Record<string, number> = {
  BD: 0.22, // Bass Drum
  SD: 0.24, // Snare Drum
  TT: 0.32, // Tom-Tom
  HH: 0.22, // Hi-Hat
  'CY+RD': 0.3, // Cymbal + Ride
};
```

These thresholds were optimized during ADTOF's validation and are stored in `hyperparameters.py` under the `Frame_RNN` model definition.

---

## 6. Class-to-Chart Mapping

ADTOF outputs 5 classes. Note that ADTOF groups all toms together and all cymbals (including ride) together, so chart mapping is slightly less granular than an ideal 7-class model:

| ADTOF Class         | MIDI Pitch | Chart Note | Cymbal Marker | Notes                                           |
| ------------------- | ---------- | ---------- | ------------- | ----------------------------------------------- |
| BD (Bass Drum)      | 35         | 0          | --            |                                                 |
| SD (Snare Drum)     | 38         | 1          | --            |                                                 |
| HH (Hi-Hat)         | 42         | 2          | 66            | Yellow cymbal. Open/closed not distinguished.   |
| TT (Tom-Tom)        | 47         | 3          | --            | Blue pad. All toms grouped into one class.      |
| CY+RD (Cymbal+Ride) | 49         | 4          | 68            | Green cymbal. Crash and ride not distinguished. |

### Limitations of 5-class output

ADTOF's 5-class grouping means:

- **No open/closed hi-hat distinction** -- both map to the same HH class. The editor can let users manually split these.
- **No crash vs ride distinction** -- both map to CY+RD. Could be post-processed with heuristics (sustained hits = crash, repeated 8th/16th notes = ride) or left for manual editing.
- **All toms grouped** -- high, mid, and floor toms are one class. The editor can let users reassign to different tom lanes.

When the custom ML model from `~/projects/drum-transcription` is ready, it should target more classes (7-8) to address these limitations.

---

## 7. Tick Quantization

Convert seconds to ticks using the tempo map. Same algorithm as plan 0002's `msToTick`, unchanged by browser architecture.

---

## 8. Confidence in Editor Events

```typescript
interface EditorDrumEvent {
  id: string;
  tick: number;
  msTime: number;
  noteNumber: number;
  cymbalMarker: number | null;
  modelClass: string; // 'BD' | 'SD' | 'TT' | 'HH' | 'CY+RD'
  confidence: number | null; // null for manually added
  reviewed: boolean;
  source: 'model' | 'manual';
}
```

---

## 9. Performance Expectations (Browser)

| Song Duration | WebGPU  | WASM      |
| ------------- | ------- | --------- |
| 3 min         | 1-4 sec | 5-15 sec  |
| 5 min         | 2-8 sec | 10-30 sec |

The ADTOF Frame_RNN model is very small (~5 MB ONNX). At 100 fps, a 5-minute song produces 30,000 frames with 84 frequency bins -- this is a modest input. The CRNN architecture (2 conv blocks + 3 BiGRU layers) is lightweight. The main bottleneck will be the spectrogram computation in JavaScript, not the model inference.

---

## 10. Fallback: Mock Transcription

Until the ADTOF model is exported to ONNX and the spectrogram preprocessing is ported, use mock implementations:

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
  transcribe(
    audioData: Float32Array,
    sampleRate: number,
  ): Promise<RawDrumEvent[]>;
}

class OnnxTranscriber implements DrumTranscriber {
  /* real ONNX inference with ADTOF */
}
class FixtureTranscriber implements DrumTranscriber {
  /* load from JSON */
}
class ChartTranscriber implements DrumTranscriber {
  /* parse existing chart */
}
```

All implementations conform to the same interface -- the pipeline swaps them without code changes. When the custom model from `~/projects/drum-transcription` is ready, it will be another implementation of this same interface.

---

## 11. Model Hosting

Host the ONNX model on a CDN (HuggingFace, GitHub Releases, or Cloudflare R2). The browser downloads and caches it on first use. Expected ONNX model size: ~5-8 MB (the TF checkpoint is 5.2 MB).

ONNX Runtime's `InferenceSession.create()` accepts a URL directly and handles caching.

**License note:** ADTOF is licensed under CC BY-NC-SA 4.0. This is a non-commercial license. Verify this is acceptable for the intended use of the web app.

---

## 12. Future: Custom Model Replacement

The ADTOF integration is an interim solution. The custom ML model being developed in `~/projects/drum-transcription` will eventually replace it. When ready, the custom model should:

- Target 7-8 drum classes (separating open/closed hi-hat, crash vs ride, multiple tom positions)
- Be trained on the same ADTOF dataset plus additional sources
- Export directly to ONNX from PyTorch
- Implement the same `DrumTranscriber` interface

The preprocessing pipeline may differ (mel spectrogram vs log-filtered spectrogram), but the post-processing and chart mapping stages will remain largely the same.
