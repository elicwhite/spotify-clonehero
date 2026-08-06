/**
 * The ONNX models the tempo pipeline loads, and the cache probes that say
 * whether loading one will download anything.
 *
 * Separate from `pipeline-worker.ts` because the main thread needs the cache
 * keys too: an assist task plans its step list before spawning the worker,
 * and importing the worker module to read a constant would install the
 * worker's `message` listener on the page.
 */

import {hasCachedModel} from '@/lib/lyrics-align/model-cache';

export const ROFORMER_MODEL_URL =
  'https://huggingface.co/elicwhite/bs-roformer-sw-6stem-onnx/resolve/main/bs_roformer_sw_6stem_fp16.onnx';
export const ROFORMER_CACHE_KEY = 'bs_roformer_sw_6stem_fp16.onnx';
export const ROFORMER_MIN_BYTES = 300_000_000; // real size ~336 MB

// Hosted on R2 (assets.musiccharts.tools) — the local public/models/ copy is
// gitignored and never deploys, so a same-origin URL 404s in production.
export const BEAT_THIS_MODEL_URL =
  'https://assets.musiccharts.tools/models/beat_this.onnx';
export const BEAT_THIS_CACHE_KEY = 'beat_this_v1.onnx';
export const BEAT_THIS_MIN_BYTES = 70_000_000; // real size ~83 MB

/** Whether Beat This! is already in the OPFS model cache, so a run that
 *  needs it will read it locally instead of downloading it. */
export function hasBeatThisModelCached(): Promise<boolean> {
  return hasCachedModel(BEAT_THIS_CACHE_KEY, BEAT_THIS_MIN_BYTES);
}
