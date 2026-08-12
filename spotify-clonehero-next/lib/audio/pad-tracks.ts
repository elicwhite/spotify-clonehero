/**
 * Padding a set of audio tracks — the DSP half of applying a chart's
 * `audioAnchor` to the audio the editor plays.
 *
 * This module is the implementation both ends share: `pad-tracks-worker.ts`
 * runs it off the main thread, and `pad-tracks-client.ts` calls it inline in
 * environments with no `Worker` (jsdom under Jest). Nothing here touches the
 * DOM or Web Audio, so it is unit-testable on its own.
 *
 * The padded PCM goes straight into `AudioManager` as samples
 * (`TrackPcm`), so nothing here encodes a container: an album-length song is
 * a quarter of a billion samples, and converting all of them to 16-bit WAV
 * only to have `decodeAudioData` turn them back into floats cost several
 * seconds of every editor load.
 *
 * What remains is one allocation and one `set` per track. That is still tens
 * of millions of samples of memory traffic, which is why it runs in a worker
 * rather than on the main thread.
 */

import {padPcmStart} from '@/lib/drum-transcription/audio/pad-pcm';

/** One track's ORIGINAL (unpadded) interleaved PCM. */
export interface PadTrack {
  name: string;
  pcm: Float32Array;
}

/** One track's padded interleaved PCM. */
export interface PaddedTrack {
  name: string;
  /** Identical to the input by reference when the pad is zero (see
   *  `padPcmStart`), and a fresh buffer otherwise. */
  paddedPcm: Float32Array;
}

export interface PadParams {
  padSamples: number;
  channels: number;
}

/** Progress after each track finishes. `completed` counts finished tracks. */
export interface PadProgress {
  completed: number;
  total: number;
  /** The track that just finished. */
  name: string;
}

/**
 * Pad every track by `padSamples` frames of silence, reporting after each
 * one. Tracks are processed in the order given and the result preserves it.
 */
export function padTracks(
  tracks: ReadonlyArray<PadTrack>,
  {padSamples, channels}: PadParams,
  onProgress?: (progress: PadProgress) => void,
): PaddedTrack[] {
  const padded: PaddedTrack[] = [];
  for (const track of tracks) {
    padded.push({
      name: track.name,
      paddedPcm: padPcmStart(track.pcm, padSamples, channels),
    });
    onProgress?.({
      completed: padded.length,
      total: tracks.length,
      name: track.name,
    });
  }
  return padded;
}

// ---------------------------------------------------------------------------
// Worker protocol
// ---------------------------------------------------------------------------

export interface PadRequest extends PadParams {
  type: 'pad';
  tracks: PadTrack[];
}

export type PadWorkerMessage =
  | ({type: 'progress'} & PadProgress)
  | {type: 'result'; tracks: PaddedTrack[]}
  | {type: 'error'; message: string};
