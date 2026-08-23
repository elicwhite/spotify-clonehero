/**
 * ONNX model download URLs (HuggingFace).
 *
 * `Ryan5453/demucs-onnx` was renamed to `Ryan5453/demucs-next` and the
 * single `htdemucs.onnx` was split into precision-suffixed files. We use
 * fp32 — fp16 is unreliable on the ORT-web WASM EP, and the Demucs worker
 * falls back to WASM.
 */
import {hasCachedModel} from './model-cache';

export const MODEL_URLS = {
  demucs:
    'https://huggingface.co/Ryan5453/demucs-next/resolve/main/htdemucs_fp32.onnx',
  wav2vec2Fp16:
    'https://huggingface.co/elicwhite/wav2vec2-base-960h-fp16-onnx/resolve/main/wav2vec2-base-960h-fp16.onnx',
  wav2vec2Quantized:
    'https://huggingface.co/onnx-community/wav2vec2-base-960h-ONNX/resolve/main/onnx/model_quantized.onnx',
} as const;

/** OPFS model-cache key and plausible-size floor for the Demucs model. Here
 *  rather than in `demucs-worker.ts` because the main thread needs them too:
 *  an assist task plans its step list before spawning the worker, and
 *  importing the worker module to read a constant would install the worker's
 *  `message` listener on the page. */
export const DEMUCS_CACHE_KEY = 'htdemucs_fp32.onnx';
export const DEMUCS_MIN_BYTES = 140_000_000; // real size ~169 MB

/** Whether Demucs is already in the OPFS model cache, so a run that needs it
 *  will read it locally instead of downloading it. */
export function hasDemucsModelCached(): Promise<boolean> {
  return hasCachedModel(DEMUCS_CACHE_KEY, DEMUCS_MIN_BYTES);
}
