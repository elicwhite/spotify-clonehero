/**
 * Song context vector computation for the CRNN drum transcription model.
 *
 * Deploy semantics (single pass, matching scripts/dump_frontend_reference.py
 * raw_activations() in the research repo): the context is the time-mean of
 * the stereo mel — a 512-dim vector [L mel bins 0..255, then R mel bins
 * 0..255] — tiled 10x into all slots, giving SONG_CONTEXT_DIM = 5120.
 */

import {SONG_CONTEXT_DIM} from './types';

/**
 * Compute the deploy context vector from the stereo mel spectrogram.
 *
 * @param melStereo - Stereo log-mel, layout [ch * nMels * T + m * T + t]
 *   (from computeStereoMel).
 * @param nFrames - Number of time frames T.
 * @param nMels - Number of mel bands per channel (256).
 * @returns Float32Array of length SONG_CONTEXT_DIM (5120).
 */
export function computeDeployContext(
  melStereo: Float32Array,
  nFrames: number,
  nMels: number,
): Float32Array {
  const baseDim = 2 * nMels; // 512
  const meanMel = new Float32Array(baseDim);

  if (nFrames > 0) {
    // Mean over time for each (channel, mel bin) row. melStereo is laid out
    // so row cm = ch * nMels + m occupies [cm * nFrames, (cm+1) * nFrames).
    for (let cm = 0; cm < baseDim; cm++) {
      const base = cm * nFrames;
      let sum = 0;
      for (let t = 0; t < nFrames; t++) {
        sum += melStereo[base + t];
      }
      meanMel[cm] = sum / nFrames;
    }
  }

  const context = new Float32Array(SONG_CONTEXT_DIM);
  const nSlots = SONG_CONTEXT_DIM / baseDim; // 10
  for (let slot = 0; slot < nSlots; slot++) {
    context.set(meanMel, slot * baseDim);
  }

  return context;
}
