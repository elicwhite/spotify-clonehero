/**
 * ONNX model download URLs (HuggingFace).
 */
export const MODEL_URLS = {
  wav2vec2Fp16:
    'https://huggingface.co/elicwhite/wav2vec2-base-960h-fp16-onnx/resolve/main/wav2vec2-base-960h-fp16.onnx',
  wav2vec2Quantized:
    'https://huggingface.co/onnx-community/wav2vec2-base-960h-ONNX/resolve/main/onnx/model_quantized.onnx',
} as const;
