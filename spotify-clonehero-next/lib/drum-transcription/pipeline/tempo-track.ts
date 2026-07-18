/**
 * The shared "tempo-track" core: the exact stage chain both /drum-
 * transcription and /tempo run to go from raw audio to a final,
 * post-KS-warp Synctrack —
 *
 *   separation -> Beat This! (full mix + drum stem) -> DBA converter
 *     -> CRNN transcribe (drum stem) -> KS-warp / REACH-EXTENSION
 *
 * Every stage here is a call into code that ALREADY has exactly one
 * implementation:
 *   - separation + Beat This! + DBA: runTempoPipelineFromPcm
 *     (lib/tempo-map/pipeline-client.ts + pipeline-worker.ts) — the same
 *     worker drum-transcription's own runner.ts calls via ensureSynctrack().
 *   - CRNN transcription: CrnnTranscriber (../ml/transcriber.ts) — the same
 *     class runner.ts uses for note generation.
 *   - KS-warp/REACH: finalizeSynctrack (lib/tempo-map/finalize-synctrack.ts)
 *     — the same function chart-builder.ts's buildChartDocument calls.
 *
 * This module only COMPOSES those three; it introduces no new stage logic.
 * Given the same audio, drum-transcription's chart-builder.ts and /tempo's
 * runTempoTrack call finalizeSynctrack with the same (rawSynctrack, events)
 * pair, so the two features are structurally unable to install different
 * grids for the same song — see tempo-track-equivalence.test.ts.
 *
 * /drum-transcription continues past this point to snap+emit notes
 * (chart-builder.ts); /tempo stops here and swaps `synctrack` onto a chart
 * of its own (new, or an existing upload's).
 */

import {
  runTempoPipelineFromPcm,
  type TempoPipelineOptions,
} from '@/lib/tempo-map/pipeline-client';
import type {
  LinkSegSections,
  PipelineProgress as TempoStageProgress,
  Synctrack,
} from '@/lib/tempo-map/types';
import type {MeterStats} from '@/lib/tempo-map/meter-confidence';
import {finalizeSynctrack} from '@/lib/tempo-map/finalize-synctrack';
import {CrnnTranscriber, type DrumTranscriber} from '../ml/transcriber';
import {planarStereoToCrnnInput, CRNN_SAMPLE_RATE} from './crnn-audio-prep';
import type {RawDrumEvent} from '../ml/types';

/** Every progress stage the tempo-track pipeline can report — the tempo
 * worker's stages plus the CRNN transcription stage layered on top. */
export type TempoTrackStage = TempoStageProgress['stage'] | 'transcribe-drums';

export interface TempoTrackProgress {
  stage: TempoTrackStage;
  percent?: number;
  etaSeconds?: number;
  detail?: string;
}

export interface TempoTrackResult {
  /** Final synctrack after KS-warp/REACH — the SAME synctrack
   * /drum-transcription installs for identical audio+events. */
  synctrack: Synctrack;
  /** Pre-warp synctrack, kept for diagnostics/debugging only. */
  rawSynctrack: Synctrack;
  /** Raw CRNN events (the warp's onset anchors); also reusable by a caller
   * that wants to build notes from the same transcription. */
  events: RawDrumEvent[];
  durationSeconds: number;
  sections: LinkSegSections | null;
  meterStats: MeterStats | null;
  drumOnsetOffsetMs: number | null;
}

export interface TempoTrackFromPcmInput {
  left: Float32Array;
  right: Float32Array;
  sampleRate: number;
  /** Raw source bytes; hashed for the OPFS drum-stem cache (see
   * runTempoPipelineFromPcm). */
  sourceBytes?: ArrayBuffer | null;
  /**
   * Pre-separated stereo drum stem at 44.1 kHz, when the caller already
   * separated (e.g. drum-transcription's fingerprint-keyed stem cache).
   * Skips BS-Roformer separation for BOTH the Beat This!/DBA stage (a mono
   * mixdown is derived here) and CRNN.
   */
  drumStemStereo?: {left: Float32Array; right: Float32Array} | null;
  /** Overridable for tests (mock transcriber) — defaults to the real
   * ONNX-backed CrnnTranscriber, same as drum-transcription's runner. */
  transcriber?: DrumTranscriber;
  onProgress?: (p: TempoTrackProgress) => void;
}

/**
 * Planar-PCM entry point. Runs the shared tempo-mapping worker, then CRNN
 * transcription on its separated drum stem, then finalizes the grid via
 * KS-warp/REACH — the complete /tempo pipeline, minus note snap+emit.
 */
export async function runTempoTrackFromPcm(
  input: TempoTrackFromPcmInput,
): Promise<TempoTrackResult> {
  const {left, right, sampleRate, sourceBytes = null, onProgress} = input;
  const txr = input.transcriber ?? new CrnnTranscriber();

  let stereoStem = input.drumStemStereo ?? null;
  let drumStemMono: Float32Array | null = null;
  if (stereoStem) {
    const n = Math.min(stereoStem.left.length, stereoStem.right.length);
    const mono = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      mono[i] = (stereoStem.left[i] + stereoStem.right[i]) * 0.5;
    }
    drumStemMono = mono;
  }

  const tempoOpts: TempoPipelineOptions = {
    sourceBytes,
    drumStemMono,
    onProgress: p => onProgress?.(p),
  };
  const tempoResult = await runTempoPipelineFromPcm(
    {left, right, sampleRate},
    tempoOpts,
  );

  if (!stereoStem) {
    if (!tempoResult.drumStemStereo) {
      // Separation failed or (defensively) didn't surface a stem — CRNN has
      // nothing to transcribe. Callers should treat this the same way
      // drum-transcription treats a failed separation: fall back rather
      // than crash the whole tool.
      throw new Error(
        'Drum-stem separation did not produce audio for CRNN transcription.',
      );
    }
    stereoStem = tempoResult.drumStemStereo;
  }

  const crnnInput = await planarStereoToCrnnInput(
    stereoStem.left,
    stereoStem.right,
  );

  const transcribed = await txr.transcribe(
    crnnInput,
    CRNN_SAMPLE_RATE,
    p =>
      onProgress?.({
        stage: 'transcribe-drums',
        percent: p.percent,
        ...(p.detail !== undefined ? {detail: p.detail} : {}),
      }),
  );

  const synctrack = finalizeSynctrack(tempoResult.synctrack, transcribed.events);

  return {
    synctrack,
    rawSynctrack: tempoResult.synctrack,
    events: transcribed.events,
    durationSeconds: transcribed.durationSeconds,
    sections: tempoResult.sections,
    meterStats: tempoResult.meterStats,
    drumOnsetOffsetMs: tempoResult.drumOnsetOffsetMs,
  };
}

/** AudioBuffer entry point — what /tempo's TempoClient.tsx calls. */
export async function runTempoTrack(
  audioBuffer: AudioBuffer,
  options: Omit<TempoTrackFromPcmInput, 'left' | 'right' | 'sampleRate'> = {},
): Promise<TempoTrackResult> {
  const left = audioBuffer.getChannelData(0).slice();
  const right =
    audioBuffer.numberOfChannels > 1
      ? audioBuffer.getChannelData(1).slice()
      : left.slice();
  return runTempoTrackFromPcm({
    left,
    right,
    sampleRate: audioBuffer.sampleRate,
    ...options,
  });
}
