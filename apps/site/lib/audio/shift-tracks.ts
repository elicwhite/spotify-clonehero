/**
 * Shifting a set of audio tracks — the DSP half of applying a chart's
 * `audioAnchor` to the audio the editor plays.
 *
 * This module is the implementation both ends share: `shift-tracks-worker.ts`
 * runs it off the main thread, and `shift-tracks-client.ts` calls it inline in
 * environments with no `Worker` (jsdom under Jest). Nothing here touches the
 * DOM or Web Audio, so it is unit-testable on its own.
 *
 * The shifted PCM goes straight into `AudioManager` as samples
 * (`TrackPcm`), so nothing here encodes a container: an album-length song is
 * a quarter of a billion samples, and converting all of them to 16-bit WAV
 * only to have `decodeAudioData` turn them back into floats cost several
 * seconds of every editor load.
 *
 * What remains is one allocation and one `set` per track. That is still tens
 * of millions of samples of memory traffic, which is why it runs in a worker
 * rather than on the main thread.
 */

import {shiftPcmStart} from '@/lib/drum-transcription/audio/shift-pcm';

/** One track's ORIGINAL (unshifted) interleaved PCM. */
export interface ShiftTrack {
  name: string;
  pcm: Float32Array;
}

/** One track's shifted interleaved PCM. */
export interface ShiftedTrack {
  name: string;
  /** Identical to the input by reference at a zero shift (see
   *  `shiftPcmStart`), and a fresh buffer otherwise. */
  shiftedPcm: Float32Array;
}

export interface ShiftParams {
  shiftSamples: number;
  channels: number;
}

/** Progress after each track finishes. `completed` counts finished tracks. */
export interface ShiftProgress {
  completed: number;
  total: number;
  /** The track that just finished. */
  name: string;
}

/**
 * Shift every track's start by `shiftSamples` frames, reporting after each
 * one — silence prepended for a positive count, frames removed for a
 * negative one. Tracks are processed in the order given and the result
 * preserves it.
 */
export function shiftTracks(
  tracks: ReadonlyArray<ShiftTrack>,
  {shiftSamples, channels}: ShiftParams,
  onProgress?: (progress: ShiftProgress) => void,
): ShiftedTrack[] {
  const shifted: ShiftedTrack[] = [];
  for (const track of tracks) {
    shifted.push({
      name: track.name,
      shiftedPcm: shiftPcmStart(track.pcm, shiftSamples, channels),
    });
    onProgress?.({
      completed: shifted.length,
      total: tracks.length,
      name: track.name,
    });
  }
  return shifted;
}

// ---------------------------------------------------------------------------
// Worker protocol
// ---------------------------------------------------------------------------

export interface ShiftRequest extends ShiftParams {
  type: 'shift';
  tracks: ShiftTrack[];
}

export type ShiftWorkerMessage =
  | ({type: 'progress'} & ShiftProgress)
  | {type: 'result'; tracks: ShiftedTrack[]}
  | {type: 'error'; message: string};
