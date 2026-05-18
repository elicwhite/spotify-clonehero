/**
 * ONNX model download URLs (HuggingFace).
 *
 * `Ryan5453/demucs-onnx` was renamed to `Ryan5453/demucs-next` and the
 * single `htdemucs.onnx` was split into precision-suffixed files. We use
 * fp32 — fp16 is unreliable on the ORT-web WASM EP, and the Demucs worker
 * falls back to WASM.
 */
export const MODEL_URLS = {
  demucs:
    'https://huggingface.co/Ryan5453/demucs-next/resolve/main/htdemucs_fp32.onnx',
  wav2vec2Fp16:
    'https://huggingface.co/elicwhite/wav2vec2-base-960h-fp16-onnx/resolve/main/wav2vec2-base-960h-fp16.onnx',
  wav2vec2Quantized:
    'https://huggingface.co/onnx-community/wav2vec2-base-960h-ONNX/resolve/main/onnx/model_quantized.onnx',
} as const;
