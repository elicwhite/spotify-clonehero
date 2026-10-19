/**
 * Chroma features for live score following.
 *
 * Twelve pitch-class bins per frame, L2-normalised, at 10 frames per second.
 * The reference (the song's own recording) and the live microphone both go
 * through this same code, because the follower compares them with a cosine
 * similarity and a windowing difference between the two sides would bias every
 * comparison.
 *
 * The choice of chroma is measured, not assumed. On five rehearsal recordings
 * made with a laptop microphone next to a drum kit, chroma put the correct
 * alignment first on every song, while onset flux managed three of five and
 * band energy two. A drum-dominated room recording does not destroy harmonic
 * content the way one might expect.
 */

import {fftRadix2InPlace} from '../tempo-map/fft-radix2';
import {FrameSlicer, hannWindow} from './framing';

export const CHROMA_SAMPLE_RATE = 22050;
export const CHROMA_FFT_SIZE = 4096;
/** 2205 samples at 22.05 kHz — exactly 10 frames per second. */
export const CHROMA_HOP = 2205;
export const CHROMA_FPS = CHROMA_SAMPLE_RATE / CHROMA_HOP;
export const CHROMA_BINS = 12;

const N_FREQ_BINS = CHROMA_FFT_SIZE / 2 + 1;

/** Lowest and highest frequency folded into a pitch class. Below 55 Hz the FFT
 *  bins are too coarse to name a note, and above 2 kHz a room recording is
 *  mostly cymbal wash. */
const MIN_PITCH_HZ = 55;
const MAX_PITCH_HZ = 2000;

let cachedPitchClass: Int8Array | null = null;

/** Pitch class per FFT bin, or -1 for bins outside the usable range. */
function pitchClassPerBin(): Int8Array {
  if (cachedPitchClass) return cachedPitchClass;
  const map = new Int8Array(N_FREQ_BINS).fill(-1);
  for (let bin = 1; bin < N_FREQ_BINS; bin++) {
    const hz = (bin * CHROMA_SAMPLE_RATE) / CHROMA_FFT_SIZE;
    if (hz < MIN_PITCH_HZ || hz > MAX_PITCH_HZ) continue;
    const midi = Math.round(12 * Math.log2(hz / 440) + 69);
    map[bin] = ((midi % 12) + 12) % 12;
  }
  cachedPitchClass = map;
  return map;
}

/**
 * One chroma frame from exactly {@link CHROMA_FFT_SIZE} samples, written into
 * `out` at `outOffset`. Returns false when the frame carries no usable pitched
 * energy, in which case `out` is left as twelve zeros — a silent or purely
 * percussive frame must not be normalised into an arbitrary direction, because
 * a unit vector of noise scores as well against the reference as real harmony.
 */
export function chromaFrame(
  samples: Float32Array,
  out: Float32Array,
  outOffset = 0,
): boolean {
  const window = hannWindow(CHROMA_FFT_SIZE);
  const pitchClass = pitchClassPerBin();

  // fftRadix2InPlace takes interleaved complex.
  const buf = new Float32Array(CHROMA_FFT_SIZE * 2);
  for (let i = 0; i < CHROMA_FFT_SIZE; i++) {
    buf[i * 2] = samples[i] * window[i];
  }
  fftRadix2InPlace(buf, CHROMA_FFT_SIZE);

  for (let k = 0; k < CHROMA_BINS; k++) out[outOffset + k] = 0;
  for (let bin = 1; bin < N_FREQ_BINS; bin++) {
    const pc = pitchClass[bin];
    if (pc < 0) continue;
    out[outOffset + pc] += Math.hypot(buf[bin * 2], buf[bin * 2 + 1]);
  }

  let norm = 0;
  for (let k = 0; k < CHROMA_BINS; k++) {
    const v = out[outOffset + k];
    norm += v * v;
  }
  norm = Math.sqrt(norm);
  if (norm <= 1e-6) {
    for (let k = 0; k < CHROMA_BINS; k++) out[outOffset + k] = 0;
    return false;
  }
  for (let k = 0; k < CHROMA_BINS; k++) out[outOffset + k] /= norm;
  return true;
}

/** Number of whole chroma frames a signal of `sampleCount` samples yields. */
export function chromaFrameCount(sampleCount: number): number {
  if (sampleCount < CHROMA_FFT_SIZE) return 0;
  return Math.floor((sampleCount - CHROMA_FFT_SIZE) / CHROMA_HOP) + 1;
}

/**
 * Whole-signal chromagram, row-major `[frames × 12]`. Used for the reference
 * side, where the entire recording is in hand at once.
 */
export function chromagram(audio: Float32Array): {
  frames: Float32Array;
  frameCount: number;
} {
  const frameCount = chromaFrameCount(audio.length);
  const frames = new Float32Array(frameCount * CHROMA_BINS);
  for (let t = 0; t < frameCount; t++) {
    chromaFrame(
      audio.subarray(t * CHROMA_HOP, t * CHROMA_HOP + CHROMA_FFT_SIZE),
      frames,
      t * CHROMA_BINS,
    );
  }
  return {frames, frameCount};
}

/**
 * Turns an arbitrarily-chunked stream of microphone samples into chroma frames
 * on the same grid the reference uses. The microphone delivers whatever block
 * size the audio thread chooses, which is unrelated to the hop, so this holds a
 * carry buffer across calls.
 */
export class ChromaStream {
  #slicer = new FrameSlicer(CHROMA_FFT_SIZE, CHROMA_HOP);

  /**
   * Feeds one block and returns the frames it completed. Each frame reports the
   * stream time of its *last* sample, which is what the follower needs: the
   * position estimate belongs to the most recent audio, not to the middle of a
   * window.
   */
  push(block: Float32Array): {chroma: Float32Array; endSampleIndex: number}[] {
    const out: {chroma: Float32Array; endSampleIndex: number}[] = [];
    this.#slicer.push(block, (frame, endSampleIndex) => {
      const chroma = new Float32Array(CHROMA_BINS);
      if (chromaFrame(frame, chroma)) out.push({chroma, endSampleIndex});
    });
    return out;
  }

  reset() {
    this.#slicer.reset();
  }
}
