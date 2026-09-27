/**
 * Which part of a lyric alignment failed, as a closed set that is safe to
 * send to analytics and Sentry.
 *
 * The alignment worker reports a failure to the page as a message string.
 * The page cannot send that string anywhere: it can name a file. Without this
 * label, a model download the network refused, an ONNX session that would
 * not build, and an inference pass that died all reach telemetry as the same
 * plain `Error` from the same message handler.
 *
 * Kept free of imports that load ONNX Runtime, because the page imports it
 * as well as the worker.
 */

import {ModelDownloadError, type ModelDownloadFailure} from './model-cache';

/**
 * The model and execution provider the alignment session runs on.
 *
 * - `webgpu`: the fp16 model on WebGPU.
 * - `wasm`: the int8 model on WASM.
 * - `wasm-fp16`: the fp16 model on WASM. This is what runs when the WebGPU
 *   session could not be built after the fp16 model was already chosen.
 */
export type AlignBackend = 'webgpu' | 'wasm' | 'wasm-fp16';

export type AlignFailureReason =
  /** The worker sent an `error` event: its script did not load, or it threw
   *  outside a message handler. */
  | 'worker-error'
  /** The model the worker settled on did not download. */
  | `model-download-${ModelDownloadFailure | 'other'}`
  /** The ONNX session did not build on this backend. */
  | `session-${AlignBackend}`
  /** The CTC forward pass failed on this backend. */
  | `inference-${AlignBackend}`
  /** Anything after the emissions: tokens, Viterbi, timing. Also any failure
   *  that no stage labelled. */
  | 'alignment';

/** An alignment failure, with the user-facing message and the reason. */
export class AlignFailureError extends Error {
  readonly reason: AlignFailureReason;

  constructor(message: string, reason: AlignFailureReason) {
    super(message);
    this.name = 'AlignFailureError';
    this.reason = reason;
  }
}

/** The reason for an error thrown by `getCachedModel`. */
export function modelDownloadReason(err: unknown): AlignFailureReason {
  return err instanceof ModelDownloadError
    ? `model-download-${err.failure}`
    : 'model-download-other';
}
