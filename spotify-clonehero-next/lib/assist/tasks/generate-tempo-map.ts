/**
 * The `generate-tempo-map` assist task (plan 0074 Design A): wraps the tempo
 * pipeline for `/tempo` and the editor's `ReplaceTempoMapCommand`.
 */

import {hasStem} from '@/lib/audio-pipeline/stem-cache';
import {DRUMS_STEM} from '@/lib/audio-pipeline/separate-stems';
import {decodeAndResampleTo44k} from '@/lib/audio-pipeline/decode-audio';
import {defaultCreateWorker as defaultCreateTempoWorker} from '@/lib/tempo-map/pipeline-client';
import {runTempoTrack} from '@/lib/drum-transcription/pipeline/tempo-track';
import type {DrumTranscriber} from '@/lib/drum-transcription/ml/transcriber';
import type {Synctrack} from '@/lib/tempo-map/types';
import type {MeterStats} from '@/lib/tempo-map/meter-confidence';
import {makeAbortError} from '@/lib/workers/abortable-worker';
import type {PlannedStep} from '../run-to-steps';
import {
  resolveStemFingerprint,
  type AssistAudio,
  type AssistTaskDef,
} from './types';

/** One planned step per pipeline stage (`PipelineProgress['stage']`) — the
 *  tempo pipeline's own stage union, reported verbatim rather than
 *  re-grouped, so the step list never drifts from what the worker actually
 *  reports. */
const GENERATE_TEMPO_MAP_STEPS: ReadonlyArray<Omit<PlannedStep, 'cached'>> = [
  {
    key: 'download-separation-model',
    label: 'Downloading the drum-separation model',
    description:
      'About 336 MB. Only happens the first time, then it is saved in your browser.',
  },
  {
    key: 'separate',
    label: 'Isolating the drums',
    description: 'Listening for just the drum kit. This is the longest step.',
  },
  {
    key: 'download-beat-model',
    label: 'Downloading the beat-finding model',
    description: 'About 83 MB. Only happens the first time.',
  },
  {
    key: 'beats-fullmix',
    label: 'Finding the beat of the whole song',
    description: undefined,
  },
  {
    key: 'beats-drums',
    label: 'Finding the beat of the drums',
    description: undefined,
  },
  {key: 'convert', label: 'Building the tempo map', description: undefined},
  {
    key: 'transcribe-drums',
    label: 'Aligning grid to drum hits',
    description:
      'Finds where the kicks and snares actually land and nudges the grid ' +
      'onto them, so bar lines sit on the beat you hear instead of near it.',
  },
];

export interface GenerateTempoMapInput {
  audio: AssistAudio;
}

export interface GenerateTempoMapResult {
  /** Final SyncTrack after KS-warp/REACH, ready for `ReplaceTempoMapCommand`
   *  — the same grid `/drum-transcription` installs for identical audio. */
  synctrack: Synctrack;
  meterStats: MeterStats | null;
  drumOnsetOffsetMs: number | null;
  /** The separated drum stem the CRNN transcribed, planar stereo at 44.1 kHz
   *  (null if separation produced no audio). Hosts that render a drum
   *  waveform use this rather than re-reading the stem cache. */
  drumStemStereo: {left: Float32Array; right: Float32Array} | null;
}

/** Test seam: the tempo pipeline worker factory this task spawns, and the
 *  CRNN transcriber whose onsets anchor the warp. Live on the task, not in
 *  its input, matching `AddLyricsTaskDeps`. */
export interface GenerateTempoMapTaskDeps {
  createWorker?: (() => Worker) | undefined;
  transcriber?: DrumTranscriber | undefined;
}

export function makeGenerateTempoMapTask({
  createWorker = defaultCreateTempoWorker,
  transcriber,
}: GenerateTempoMapTaskDeps = {}): AssistTaskDef<
  GenerateTempoMapResult,
  GenerateTempoMapInput
> {
  return {
    key: 'generate-tempo-map',
    title: 'Tempo map',

    async planSteps({audio}) {
      const originalBytes = await audio.loadOriginalBytes();
      const fingerprint = await resolveStemFingerprint(audio, originalBytes);
      const separatingCached = await hasStem(fingerprint, DRUMS_STEM);
      // A cached drum stem skips the separation model download too — the
      // pipeline only loads that model to separate. Showing it as pending
      // work would promise a step that never runs.
      return GENERATE_TEMPO_MAP_STEPS.map(cfg => ({
        ...cfg,
        cached:
          separatingCached &&
          (cfg.key === 'separate' || cfg.key === 'download-separation-model'),
      }));
    },

    async run({audio}, signal, progress) {
      if (signal.aborted) throw makeAbortError();
      const originalBytes = await audio.loadOriginalBytes();

      if (signal.aborted) throw makeAbortError();
      // A host that already has the song decoded — a chart package's stems
      // merged into one buffer, or a single file the page decoded for its
      // own use — supplies that buffer; everything else decodes here.
      const audioBuffer = audio.loadDecodedMix
        ? await audio.loadDecodedMix()
        : await decodeAndResampleTo44k(originalBytes, {signal});
      const sourceBytes = originalBytes.buffer.slice(
        originalBytes.byteOffset,
        originalBytes.byteOffset + originalBytes.byteLength,
      ) as ArrayBuffer;

      // `runTempoTrack` is the single composition of beat-tracking + CRNN +
      // KS-warp/REACH finalization that `/drum-transcription`'s chart-builder
      // mirrors, so both features install the same grid for the same audio
      // (tempo-track-equivalence.test.ts).
      //
      // No cached-stem load here: `sourceBytes` gives the pipeline worker the
      // stem fingerprint, and the worker is the one authority on the drum
      // stem cache — it loads a cached stem itself (falling back to a fresh
      // separation on a corrupt entry) in the thread that consumes it, so the
      // stem never crosses the main thread. `planSteps`'s `hasStem` probe is
      // step-list prediction only (plan 0074 Design A).
      const result = await runTempoTrack(audioBuffer, {
        sourceBytes,
        // Section titles belong to the chart's author. Generating a grid must
        // never rewrite them, so the LinkSeg stage is off here entirely and
        // lives in its own `generate-sections` task (plan 0076 item 23).
        sections: false,
        onProgress: p => {
          progress({
            activeKey: p.stage,
            progress: p.percent,
            etaSeconds: p.etaSeconds,
            detail: p.detail,
          });
        },
        createWorker,
        signal,
        ...(transcriber ? {transcriber} : {}),
      });

      progress({activeKey: null, terminal: 'done'});
      return {
        synctrack: result.synctrack,
        meterStats: result.meterStats,
        drumOnsetOffsetMs: result.drumOnsetOffsetMs,
        drumStemStereo: result.drumStemStereo,
      };
    },
  };
}

export const generateTempoMapTask = makeGenerateTempoMapTask();
