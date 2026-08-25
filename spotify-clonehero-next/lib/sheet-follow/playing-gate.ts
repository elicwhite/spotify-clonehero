/**
 * Decides when the band is playing.
 *
 * This decision is the whole feature. Tracking holds well once it starts in the
 * right place, and the harness proved a lost follower can never recover — a
 * whole-song search finds the band about one time in ten at any window length,
 * and match confidence cannot even tell you that you are lost. So everything
 * rests on not starting in the wrong place.
 *
 * Loudness alone cannot make the call. Across two takes from the same room on
 * the same night, the quiet level sat 16 dB below the music on one and 24 dB
 * below on the other, because "quiet" contains different amounts of talking and
 * noodling. Sweeping a level threshold moves which take works and never fixes
 * both.
 *
 * Onset *rate* does not separate them either, though it looks like it should:
 * measured against known stretches, a talking room produced a median of 5
 * onsets a second and a band produced 5 as well. A peak-picker whose threshold
 * is relative to its own trailing mean is scale-invariant, so it finds as many
 * "onsets" in quiet noise as in real hits.
 *
 * Transient MAGNITUDE separates them, which is exactly what a relative
 * peak-picker throws away. In units of the room's own quiet flux, a band runs
 * 3.6 to 30 times the quiet level while talking runs 0.2 to 3.4. That ratio is
 * gain-invariant, which matters because the browser captures the same room about
 * 14 dB hotter than the recordings this was measured against.
 */

import {fftRadix2InPlace} from '../tempo-map/fft-radix2';
import {FrameSlicer, hannWindow} from './framing';

/**
 * Transient size, in units of the quiet room's own flux, at or above which the
 * room counts as playing.
 *
 * The measured takes bracket this tightly — a talking room reached 3.4 and the
 * quietest band reached 3.6 — so treat it as measured rather than chosen, and
 * re-measure against the replay harness before moving it.
 */
const PLAYING_TRANSIENT_RATIO = 3.5;
/** Seconds above the ratio before a song is declared started. */
const START_HOLD_SEC = 2;
/** Seconds below it before a song is declared over. */
const STOP_HOLD_SEC = 3;
/**
 * How long to listen to the room before deciding what its quiet flux is.
 *
 * Getting this wrong is expensive and silent. An earlier version calibrated from
 * the first 0.1 s block; on a recording that opens on near-silence it fixed the
 * room 24 dB too low, the gate never registered a single stop for the rest of
 * the session, and the follower rode a false start through an entire take.
 */
const CALIBRATION_SEC = 2;
/** Percentile of the calibration period's flux taken as the room's scale. */
const CALIBRATION_PERCENTILE = 0.9;
/** Percentile of the last second's flux compared against it. */
const TRANSIENT_PERCENTILE = 0.95;

const FFT_SIZE = 1024;
/** 5 ms at 22.05 kHz, giving a 200 fps flux envelope. */
const FLUX_HOP = 110;

/** One biquad section, direct form I. */
class Biquad {
  #b0 = 1;
  #b1 = 0;
  #b2 = 0;
  #a1 = 0;
  #a2 = 0;
  #x1 = 0;
  #x2 = 0;
  #y1 = 0;
  #y2 = 0;

  constructor(kind: 'highpass' | 'lowpass', freq: number, sampleRate: number) {
    const w0 = (2 * Math.PI * freq) / sampleRate;
    const cos = Math.cos(w0);
    const alpha = Math.sin(w0) / Math.SQRT2; // Butterworth, Q = 1/sqrt(2)
    const a0 = 1 + alpha;
    if (kind === 'highpass') {
      this.#b0 = (1 + cos) / 2 / a0;
      this.#b1 = -(1 + cos) / a0;
      this.#b2 = (1 + cos) / 2 / a0;
    } else {
      this.#b0 = (1 - cos) / 2 / a0;
      this.#b1 = (1 - cos) / a0;
      this.#b2 = (1 - cos) / 2 / a0;
    }
    this.#a1 = (-2 * cos) / a0;
    this.#a2 = (1 - alpha) / a0;
  }

  process(x: number): number {
    const y =
      this.#b0 * x +
      this.#b1 * this.#x1 +
      this.#b2 * this.#x2 -
      this.#a1 * this.#y1 -
      this.#a2 * this.#y2;
    this.#x2 = this.#x1;
    this.#x1 = x;
    this.#y2 = this.#y1;
    this.#y1 = y;
    return y;
  }
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

export interface GateEvent {
  playing: boolean;
  /** Set on the block where a song is declared started. Its value is how long
   *  ago the room actually got loud, so the caller can date the start from the
   *  music rather than from when the hold expired. */
  startedSecondsAgo?: number;
  justStopped?: boolean;
  /** Size of the last second's transients in units of the quiet room. */
  transientRatio: number;
  /** Null until the calibration period has elapsed. */
  quietFlux: number | null;
}

export class PlayingGate {
  #sampleRate: number;
  #fluxFps: number;
  #highpass: Biquad;
  #lowpass: Biquad;

  #slicer = new FrameSlicer(FFT_SIZE, FLUX_HOP);
  #previousMagnitude: Float32Array | null = null;
  /** Flux from the last second. */
  #recentFlux: number[] = [];
  #calibrationFlux: number[] = [];
  #quietFlux: number | null = null;

  #streamSec = 0;
  #aboveSec = 0;
  #belowSec = 0;
  #playing = false;

  constructor(sampleRate: number) {
    this.#sampleRate = sampleRate;
    this.#fluxFps = sampleRate / FLUX_HOP;
    // The snare band. Measured across the takes, it separated playing from a
    // talking room far better than broadband, the kick band or the cymbal band —
    // the last of which is useless because clipping sprays energy into it.
    this.#highpass = new Biquad('highpass', 150, sampleRate);
    this.#lowpass = new Biquad('lowpass', 500, sampleRate);
  }

  get playing() {
    return this.#playing;
  }

  /** Forgets the song in progress but keeps the room calibration, which does
   *  not change between takes. */
  reset() {
    this.#slicer.reset();
    this.#previousMagnitude = null;
    this.#recentFlux = [];
    this.#aboveSec = 0;
    this.#belowSec = 0;
    this.#playing = false;
  }

  push(block: Float32Array): GateEvent {
    const blockSec = block.length / this.#sampleRate;
    this.#streamSec += blockSec;

    const filtered = new Float32Array(block.length);
    for (let i = 0; i < block.length; i++) {
      filtered[i] = this.#lowpass.process(this.#highpass.process(block[i]));
    }
    const frames = this.#fluxFrames(filtered);

    if (this.#quietFlux === null) {
      this.#calibrationFlux.push(...frames);
      if (this.#streamSec < CALIBRATION_SEC) {
        return {playing: false, transientRatio: 0, quietFlux: null};
      }
      this.#quietFlux =
        percentile(this.#calibrationFlux, CALIBRATION_PERCENTILE) || 1e-9;
      this.#calibrationFlux = [];
    }

    this.#recentFlux.push(...frames);
    const keep = Math.round(this.#fluxFps);
    if (this.#recentFlux.length > keep) {
      this.#recentFlux.splice(0, this.#recentFlux.length - keep);
    }
    const transientRatio =
      percentile(this.#recentFlux, TRANSIENT_PERCENTILE) / this.#quietFlux;

    if (transientRatio >= PLAYING_TRANSIENT_RATIO) {
      this.#aboveSec += blockSec;
      this.#belowSec = 0;
    } else {
      this.#belowSec += blockSec;
      this.#aboveSec = 0;
    }

    if (!this.#playing && this.#aboveSec >= START_HOLD_SEC) {
      this.#playing = true;
      return {
        playing: true,
        // The ratio only crosses once a second of transients has accumulated,
        // so the music began about a second before the hold started counting.
        startedSecondsAgo: this.#aboveSec + 1,
        transientRatio,
        quietFlux: this.#quietFlux,
      };
    }
    if (this.#playing && this.#belowSec >= STOP_HOLD_SEC) {
      this.#playing = false;
      return {
        playing: false,
        justStopped: true,
        transientRatio,
        quietFlux: this.#quietFlux,
      };
    }
    return {
      playing: this.#playing,
      transientRatio,
      quietFlux: this.#quietFlux,
    };
  }

  /** Streaming spectral flux over the snare band. */
  #fluxFrames(filtered: Float32Array): number[] {
    const out: number[] = [];
    const window = hannWindow(FFT_SIZE);
    const buf = new Float32Array(FFT_SIZE * 2);
    const magnitude = new Float32Array(FFT_SIZE / 2 + 1);
    this.#slicer.push(filtered, frame => {
      buf.fill(0);
      for (let i = 0; i < FFT_SIZE; i++) buf[i * 2] = frame[i] * window[i];
      fftRadix2InPlace(buf, FFT_SIZE);
      let flux = 0;
      for (let b = 0; b < magnitude.length; b++) {
        const m = Math.hypot(buf[b * 2], buf[b * 2 + 1]);
        if (this.#previousMagnitude) {
          const d = m - this.#previousMagnitude[b];
          if (d > 0) flux += d;
        }
        magnitude[b] = m;
      }
      this.#previousMagnitude = Float32Array.from(magnitude);
      out.push(flux);
    });
    return out;
  }
}
