/**
 * The `transcribe-drums` assist task as an editor host runs it: from the
 * song's audio and the chart already open, with no OPFS drum-transcription
 * project behind it.
 *
 * The host hands over the song as ONE mix of the stems it holds — the same
 * {@link AssistAudio} boundary `generate-tempo-map` consumes — and this task
 * re-separates the drums back out of that mix with BS-Roformer before
 * transcribing. It never transcribes a stem the user supplied: a
 * "drums.ogg" from a chart package is a bounced kit with bleed and
 * mastering on it, and the CRNN was trained on Roformer output, so feeding
 * it anything else quietly costs accuracy. Separation goes through
 * `separateStems`, so a mix already separated for the tempo map is a cache
 * hit rather than a second GPU pass.
 *
 * The chart's own SyncTrack is the grid the notes are authored against —
 * there is no tempo-mapping stage here, exactly as in `runner.ts`'s
 * existing-chart ordering.
 *
 * `lib/assist/tasks/transcribe-drums.ts` is the project-backed sibling: the
 * `/drum-transcription` orderings, which own OPFS state (decoded onsets,
 * confidence, a predicted grid) this one has nowhere to put.
 */

import {findTrack, getAudioAnchor, getDrumNotes} from '@/lib/chart-edit';
import type {ChartDocument, DrumNote} from '@/lib/chart-edit';
import type {RawDrumEvent} from '@/lib/drum-transcription/ml/types';
import {DRUMS_STEM, separateStems} from '@/lib/audio-pipeline/separate-stems';
import {hasStem} from '@/lib/audio-pipeline/stem-cache';
import {TARGET_SAMPLE_RATE} from '@/lib/drum-transcription/audio/types';
import {
  CRNN_SAMPLE_RATE,
  planarStereoToCrnnInput,
} from '@/lib/drum-transcription/pipeline/crnn-audio-prep';
import {buildChartDocumentFromExistingChart} from '@/lib/drum-transcription/pipeline/chart-builder';
import {AUDIO_TRANSCRIBE_PLANNED_STEPS} from '@/lib/drum-transcription/pipeline/step-mapping';
import {separationProgressToFraction} from '@/lib/drum-transcription/pipeline/separation-progress';
import {CrnnTranscriber} from '@/lib/drum-transcription/ml/transcriber';
import type {DrumTranscriber} from '@/lib/drum-transcription/ml/transcriber';
import {waitForOrtRuntime} from '@/lib/onnx/ort-ready';
import {makeAbortError} from '@/lib/workers/abortable-worker';
import type {TranscribeDrumsSync} from './transcribe-drums';
import {
  resolveStemFingerprint,
  type AssistAudio,
  type AssistTaskDef,
} from './types';

export interface TranscribeDrumsFromAudioInput {
  /** The song's audio, as the host mixes it down. */
  audio: AssistAudio;
  /** The chart being edited. Its SyncTrack is the grid the fresh notes are
   *  snapped to, and its other tracks are left alone. */
  chartDoc: ChartDocument;
}

export interface TranscribeDrumsFromAudioResult {
  /** Fresh Expert Drums notes, ready for `ReplaceDrumTrackCommand`. */
  notes: DrumNote[];
  /** The grid the notes were authored against — the chart's own, unchanged.
   *  Handed back so the caller applies notes and sync together, the same
   *  contract the project-backed task has. */
  sync: TranscribeDrumsSync;
}

/**
 * Move decoded onsets from original-audio time into the chart's time domain.
 *
 * The transcriber analyzes the host's ORIGINAL audio bytes, while a chart
 * with leading silence lives on a padded timeline whose `audioAnchor.ms` is
 * the chart-ms of original audio sample 0 (0064 addendum §7). Every onset
 * therefore shifts by that anchor before it is snapped, the same convention
 * `ReplaceSectionsCommand` applies to LinkSeg times and `ReDeriveNotesCommand`
 * applies to retained onsets. Without it every note on a padded chart lands
 * one anchor early.
 *
 * `anchorMs` of 0 (no padding) returns the events untouched.
 */
export function shiftOnsetsToChartTime(
  events: RawDrumEvent[],
  anchorMs: number,
): RawDrumEvent[] {
  if (anchorMs === 0) return events;
  return events.map(e => ({
    ...e,
    timeSeconds: e.timeSeconds + anchorMs / 1000,
  }));
}

/** Test seam: the transcriber the run uses. Omitted, a `CrnnTranscriber`. */
export interface TranscribeDrumsFromAudioTaskDeps {
  transcriber?: DrumTranscriber | undefined;
}

export function makeTranscribeDrumsFromAudioTask({
  transcriber,
}: TranscribeDrumsFromAudioTaskDeps = {}): AssistTaskDef<
  TranscribeDrumsFromAudioResult,
  TranscribeDrumsFromAudioInput
> {
  return {
    key: 'transcribe-drums',
    title: 'Drum transcription',

    async planSteps({audio}) {
      const fingerprint = await resolveStemFingerprint(audio);
      // A cached drum stem for this exact mix — separated here before, or by
      // the tempo map, which keys the same cache — is separation this run
      // skips outright.
      const separatingCached = await hasStem(fingerprint, DRUMS_STEM);
      return AUDIO_TRANSCRIBE_PLANNED_STEPS.map(cfg => ({
        ...cfg,
        cached: separatingCached && cfg.key === 'separating',
      }));
    },

    async run({audio, chartDoc}, signal, progress) {
      // The separation and transcription workers resolve ONNX Runtime from
      // the page's `<Script>` global; the poll takes the signal, so a cancel
      // during the wait stops the run outright.
      await waitForOrtRuntime({
        signal,
        onWaiting: () => progress({activeKey: 'loading-runtime', progress: 0}),
      });
      if (signal.aborted) throw makeAbortError();

      const mixBytes = await audio.loadOriginalBytes();
      if (signal.aborted) throw makeAbortError();

      progress({activeKey: 'separating', progress: 0});
      const {drums} = await separateStems(mixBytes, {drums: true, signal}, p =>
        progress({
          activeKey: 'separating',
          progress: separationProgressToFraction(p),
          etaSeconds: p.etaSeconds,
        }),
      );
      if (!drums) {
        throw new Error('Drum separation produced no drum stem');
      }
      if (signal.aborted) throw makeAbortError();

      progress({activeKey: 'transcribing', progress: 0});
      const crnnAudio = await planarStereoToCrnnInput(
        drums.left,
        drums.right,
        TARGET_SAMPLE_RATE,
      );
      const txr = transcriber ?? new CrnnTranscriber();
      const result = await txr.transcribe(
        crnnAudio,
        CRNN_SAMPLE_RATE,
        p => progress({activeKey: 'transcribing', progress: p.percent}),
        signal,
      );
      if (signal.aborted) throw makeAbortError();

      // Same snap stage as the chart flow: quantize against the chart's own
      // tempo list, replacing only the Expert Drums track.
      const built = buildChartDocumentFromExistingChart(
        chartDoc,
        shiftOnsetsToChartTime(
          result.events,
          getAudioAnchor(chartDoc)?.ms ?? 0,
        ),
        result.durationSeconds,
      );
      const drumTrack = findTrack(built, {
        instrument: 'drums',
        difficulty: 'expert',
      });
      if (!drumTrack) {
        throw new Error(
          'transcribe-drums: no Expert Drums track in the transcribed chart',
        );
      }

      progress({activeKey: null, terminal: 'done'});
      return {
        notes: getDrumNotes(drumTrack.track),
        sync: {
          resolution: built.parsedChart.resolution,
          tempos: built.parsedChart.tempos,
          timeSignatures: built.parsedChart.timeSignatures,
        },
      };
    },
  };
}

export const transcribeDrumsFromAudioTask = makeTranscribeDrumsFromAudioTask();
