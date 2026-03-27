/**
 * Song context vector computation for the CRNN drum transcription model.
 *
 * The context vector is 1280-dimensional:
 *   [mean_mel(128) | per_inst_0_mel(128) | ... | per_inst_8_mel(128)]
 *
 * - mean_mel: average mel spectrogram across all frames
 * - per_inst_i_mel: average mel spectrogram in ±ONSET_RADIUS frames around
 *   each onset of instrument i (from a prior inference pass)
 *
 * For the first pass (no onsets known), a fallback context is used where
 * mean_mel is repeated for all instrument slots.
 */

import type {RawDrumEvent} from './types';
import {
  NUM_DRUM_CLASSES,
  DRUM_CLASSES,
  SONG_CONTEXT_DIM,
  ONSET_RADIUS,
} from './types';

/**
 * Compute a fallback context vector (for Pass 1, before onsets are known).
 *
 * Structure: [mean_mel | mean_mel | ... | mean_mel] (repeated 10×)
 *
 * @param melSpectrogram - Mel spectrogram, shape [nFrames, nMels], row-major.
 * @param nFrames - Number of time frames.
 * @param nMels - Number of mel bands (128).
 * @returns Float32Array of length SONG_CONTEXT_DIM (1280).
 */
export function computeFallbackContext(
  melSpectrogram: Float32Array,
  nFrames: number,
  nMels: number,
): Float32Array {
  const context = new Float32Array(SONG_CONTEXT_DIM);

  // Compute mean mel across all frames
  const meanMel = new Float32Array(nMels);
  if (nFrames > 0) {
    for (let frame = 0; frame < nFrames; frame++) {
      const offset = frame * nMels;
      for (let m = 0; m < nMels; m++) {
        meanMel[m] += melSpectrogram[offset + m];
      }
    }
    for (let m = 0; m < nMels; m++) {
      meanMel[m] /= nFrames;
    }
  }

  // Fill context: mean_mel repeated for all slots
  // Slot 0: mean_mel (128)
  // Slots 1-9: one per instrument (each 128), also mean_mel as fallback
  for (let slot = 0; slot < 1 + NUM_DRUM_CLASSES; slot++) {
    context.set(meanMel, slot * nMels);
  }

  return context;
}

/**
 * Compute a real context vector using onsets from a prior inference pass.
 *
 * Structure: [mean_mel | inst_0_onset_mel | ... | inst_8_onset_mel]
 *
 * For each instrument, averages the mel spectrogram in ±ONSET_RADIUS frames
 * around each detected onset. Falls back to mean_mel for instruments with
 * no detected onsets.
 *
 * @param melSpectrogram - Mel spectrogram, shape [nFrames, nMels], row-major.
 * @param nFrames - Number of time frames.
 * @param nMels - Number of mel bands (128).
 * @param events - Raw drum events from a prior peak-picking pass.
 * @param fps - Frame rate (100).
 * @returns Float32Array of length SONG_CONTEXT_DIM (1280).
 */
export function computeRealContext(
  melSpectrogram: Float32Array,
  nFrames: number,
  nMels: number,
  events: RawDrumEvent[],
  fps: number = 100,
): Float32Array {
  const context = new Float32Array(SONG_CONTEXT_DIM);

  // Compute mean mel across all frames
  const meanMel = new Float32Array(nMels);
  if (nFrames > 0) {
    for (let frame = 0; frame < nFrames; frame++) {
      const offset = frame * nMels;
      for (let m = 0; m < nMels; m++) {
        meanMel[m] += melSpectrogram[offset + m];
      }
    }
    for (let m = 0; m < nMels; m++) {
      meanMel[m] /= nFrames;
    }
  }

  // Slot 0: mean_mel
  context.set(meanMel, 0);

  // Group events by instrument class
  const onsetFramesByInst: number[][] = Array.from(
    {length: NUM_DRUM_CLASSES},
    () => [],
  );
  for (const event of events) {
    const classIdx = DRUM_CLASSES.findIndex((c) => c.name === event.drumClass);
    if (classIdx >= 0) {
      const frame = Math.round(event.timeSeconds * fps);
      onsetFramesByInst[classIdx].push(frame);
    }
  }

  // Slots 1-9: per-instrument onset mel profiles
  for (let inst = 0; inst < NUM_DRUM_CLASSES; inst++) {
    const slotOffset = (1 + inst) * nMels;
    const onsetFrames = onsetFramesByInst[inst];

    if (onsetFrames.length === 0) {
      // No onsets for this instrument — fall back to mean_mel
      context.set(meanMel, slotOffset);
      continue;
    }

    // Average mel in ±ONSET_RADIUS frames around each onset
    const instMel = new Float32Array(nMels);
    let count = 0;

    for (const centerFrame of onsetFrames) {
      const start = Math.max(0, centerFrame - ONSET_RADIUS);
      const end = Math.min(nFrames, centerFrame + ONSET_RADIUS + 1);

      // Average mel within the window around this onset
      const windowMel = new Float32Array(nMels);
      const windowLen = end - start;
      if (windowLen <= 0) continue;

      for (let f = start; f < end; f++) {
        const offset = f * nMels;
        for (let m = 0; m < nMels; m++) {
          windowMel[m] += melSpectrogram[offset + m];
        }
      }
      for (let m = 0; m < nMels; m++) {
        windowMel[m] /= windowLen;
      }

      // Accumulate onset window averages
      for (let m = 0; m < nMels; m++) {
        instMel[m] += windowMel[m];
      }
      count++;
    }

    // Average across all onsets for this instrument
    if (count > 0) {
      for (let m = 0; m < nMels; m++) {
        instMel[m] /= count;
      }
    }

    context.set(instMel, slotOffset);
  }

  return context;
}
