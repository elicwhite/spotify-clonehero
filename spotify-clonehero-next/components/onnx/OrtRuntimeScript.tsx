'use client';

/**
 * Loads ONNX Runtime Web from the CDN onto `globalThis.ort`.
 *
 * ORT is script-tagged rather than imported so its ~20MB of WASM never enters
 * the bundle, which means it exists only on routes that render this. Anything
 * that spawns an inference worker gates on it through
 * `lib/onnx/ort-ready`'s `waitForOrtRuntime`, so a route that can start such a
 * run without rendering this component waits until that poll times out.
 *
 * Every route hosting the chart editor renders it, because Chart Assist can
 * start a transcription run from any of them, not just the transcription
 * entrypoint.
 */

import Script from 'next/script';

/** Must match the version `lib/drum-transcription/ml/crnn-worker.ts`
 *  `importScripts`, and the version demucs-next was traced against. */
export const ORT_CDN_URL =
  'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.3/dist/ort.min.js';

export default function OrtRuntimeScript() {
  // afterInteractive: the page renders first, then the runtime lands. A run
  // started before it does waits on `waitForOrtRuntime` rather than failing.
  return <Script src={ORT_CDN_URL} strategy="afterInteractive" />;
}
