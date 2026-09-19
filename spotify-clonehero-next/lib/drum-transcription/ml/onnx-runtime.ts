/**
 * ONNX Runtime Web setup for the drum transcription pipeline.
 *
 * Loads ONNX Runtime from CDN as a global script (avoids bundling ~20MB of
 * WASM files).
 *
 * Usage:
 *   1. Include the CDN script in your page's <head>:
 *      <script src="https://cdn.jsdelivr.net/npm/onnxruntime-web@dev/dist/ort.all.min.js"></script>
 *   2. Call `getOrt()` to access the runtime.
 *
 * Whether this device can run a model at all is a separate question, and
 * `lib/onnx/webgpu-capability.ts` answers it — an adapter alone does not
 * mean the fp16 models will run.
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
  Tensor: new (type: string, data: Float32Array, dims: number[]) => OrtTensor;
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
  'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.3/dist/';

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
