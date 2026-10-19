/**
 * Drum transcription pipeline.
 *
 * Provides a `DrumTranscriber` interface with two implementations:
 *
 * - `CrnnTranscriber` — real ONNX inference with the CRNN model.
 *   All heavy computation runs in a Web Worker to avoid blocking the main thread.
 *
 * - `MockTranscriber` — generates realistic mock drum events for
 *   development and testing without requiring a GPU or ONNX model.
 *
 * Both implementations produce the same `TranscriptionResult` type,
 * making them interchangeable in the pipeline.
 */

import type {
  TranscriptionResult,
  TranscriptionProgressCallback,
  ModelOutput,
  RawDrumEvent,
  DrumClassName,
} from './types';
import {DRUM_CLASSES, NUM_DRUM_CLASSES} from './types';
import {runAbortableWorker} from '@/lib/workers/abortable-worker';

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

/**
 * Common interface for drum transcription implementations.
 */
export interface DrumTranscriber {
  /**
   * Transcribe drum events from audio data.
   *
   * @param stereoAudio - Interleaved stereo audio [L0, R0, L1, R1, ...] at the expected sample rate (48000 Hz for the stereo CRNN).
   * @param sampleRate - Sample rate of the audio.
   * @param onProgress - Optional progress callback.
   * @param signal - Optional abort signal. An already-aborted signal rejects
   *   before any worker spawns; aborting mid-run terminates the worker and
   *   rejects with a `DOMException` named `AbortError`.
   * @returns The transcription result with raw events and model output.
   */
  transcribe(
    stereoAudio: Float32Array,
    sampleRate: number,
    onProgress?: TranscriptionProgressCallback,
    signal?: AbortSignal,
  ): Promise<TranscriptionResult>;
}

// ---------------------------------------------------------------------------
// CRNN Transcriber (Web Worker-based inference)
// ---------------------------------------------------------------------------

/** R2 asset host for model files (checkpoints, thresholds configs, etc). */
const MODEL_ASSET_BASE_URL = 'https://assets.musiccharts.tools/models';

/** Checkpoint/model-version tag for the currently-deployed CRNN. Bumping this
 * one constant re-derives BOTH the .onnx URL and the thresholds-JSON URL
 * below, so a model swap can't silently drift the two apart (see the F63/t3
 * thresholds-wiring note: previously the thresholds filename never carried a
 * version tag, so there was no way to tell from the filename alone whether a
 * hosted thresholds file was actually tuned for the checkpoint in use). */
const CRNN_MODEL_VERSION = 't5';

/** URL for the stereo 256-mel CRNN ONNX model — the t5 checkpoint (Arm A s0,
 * v3 recipe; drum-to-chart docs/2026-07-30-ship-handoff-armA_s0.md — beat
 * deployed t4 on val-tuned with significance and improved every family).
 * Same mel+context inputs as the t4 export, but a SCHEMA CHANGE on the
 * output: an 8-class head (crash-2 dropped, ride moved to index 7), which is
 * why the decode lane tables in postprocess.ts/types.ts change with it.
 * Hosted on R2 (assets.musiccharts.tools); the local public/models/ copy is
 * gitignored and never deploys, so a same-origin URL 404s in production. In
 * development we load same-origin from public/models/ instead. */
const CRNN_MODEL_FILENAME = `crnn_stereo_256mel_${CRNN_MODEL_VERSION}.onnx`;
const CRNN_MODEL_URL =
  process.env.NODE_ENV === 'development'
    ? `/models/${CRNN_MODEL_FILENAME}`
    : `${MODEL_ASSET_BASE_URL}/${CRNN_MODEL_FILENAME}`;

/** Per-lane peak-picking thresholds config, version-tagged to match
 * CRNN_MODEL_VERSION (filename convention: crnn_stereo_256mel.<version>.thresholds.json).
 * The same-origin copy (public/models/crnn_stereo_256mel.t5.thresholds.json)
 * IS committed (tiny JSON, not covered by the *.onnx gitignore) so it deploys
 * with the app; the R2 copy is the production fallback and should be kept in
 * sync when retuned. */
const CRNN_THRESHOLDS_FILENAME = `crnn_stereo_256mel.${CRNN_MODEL_VERSION}.thresholds.json`;
const CRNN_THRESHOLDS_URL = `/models/${CRNN_THRESHOLDS_FILENAME}`;
const CRNN_THRESHOLDS_URL_FALLBACK = `${MODEL_ASSET_BASE_URL}/${CRNN_THRESHOLDS_FILENAME}`;

/** Arm A s0 tuned per-lane thresholds (lane order: kick, snare, high-tom,
 * mid-tom, floor-tom, hihat, crash, ride; val-tuned coordinate descent, matches
 * crnn_stereo_256mel.t5.thresholds.json). A threshold > 1.5 would disable the
 * lane entirely; no t5 lane uses that. Used when the thresholds JSON cannot be
 * fetched. */
const PROVISIONAL_THRESHOLDS: number[] = [
  0.5, 0.55, 0.65, 0.65, 0.7, 0.65, 0.7, 0.65,
];

/** Expected shape of the per-model thresholds JSON (see e.g.
 * public/models/crnn_stereo_256mel.t5.thresholds.json). `laneOrder` is
 * documentation of the lane<->index mapping (matches DRUM_CLASSES order);
 * it isn't remapped against DRUM_CLASSES at runtime, but its presence/length
 * is checked as a cheap sanity signal that the file is well-formed. */
interface ThresholdsFile {
  thresholds: number[];
  laneOrder?: string[];
  note?: string;
}

function isValidThresholdsFile(json: unknown): json is ThresholdsFile {
  if (typeof json !== 'object' || json === null) return false;
  const {thresholds, laneOrder} = json as Record<string, unknown>;
  if (
    !Array.isArray(thresholds) ||
    thresholds.length !== NUM_DRUM_CLASSES ||
    !thresholds.every(t => typeof t === 'number' && Number.isFinite(t))
  ) {
    return false;
  }
  if (laneOrder !== undefined) {
    if (!Array.isArray(laneOrder) || laneOrder.length !== NUM_DRUM_CLASSES) {
      return false;
    }
  }
  return true;
}

/**
 * Fetch the per-lane thresholds config, trying same-origin first, then R2,
 * then falling back to the hardcoded provisional array. Both URLs are
 * derived from CRNN_MODEL_VERSION so they always name-match the checkpoint
 * loaded via CRNN_MODEL_URL.
 */
async function loadThresholds(): Promise<number[]> {
  for (const url of [CRNN_THRESHOLDS_URL, CRNN_THRESHOLDS_URL_FALLBACK]) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const json: unknown = await res.json();
      if (isValidThresholdsFile(json)) {
        return json.thresholds;
      }
      console.warn(`Malformed thresholds config at ${url}; trying fallback`);
    } catch {
      // Network error — try the next source.
    }
  }
  console.warn('Using hardcoded provisional CRNN thresholds');
  return PROVISIONAL_THRESHOLDS.slice();
}

/** Spawns the real crnn-worker.ts module worker. */
export function defaultCreateCrnnWorker(): Worker {
  return new Worker(new URL('./crnn-worker.ts', import.meta.url));
}

/**
 * Real ONNX-based drum transcriber using the stereo 256-mel CRNN model.
 *
 * All heavy computation (mel spectrograms, ONNX inference, post-processing,
 * peak picking) runs in a Web Worker to keep the main thread responsive.
 *
 * Pipeline (inside worker) — single inference pass:
 *   1. Per-channel log-mel spectrograms (256 bands @ 100 fps, 48 kHz input)
 *   2. Song context vector: time-mean of the stereo mel (512 floats tiled
 *      10x -> 5120)
 *   3. Windowed inference (500-frame windows, stride 375, averaged overlaps)
 *      + sigmoid -> per-frame activations (T, 8)
 *   4. Post-processing: per-frame lane constraints (tom pitch re-order OFF,
 *      matching the shipped product pipeline — F50, PIPELINE_AUDIT.md)
 *   5. Peak picking per lane with the provided per-lane thresholds
 */
export class CrnnTranscriber implements DrumTranscriber {
  private modelUrl: string;
  private executionProviders: string[];
  private createWorker: () => Worker;

  /**
   * @param executionProviders - ORT execution provider preference order.
   *   Exposed (not just hardcoded in the worker) so the webgpu-vs-wasm
   *   residual can be measured by running the same audio through
   *   `['webgpu', 'wasm']` and `['wasm']` and diffing `modelOutput.predictions`
   *   — see PARITY.md's stage-2 gate term (b). Default matches production.
   * @param createWorker - Injectable factory (defaults to the real
   *   crnn-worker.ts) so tests can substitute a fake Worker without a real
   *   Worker/module-URL environment — same seam as `runSeparationInWorker`
   *   and `runDemucsInWorker`.
   */
  constructor(
    modelUrl: string = CRNN_MODEL_URL,
    executionProviders: string[] = ['webgpu', 'wasm'],
    createWorker: () => Worker = defaultCreateCrnnWorker,
  ) {
    this.modelUrl = modelUrl;
    this.executionProviders = executionProviders;
    this.createWorker = createWorker;
  }

  async transcribe(
    stereoAudio: Float32Array,
    sampleRate: number,
    onProgress?: TranscriptionProgressCallback,
    signal?: AbortSignal,
  ): Promise<TranscriptionResult> {
    const thresholds = await loadThresholds();

    return runAbortableWorker<TranscriptionResult>(
      this.createWorker,
      signal,
      (worker, settle) => {
        worker.onmessage = (e: MessageEvent) => {
          const msg = e.data;

          switch (msg.type) {
            case 'progress':
              onProgress?.({
                step: msg.step,
                percent: msg.percent,
                detail: msg.detail,
              });
              break;

            case 'result':
              settle.resolve({
                events: msg.events as RawDrumEvent[],
                modelOutput: msg.modelOutput as ModelOutput,
                durationSeconds: msg.durationSeconds as number,
              });
              break;

            case 'error':
              settle.reject(new Error(msg.message));
              break;
          }
        };

        worker.onerror = err => {
          settle.reject(new Error(`Worker error: ${err.message}`));
        };

        // Send audio to worker — transfer the buffer for zero-copy
        worker.postMessage(
          {
            type: 'transcribe',
            stereoAudio,
            sampleRate,
            modelUrl: this.modelUrl,
            thresholds,
            executionProviders: this.executionProviders,
          },
          [stereoAudio.buffer],
        );
      },
    );
  }
}

// ---------------------------------------------------------------------------
// Mock Transcriber (for development/testing)
// ---------------------------------------------------------------------------

/**
 * Generates realistic mock drum transcription results.
 *
 * Produces a basic rock beat pattern (kick-snare-hihat) with some fills,
 * useful for development and testing the editor without needing the
 * ONNX model or WebGPU.
 */
export class MockTranscriber implements DrumTranscriber {
  private bpm: number;

  /**
   * @param bpm - Beats per minute for the mock pattern (default: 120).
   */
  constructor(bpm: number = 120) {
    this.bpm = bpm;
  }

  async transcribe(
    stereoAudio: Float32Array,
    sampleRate: number,
    onProgress?: TranscriptionProgressCallback,
  ): Promise<TranscriptionResult> {
    const durationSeconds = stereoAudio.length / 2 / sampleRate;

    onProgress?.({step: 'computing-spectrogram', percent: 0.1});

    // Simulate processing time
    await new Promise<void>(resolve => setTimeout(resolve, 100));

    onProgress?.({step: 'inference', percent: 0.5});

    const events = this.generateMockPattern(durationSeconds);
    const modelOutput = this.generateMockModelOutput(durationSeconds, events);

    onProgress?.({step: 'post-processing', percent: 0.9});

    await new Promise<void>(resolve => setTimeout(resolve, 50));

    onProgress?.({step: 'done', percent: 1});

    return {events, modelOutput, durationSeconds};
  }

  /**
   * Generate a realistic rock beat pattern with 8-class events.
   *
   * Pattern (per bar, 4/4 time):
   *   Beat 1:   BD + HH
   *   Beat 1.5: HH
   *   Beat 2:   SD + HH
   *   Beat 2.5: HH
   *   Beat 3:   BD + HH
   *   Beat 3.5: HH
   *   Beat 4:   SD + HH
   *   Beat 4.5: HH
   *
   * Every 4 bars, replace the last bar with a fill (toms + cymbal crash).
   */
  private generateMockPattern(durationSeconds: number): RawDrumEvent[] {
    const events: RawDrumEvent[] = [];
    const beatDuration = 60 / this.bpm; // seconds per beat
    const eighthNoteDuration = beatDuration / 2;
    const beatsPerBar = 4;
    const barDuration = beatsPerBar * beatDuration;

    let time = 0;
    let barCount = 0;

    while (time < durationSeconds) {
      const barStart = time;
      barCount++;

      // Every 4th bar: fill instead of normal pattern
      const isFillBar = barCount % 4 === 0;

      for (let eighth = 0; eighth < 8; eighth++) {
        const noteTime = barStart + eighth * eighthNoteDuration;
        if (noteTime >= durationSeconds) break;

        if (isFillBar) {
          this.addFillEvents(events, noteTime, eighth, durationSeconds);
        } else {
          this.addRockBeatEvents(events, noteTime, eighth);
        }
      }

      time += barDuration;
    }

    // Sort by time
    events.sort((a, b) => a.timeSeconds - b.timeSeconds);

    return events;
  }

  private addRockBeatEvents(
    events: RawDrumEvent[],
    time: number,
    eighthIndex: number,
  ): void {
    // Hi-hat on every eighth note
    events.push(this.makeEvent(time, 'HH', 42, 0.75 + Math.random() * 0.2));

    // Kick on beats 1 and 3 (eighth indices 0 and 4)
    if (eighthIndex === 0 || eighthIndex === 4) {
      events.push(this.makeEvent(time, 'BD', 36, 0.85 + Math.random() * 0.15));
    }

    // Snare on beats 2 and 4 (eighth indices 2 and 6)
    if (eighthIndex === 2 || eighthIndex === 6) {
      events.push(this.makeEvent(time, 'SD', 38, 0.8 + Math.random() * 0.2));
    }
  }

  private addFillEvents(
    events: RawDrumEvent[],
    time: number,
    eighthIndex: number,
    durationSeconds: number,
  ): void {
    if (eighthIndex < 4) {
      // First half: normal beat
      events.push(this.makeEvent(time, 'HH', 42, 0.7 + Math.random() * 0.2));
      if (eighthIndex === 0) {
        events.push(
          this.makeEvent(time, 'BD', 36, 0.85 + Math.random() * 0.15),
        );
      }
      if (eighthIndex === 2) {
        events.push(this.makeEvent(time, 'SD', 38, 0.8 + Math.random() * 0.2));
      }
    } else {
      // Second half: tom fill (descending) using 3 tom types
      if (eighthIndex === 4) {
        events.push(this.makeEvent(time, 'SD', 38, 0.7 + Math.random() * 0.2));
      }
      if (eighthIndex === 5) {
        events.push(this.makeEvent(time, 'HT', 50, 0.75 + Math.random() * 0.2));
      }
      if (eighthIndex === 6) {
        events.push(this.makeEvent(time, 'MT', 47, 0.75 + Math.random() * 0.2));
      }
      if (eighthIndex === 7) {
        events.push(this.makeEvent(time, 'FT', 43, 0.7 + Math.random() * 0.2));
        // Crash on the "next" beat 1 (but only if within duration)
        const crashTime = time + 60 / this.bpm / 2;
        if (crashTime < durationSeconds) {
          events.push(
            this.makeEvent(crashTime, 'CR', 49, 0.85 + Math.random() * 0.15),
          );
          events.push(
            this.makeEvent(crashTime, 'BD', 36, 0.9 + Math.random() * 0.1),
          );
        }
      }
    }
  }

  private makeEvent(
    timeSeconds: number,
    drumClass: DrumClassName,
    midiPitch: number,
    confidence: number,
  ): RawDrumEvent {
    return {
      timeSeconds,
      drumClass,
      midiPitch,
      confidence: Math.min(1, Math.max(0, confidence)),
    };
  }

  /**
   * Generate a mock ModelOutput that matches the generated events.
   *
   * Creates a sparse activation matrix where peaks correspond to the
   * generated events, with gaussian-like activation around each peak.
   */
  private generateMockModelOutput(
    durationSeconds: number,
    events: RawDrumEvent[],
  ): ModelOutput {
    const fps = 100;
    const nFrames = Math.ceil(durationSeconds * fps);
    const nClasses = NUM_DRUM_CLASSES;
    const predictions = new Float32Array(nFrames * nClasses);

    // For each event, create a gaussian-like activation peak
    for (const event of events) {
      const centerFrame = Math.round(event.timeSeconds * fps);
      const classIdx = DRUM_CLASSES.findIndex(c => c.name === event.drumClass);
      if (classIdx < 0) continue;

      // Write a peak +/- 3 frames around the center
      const spread = 3;
      for (let df = -spread; df <= spread; df++) {
        const frame = centerFrame + df;
        if (frame < 0 || frame >= nFrames) continue;

        const distance = Math.abs(df);
        const falloff = Math.exp((-distance * distance) / 2);
        const value = event.confidence * falloff;

        const idx = frame * nClasses + classIdx;
        predictions[idx] = Math.max(predictions[idx], value);
      }
    }

    return {predictions, nFrames, nClasses};
  }
}
