/**
 * Padding + WAV-encoding a set of audio tracks — the DSP half of applying a
 * chart's `audioAnchor` to the audio the editor plays.
 *
 * This module is the implementation both ends share: `pad-encode-worker.ts`
 * runs it off the main thread, and `pad-encode-client.ts` calls it inline in
 * environments with no `Worker` (jsdom under Jest). Nothing here touches the
 * DOM or Web Audio, so it is unit-testable on its own.
 *
 * The per-sample Float32 -> Int16 conversion inside `encodeWav` is what
 * costs the time: about 120 ms per four minutes of 44.1 kHz stereo, per
 * track. A chart package with a full mix and three stems therefore spends
 * roughly half a second here, which is why it does not belong on the main
 * thread.
 */

import {padPcmStart} from '@/lib/drum-transcription/audio/pad-pcm';
import {encodeWav} from './wav-encoder';

/** One track's ORIGINAL (unpadded) interleaved PCM. */
export interface PadEncodeTrack {
  name: string;
  pcm: Float32Array;
}

/** One track after padding, as both a decoded buffer and a WAV file. */
export interface PadEncodedTrack {
  name: string;
  /** Padded interleaved PCM. Identical to the input by reference when the
   *  pad is zero (see `padPcmStart`), and a fresh buffer otherwise. */
  paddedPcm: Float32Array;
  /** 16-bit WAV bytes of {@link paddedPcm}. */
  wav: Uint8Array;
}

export interface PadEncodeParams {
  padSamples: number;
  sampleRate: number;
  channels: number;
}

/** Progress after each track finishes. `completed` counts finished tracks. */
export interface PadEncodeProgress {
  completed: number;
  total: number;
  /** The track that just finished. */
  name: string;
}

/**
 * Pad every track by `padSamples` frames of silence and WAV-encode the
 * result, reporting after each one. Tracks are processed in the order given
 * and the result preserves it.
 */
export function padAndEncode(
  tracks: ReadonlyArray<PadEncodeTrack>,
  {padSamples, sampleRate, channels}: PadEncodeParams,
  onProgress?: (progress: PadEncodeProgress) => void,
): PadEncodedTrack[] {
  const encoded: PadEncodedTrack[] = [];
  for (const track of tracks) {
    const paddedPcm = padPcmStart(track.pcm, padSamples, channels);
    const wav = new Uint8Array(encodeWav(paddedPcm, sampleRate, channels));
    encoded.push({name: track.name, paddedPcm, wav});
    onProgress?.({
      completed: encoded.length,
      total: tracks.length,
      name: track.name,
    });
  }
  return encoded;
}

// ---------------------------------------------------------------------------
// Worker protocol
// ---------------------------------------------------------------------------

export interface PadEncodeRequest extends PadEncodeParams {
  type: 'pad-encode';
  tracks: PadEncodeTrack[];
}

export type PadEncodeWorkerMessage =
  | ({type: 'progress'} & PadEncodeProgress)
  | {type: 'result'; tracks: PadEncodedTrack[]}
  | {type: 'error'; message: string};
