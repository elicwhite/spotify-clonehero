/**
 * ONNX Runtime Web setup for the drum transcription pipeline.
 *
 * Loads ONNX Runtime from CDN as a global script (avoids bundling ~20MB of
 * WASM files). WebGPU is the primary execution provider with WASM as an
 * explicit fallback for ops that WebGPU does not support (e.g. Shape,
 * Gather). If WebGPU is unavailable the caller must block access to the
 * transcription feature.
 *
 * Usage:
 *   1. Include the CDN script in your page's <head>:
 *      <script src="https://cdn.jsdelivr.net/npm/onnxruntime-web@dev/dist/ort.all.min.js"></script>
 *   2. Call `getOrt()` to access the runtime, `createInferenceSession()` to
 *      load a model.
 */

// ---------------------------------------------------------------------------
// ORT global access
// ---------------------------------------------------------------------------

/**
 * Shape of the `ort` global loaded from the CDN script.
 * We only reference the bits we need so this file has zero npm dependencies
 * on onnxruntime-web (the types come from the CDN build).
 */
export interface OrtGlobal {
  InferenceSession: {
    create(
      uri: string,
      options?: {executionProviders: string[]; graphOptimizationLevel?: string},
    ): Promise<OrtInferenceSession>;
  };
  Tensor: new (
    type: string,
    data: Float32Array,
    dims: number[],
  ) => OrtTensor;
  env: {
    wasm: {wasmPaths: string; numThreads: number};
    logLevel: string;
  };
}

export interface OrtTensor {
  data: Float32Array;
  dims: number[];
  dispose(): void;
}

export interface OrtInferenceSession {
  run(feeds: Record<string, OrtTensor>): Promise<Record<string, OrtTensor>>;
  release(): Promise<void>;
}

/**
 * Returns the `ort` global injected by the CDN script.
 * Throws if the script has not been loaded yet.
 */
/** CDN base URL — must match the version loaded via <Script> in page.tsx. */
const ORT_CDN_BASE =
  'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.0-dev.20251116-b39e144322/dist/';

let ortConfigured = false;

export function getOrt(): OrtGlobal {
  const g = globalThis as unknown as {ort?: OrtGlobal};
  if (!g.ort) {
    throw new Error(
      'ONNX Runtime not found. Make sure the CDN script is loaded before calling getOrt().',
    );
  }

  // Configure WASM paths once (needed even for WebGPU — ORT may fall back
  // to WASM for certain ops, and needs to know where to find the files).
  if (!ortConfigured) {
    g.ort.env.wasm.wasmPaths = ORT_CDN_BASE;
    g.ort.env.wasm.numThreads = 4;
    g.ort.env.logLevel = 'error';
    ortConfigured = true;
  }

  return g.ort;
}

// ---------------------------------------------------------------------------
// WebGPU check
// ---------------------------------------------------------------------------

/**
 * Returns `true` if the browser exposes a usable WebGPU adapter.
 */
export async function isWebGPUAvailable(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.gpu) {
    return false;
  }
  try {
    const adapter = await navigator.gpu.requestAdapter();
    return adapter !== null;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Session management
// ---------------------------------------------------------------------------

/**
 * Creates an ONNX InferenceSession using WebGPU with WASM fallback.
 *
 * WebGPU handles the heavy compute ops; WASM covers ops that WebGPU does
 * not support (e.g. Shape, Gather). This dual-EP configuration silences
 * the "nodes not assigned to preferred EP" warning from ORT.
 *
 * @param modelUrl - URL to the `.onnx` model file (e.g. on HuggingFace).
 *   The browser will cache the download after the first fetch.
 * @throws {Error} if WebGPU is not available or session creation fails.
 */
export async function createInferenceSession(
  modelUrl: string,
): Promise<OrtInferenceSession> {
  if (typeof navigator === 'undefined' || !navigator.gpu) {
    throw new Error('WebGPU is required for this feature');
  }

  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    throw new Error('WebGPU is required for this feature');
  }

  const ort = getOrt();
  return ort.InferenceSession.create(modelUrl, {
    executionProviders: ['webgpu', 'wasm'],
    graphOptimizationLevel: 'all',
  });
}

// ---------------------------------------------------------------------------
// Inference helpers
// ---------------------------------------------------------------------------

/** Result from a single Demucs model inference call. */
export interface InferenceResult {
  outSpecReal: Float32Array;
  outSpecImag: Float32Array;
  outWave: Float32Array;
  outSpecShape: number[];
  outWaveShape: number[];
}

/**
 * Runs a single forward pass of the Demucs model.
 *
 * @param session  - An active ONNX InferenceSession.
 * @param specReal - Real part of the STFT, shape `[1, 2, bins, frames]`.
 * @param specImag - Imaginary part of the STFT, same shape.
 * @param audio    - Raw waveform, shape `[1, 2, segmentSamples]`.
 * @param specShape  - Shape array for the spectrogram tensors.
 * @param audioShape - Shape array for the audio tensor.
 */
export async function runInference(
  session: OrtInferenceSession,
  specReal: Float32Array,
  specImag: Float32Array,
  audio: Float32Array,
  specShape: number[],
  audioShape: number[],
): Promise<InferenceResult> {
  const ort = getOrt();

  const specRealTensor = new ort.Tensor('float32', specReal, specShape);
  const specImagTensor = new ort.Tensor('float32', specImag, specShape);
  const audioTensor = new ort.Tensor('float32', audio, audioShape);

  const results = await session.run({
    spec_real: specRealTensor,
    spec_imag: specImagTensor,
    audio: audioTensor,
  });

  const outSpecReal = results['out_spec_real'];
  const outSpecImag = results['out_spec_imag'];
  const outWave = results['out_wave'];

  const result: InferenceResult = {
    outSpecReal: outSpecReal.data as Float32Array,
    outSpecImag: outSpecImag.data as Float32Array,
    outWave: outWave.data as Float32Array,
    outSpecShape: outSpecReal.dims as number[],
    outWaveShape: outWave.dims as number[],
  };

  // Dispose all tensors to free GPU memory
  specRealTensor.dispose();
  specImagTensor.dispose();
  audioTensor.dispose();
  outSpecReal.dispose();
  outSpecImag.dispose();
  outWave.dispose();

  return result;
}
