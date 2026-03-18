/**
 * Drum transcription pipeline.
 *
 * Provides a `DrumTranscriber` interface with two implementations:
 *
 * - `OnnxTranscriber` — real ONNX inference with the ADTOF Frame_RNN model.
 *   Uses the shared ONNX runtime from onnx-runtime.ts (WebGPU only).
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
  AdtofClassName,
  SpectrogramConfig,
} from './types';
import {
  DEFAULT_SPECTROGRAM_CONFIG,
  ADTOF_CLASSES,
  NUM_ADTOF_CLASSES,
} from './types';
import {computeLogFilteredSpectrogram} from './spectrogram';
import {pickPeaksFromModelOutput} from './peak-picking';
import {
  createInferenceSession,
  getOrt,
  type OrtInferenceSession,
} from './onnx-runtime';

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
   * @param audioData - Mono audio at the expected sample rate (44100 Hz).
   * @param sampleRate - Sample rate of the audio.
   * @param onProgress - Optional progress callback.
   * @returns The transcription result with raw events and model output.
   */
  transcribe(
    audioData: Float32Array,
    sampleRate: number,
    onProgress?: TranscriptionProgressCallback,
  ): Promise<TranscriptionResult>;
}

// ---------------------------------------------------------------------------
// ONNX Transcriber (real inference)
// ---------------------------------------------------------------------------

/** URL for the ADTOF Frame_RNN ONNX model (served from /public/models/). */
const ADTOF_MODEL_URL = '/models/adtof_frame_rnn.onnx';

/**
 * Real ONNX-based drum transcriber using the ADTOF Frame_RNN model.
 *
 * Pipeline:
 *   1. Compute log-filtered spectrogram
 *   2. Run ONNX inference (WebGPU)
 *   3. Peak picking
 */
export class OnnxTranscriber implements DrumTranscriber {
  private modelUrl: string;
  private spectrogramConfig: SpectrogramConfig;

  constructor(
    modelUrl: string = ADTOF_MODEL_URL,
    spectrogramConfig: SpectrogramConfig = DEFAULT_SPECTROGRAM_CONFIG,
  ) {
    this.modelUrl = modelUrl;
    this.spectrogramConfig = spectrogramConfig;
  }

  async transcribe(
    audioData: Float32Array,
    sampleRate: number,
    onProgress?: TranscriptionProgressCallback,
  ): Promise<TranscriptionResult> {
    const durationSeconds = audioData.length / sampleRate;

    // Step 1: Compute spectrogram
    onProgress?.({step: 'computing-spectrogram', percent: 0.05});
    const {spectrogram, nFrames, numBands} = computeLogFilteredSpectrogram(
      audioData,
      this.spectrogramConfig,
    );

    // Step 2: Load model and run inference
    onProgress?.({step: 'loading-model', percent: 0.1});
    const session = await createInferenceSession(this.modelUrl);

    try {
      onProgress?.({step: 'running-inference', percent: 0.2});

      const predictions = await this.runInference(
        session,
        spectrogram,
        nFrames,
        numBands,
      );

      const modelOutput: ModelOutput = {
        predictions,
        nFrames,
        nClasses: NUM_ADTOF_CLASSES,
      };

      // Step 3: Peak picking
      onProgress?.({step: 'post-processing', percent: 0.9});
      const events = pickPeaksFromModelOutput(modelOutput);

      onProgress?.({step: 'done', percent: 1});

      return {events, modelOutput, durationSeconds};
    } finally {
      await session.release();
    }
  }

  /**
   * Run the ADTOF model inference.
   *
   * Input shape: [1, n_frames, 84, 1]
   * Output shape: [1, n_frames, 5]
   */
  private async runInference(
    session: OrtInferenceSession,
    spectrogram: Float32Array,
    nFrames: number,
    numBands: number,
  ): Promise<Float32Array> {
    const ort = getOrt();

    const inputTensor = new ort.Tensor('float32', spectrogram, [
      1,
      nFrames,
      numBands,
      1,
    ]);

    const results = await session.run({spectrogram: inputTensor});
    inputTensor.dispose();

    const outputKey = Object.keys(results)[0];
    const outputTensor = results[outputKey];
    const predictions = new Float32Array(outputTensor.data);
    outputTensor.dispose();

    return predictions;
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
    audioData: Float32Array,
    sampleRate: number,
    onProgress?: TranscriptionProgressCallback,
  ): Promise<TranscriptionResult> {
    const durationSeconds = audioData.length / sampleRate;

    onProgress?.({step: 'computing-spectrogram', percent: 0.1});

    // Simulate processing time
    await new Promise<void>((resolve) => setTimeout(resolve, 100));

    onProgress?.({step: 'running-inference', percent: 0.5});

    const events = this.generateMockPattern(durationSeconds);
    const modelOutput = this.generateMockModelOutput(durationSeconds, events);

    onProgress?.({step: 'post-processing', percent: 0.9});

    await new Promise<void>((resolve) => setTimeout(resolve, 50));

    onProgress?.({step: 'done', percent: 1});

    return {events, modelOutput, durationSeconds};
  }

  /**
   * Generate a realistic rock beat pattern.
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
          // Fill pattern: toms descending, then crash on next beat 1
          this.addFillEvents(events, noteTime, eighth, durationSeconds);
        } else {
          // Normal rock beat
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
      events.push(this.makeEvent(time, 'BD', 35, 0.85 + Math.random() * 0.15));
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
          this.makeEvent(time, 'BD', 35, 0.85 + Math.random() * 0.15),
        );
      }
      if (eighthIndex === 2) {
        events.push(
          this.makeEvent(time, 'SD', 38, 0.8 + Math.random() * 0.2),
        );
      }
    } else {
      // Second half: tom fill (descending)
      if (eighthIndex === 4 || eighthIndex === 5) {
        events.push(
          this.makeEvent(time, 'SD', 38, 0.7 + Math.random() * 0.2),
        );
      }
      if (eighthIndex === 6) {
        events.push(
          this.makeEvent(time, 'TT', 47, 0.75 + Math.random() * 0.2),
        );
      }
      if (eighthIndex === 7) {
        events.push(
          this.makeEvent(time, 'TT', 47, 0.7 + Math.random() * 0.2),
        );
        // Crash on the "next" beat 1 (but only if within duration)
        const crashTime = time + 60 / this.bpm / 2;
        if (crashTime < durationSeconds) {
          events.push(
            this.makeEvent(
              crashTime,
              'CY+RD',
              49,
              0.85 + Math.random() * 0.15,
            ),
          );
          events.push(
            this.makeEvent(
              crashTime,
              'BD',
              35,
              0.9 + Math.random() * 0.1,
            ),
          );
        }
      }
    }
  }

  private makeEvent(
    timeSeconds: number,
    drumClass: AdtofClassName,
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
    const nClasses = NUM_ADTOF_CLASSES;
    const predictions = new Float32Array(nFrames * nClasses);

    // For each event, create a gaussian-like activation peak
    for (const event of events) {
      const centerFrame = Math.round(event.timeSeconds * fps);
      const classIdx = ADTOF_CLASSES.findIndex(
        (c) => c.name === event.drumClass,
      );
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
