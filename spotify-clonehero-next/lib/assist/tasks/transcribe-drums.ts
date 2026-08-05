/**
 * The `transcribe-drums` assist task (plan 0074 Design A).
 *
 * Composes `runner.ts`'s four orderings (fresh upload, existing chart
 * package, resume, regenerate) behind one task: the ordering to run is named
 * by the input, and `planSteps` predicts its step list from the same OPFS
 * existence checks the ordering performs. Every one of them owns an OPFS
 * drum-transcription project, which is what separates this task from
 * `transcribe-drums-from-audio.ts` — the same task key run against a host's
 * audio and open chart, with no project to keep.
 */

import type {ChartDocument, DrumNote} from '@/lib/chart-edit';
import {readChart, getDrumNotes} from '@/lib/chart-edit';
import {
  CHART_FILE_BASENAMES,
  hasProjectChartFile,
  hasStoredAudio,
  projectFileExists,
  readProjectBinary,
} from '@/lib/drum-transcription/storage/opfs';
import {hasDrumStem} from '@/lib/drum-transcription/ml/roformer-separation';
import {
  regenerateProject,
  resumePipeline,
  runPipeline,
  runPipelineFromChart,
  type ExistingChartPipelineInput,
} from '@/lib/drum-transcription/pipeline/runner';
import type {DrumTranscriber} from '@/lib/drum-transcription/ml/transcriber';
import {
  SYNCTRACK_FILE,
  type PipelineProgress,
} from '@/lib/drum-transcription/pipeline/stages';
import {waitForOrtRuntime} from '@/lib/onnx/ort-ready';
import {
  PIPELINE_PLANNED_STEPS,
  REGENERATE_PLANNED_STEPS,
  pipelineProgressToStepEvent,
} from '@/lib/drum-transcription/pipeline/step-mapping';
import type {PlannedStep} from '../run-to-steps';
import type {AssistTaskDef} from './types';

/** The chart's SyncTrack as the run left it. The fresh notes' ticks are
 *  authored against it, and a regeneration re-predicts it from scratch, so it
 *  must be applied together with the notes. */
export interface TranscribeDrumsSync {
  resolution: number;
  tempos: ChartDocument['parsedChart']['tempos'];
  timeSignatures: ChartDocument['parsedChart']['timeSignatures'];
}

export interface TranscribeDrumsResult {
  /** The OPFS project the run produced (upload/chart) or advanced
   *  (resume/regenerate). */
  projectId: string;
  /** The pipeline's own Expert Drums notes, ready for
   *  `ReplaceDrumTrackCommand`. Read from the generated chart file, never
   *  from an autosaved `notes.edited.chart` sibling — the caller is applying
   *  these over the editor's live document, so handing back that document's
   *  own autosave would be a no-op dressed as a regeneration. */
  notes: DrumNote[];
  sync: TranscribeDrumsSync;
}

/**
 * Called once the run has created its OPFS project, before the rest of the
 * pipeline runs. A run that creates a project is resumable from the moment
 * it exists, so a host that wants a failed run's Retry to continue that
 * project rather than start a second one needs the id before the result.
 */
export type ProjectCreatedCallback = (projectId: string) => void;

/**
 * Which of `runner.ts`'s orderings a `transcribe-drums` run performs. The
 * four differ only in where the project comes from and how much of the
 * pipeline still has to happen; the stages themselves
 * (`pipeline/stages.ts`) and the OPFS bookkeeping around them are identical
 * and belong to the runner, not to this task.
 */
export type TranscribeDrumsRun =
  /** Fresh audio upload: create the project, then the whole pipeline. */
  | {kind: 'upload'; audioFile: File | ArrayBuffer; fileName: string}
  /** Existing chart package: transcribe against its own SyncTrack, never a
   *  predicted one, so the tempo-mapping stage never runs. */
  | {kind: 'chart'; input: ExistingChartPipelineInput}
  /** Interrupted project: fill in only what OPFS is still missing. */
  | {kind: 'resume'; projectId: string}
  /** In-editor re-run: recompute the tempo map and notes for a project that
   *  already has both, replacing them only on full success. */
  | {kind: 'regenerate'; projectId: string};

export interface TranscribeDrumsInput {
  /** The ordering to perform, and the data it needs. Plain data. */
  run: TranscribeDrumsRun;
  /**
   * Notified with the project id as soon as the run has one. Kept beside the
   * run rather than inside it because it is a channel back to the host, not
   * part of what the run IS — a host can restate the same run with a
   * different listener without rebuilding the run itself.
   */
  onProjectCreated?: ProjectCreatedCallback | undefined;
}

function planCached(
  steps: readonly PlannedStep[],
  cached: Record<string, boolean>,
  descriptions: Record<string, string> = {},
): PlannedStep[] {
  return steps.map(cfg => ({
    ...cfg,
    cached: cached[cfg.key] ?? false,
    description: descriptions[cfg.key] ?? cfg.description,
  }));
}

/** The chart file the PIPELINE wrote, ignoring the editor's autosaved
 *  `.edited` sibling that `findProjectChartFile` deliberately prefers. */
async function findGeneratedChartFile(
  projectId: string,
): Promise<string | null> {
  for (const name of [CHART_FILE_BASENAMES.chart, CHART_FILE_BASENAMES.mid]) {
    if (await projectFileExists(projectId, name)) return name;
  }
  return null;
}

/** Test seam: the transcriber the pipeline runs. Omitted, `runner.ts`
 *  constructs its default `CrnnTranscriber`. */
export interface TranscribeDrumsTaskDeps {
  transcriber?: DrumTranscriber | undefined;
}

export function makeTranscribeDrumsTask({
  transcriber,
}: TranscribeDrumsTaskDeps = {}): AssistTaskDef<
  TranscribeDrumsResult,
  TranscribeDrumsInput
> {
  return {
    key: 'transcribe-drums',
    title: 'Drum transcription',

    // Every branch below predicts from the SAME OPFS existence checks the
    // ordering itself performs, so a step marked cached is a step the run
    // really skips.
    async planSteps({run}) {
      if (run.kind === 'upload') {
        // A fresh project has nothing stored yet.
        return planCached(PIPELINE_PLANNED_STEPS, {});
      }

      if (run.kind === 'chart') {
        return planCached(
          PIPELINE_PLANNED_STEPS,
          {'tempo-mapping': true},
          {'tempo-mapping': 'Using the tempo map from your chart'},
        );
      }

      if (run.kind === 'regenerate') {
        // `regenerateProject` only accepts predicted-grid projects (it throws
        // for provided-grid ones), so a regeneration always re-predicts the
        // tempo map. Separation is the only step a regeneration can skip.
        const separatingCached = await hasDrumStem(run.projectId);
        return planCached(REGENERATE_PLANNED_STEPS, {
          separating: separatingCached,
        });
      }

      // Resume: the same three checks `resumePipeline` makes, plus the
      // persisted-map check `ensureSynctrack` makes in 'resume' mode.
      const [hasAudio, hasStems, hasChart, hasSynctrack] = await Promise.all([
        hasStoredAudio(run.projectId),
        hasDrumStem(run.projectId),
        hasProjectChartFile(run.projectId),
        projectFileExists(run.projectId, SYNCTRACK_FILE),
      ]);
      return planCached(PIPELINE_PLANNED_STEPS, {
        decoding: hasAudio,
        separating: hasStems,
        // A resume with a chart already on disk does no work past
        // separation at all; without one it still reuses a persisted map.
        'tempo-mapping': hasChart || hasSynctrack,
        transcribing: hasChart,
      });
    },

    async run({run, onProjectCreated}, signal, progress) {
      // The transcription and tempo workers resolve ONNX Runtime from the
      // page's `<Script>` global. That precondition belongs to the work that
      // needs it, not to whichever surface happens to start it. The poll takes
      // the signal, so a cancel here stops it outright.
      await waitForOrtRuntime({
        signal,
        onWaiting: () => progress({activeKey: 'loading-runtime', progress: 0}),
      });

      // The runner owns cancellation for every call below: it checks the
      // signal at each stage boundary, terminates the separation,
      // tempo-mapping, and transcription workers on abort, and rejects with
      // an AbortError. A cancelled regeneration leaves the project exactly as
      // it was; a cancelled upload/resume keeps whatever stages already
      // landed, which is what makes the project resumable.
      // The runner names the project it created on every tick after
      // creation; report the first one so a host can act on a failure that
      // happens later in the same run.
      let reportedProjectId: string | null = null;
      const onPipelineProgress = (pipelineProgress: PipelineProgress) => {
        if (pipelineProgress.projectId && reportedProjectId === null) {
          reportedProjectId = pipelineProgress.projectId;
          onProjectCreated?.(reportedProjectId);
        }
        progress(pipelineProgressToStepEvent(pipelineProgress));
      };

      let projectId: string;
      switch (run.kind) {
        case 'upload':
          projectId = await runPipeline(
            run.audioFile,
            run.fileName,
            onPipelineProgress,
            transcriber,
            {signal},
          );
          break;
        case 'chart':
          projectId = await runPipelineFromChart(
            run.input,
            onPipelineProgress,
            transcriber,
            {signal},
          );
          break;
        case 'resume':
          projectId = await resumePipeline(
            run.projectId,
            onPipelineProgress,
            transcriber,
            {signal},
          );
          break;
        case 'regenerate':
          projectId = await regenerateProject(
            run.projectId,
            onPipelineProgress,
            transcriber,
            {signal},
          );
          break;
      }

      const chartFileName = await findGeneratedChartFile(projectId);
      if (!chartFileName) {
        throw new Error(
          'transcribe-drums: pipeline finished with no persisted chart file',
        );
      }
      const chartBuf = await readProjectBinary(projectId, chartFileName);
      const chartDoc = readChart(
        [{fileName: chartFileName, data: new Uint8Array(chartBuf)}],
        {pro_drums: true},
      );
      const drumTrack = chartDoc.parsedChart.trackData.find(
        t => t.instrument === 'drums' && t.difficulty === 'expert',
      );
      if (!drumTrack) {
        throw new Error(
          'transcribe-drums: no Expert Drums track in the transcribed chart',
        );
      }

      return {
        projectId,
        notes: getDrumNotes(drumTrack),
        sync: {
          resolution: chartDoc.parsedChart.resolution,
          tempos: chartDoc.parsedChart.tempos,
          timeSignatures: chartDoc.parsedChart.timeSignatures,
        },
      };
    },
  };
}

export const transcribeDrumsTask = makeTranscribeDrumsTask();
