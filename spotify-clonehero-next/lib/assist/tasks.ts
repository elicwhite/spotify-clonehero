/**
 * Assist task definitions (plan 0074 Phase 1, Design A).
 *
 * An `AssistTaskDef` is a thin shell: `planSteps` predicts a step list
 * (purely presentational, recomputed at start), `run` performs one
 * implementation call per task and reports progress in the units
 * `run-to-steps.ts` consumes. Per the plan's "honest scoping", the engine
 * does NOT pretend to own stages that the wrapped functions already own
 * internally (fingerprint/cache/decode) — a task's step list is a reporting
 * projection over those functions' own progress callbacks, not a second
 * pipeline implementation.
 *
 * Tasks are values, and callers start a run by handing the runner the task
 * itself, so each call site's result type comes from the task it named.
 *
 * Two tasks ship in Phase 1: `transcribe-drums` (shells the existing
 * `runner.ts` orchestration, driven by the editor's Regenerate control) and
 * `add-lyrics` (the vocals-resolution branch, driven by the in-editor Add
 * Lyrics dialog; the `/add-lyrics` home screen moves onto it in Phase 6).
 * `generate-tempo-map`, `generate-difficulties`, and `add-leading-silence`
 * land in later phases.
 */

import type {ChartDocument, DrumNote} from '@/lib/chart-edit';
import {readChart, getDrumNotes} from '@/lib/chart-edit';
import {
  findProjectChartFile,
  getProject,
  readProjectBinary,
} from '@/lib/drum-transcription/storage/opfs';
import {hasDrumStem} from '@/lib/drum-transcription/ml/roformer-separation';
import {regenerateProject} from '@/lib/drum-transcription/pipeline/runner';
import {
  computeStemFingerprint,
  ROFORMER_SEPARATOR_ID,
  hasStemOpus,
  loadStemOpus,
} from '@/lib/audio-pipeline/stem-cache';
import {resampleTo16kMono} from '@/lib/audio-pipeline/lyrics-audio';
import {decodeAndResampleTo44k} from '@/lib/audio-pipeline/decode-audio';
import {
  runDemucsInWorker,
  defaultCreateDemucsWorker,
} from '@/lib/lyrics-align/demucs-client';
import {alignVocals, type AlignedSyllable} from '@/lib/lyrics-align/aligner';
import {makeAbortError} from '@/lib/workers/abortable-worker';
import {waitForOrtRuntime} from '@/lib/onnx/ort-ready';
import {
  REGENERATE_PLANNED_STEPS,
  pipelineProgressToStepEvent,
} from '@/lib/drum-transcription/pipeline/step-mapping';
import type {PlannedStep, StepProgressEvent} from './run-to-steps';

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export type AssistTaskKey =
  | 'transcribe-drums'
  | 'generate-tempo-map'
  | 'add-lyrics'
  | 'generate-difficulties'
  | 'add-leading-silence';

export interface AssistAudio {
  /** Loads the raw audio bytes on demand. Lazy because a task that resolves
   *  its work from the stem cache must never pay for the read. */
  loadOriginalBytes: () => Promise<Uint8Array>;
  /**
   * The stem-cache fingerprint, from whichever authority owns it — for an
   * OPFS project that is `ensureProjectStemFingerprint`, the persisted value
   * every stem was stored under. Supplied, it is used verbatim; omitted, it
   * is derived by hashing the audio bytes.
   */
  stemFingerprint?: string | undefined;
}

export interface AssistContext {
  /** The song's audio, for tasks that need it. Absent for tasks whose
   *  wrapped implementation reads its own audio from OPFS. */
  audio?: AssistAudio | undefined;
  /** OPFS drum-transcription project. Present for project-backed flows;
   *  absent for standalone /tempo, /add-lyrics runs. */
  project?: {id: string} | undefined;
  /** Pasted lyrics text — required by `add-lyrics`. */
  lyrics?: string | undefined;
}

export type AssistProgressSink = (event: StepProgressEvent) => void;

export interface AssistTaskDef<Result> {
  key: AssistTaskKey;
  title: string;
  /** Predicts the step list for this run (may consult existence probes /
   *  project state). Purely presentational; recomputed at start. */
  planSteps(ctx: AssistContext): Promise<PlannedStep[]>;
  /** One implementation call. Receives a progress sink and the signal. */
  run(
    ctx: AssistContext,
    signal: AbortSignal,
    progress: AssistProgressSink,
  ): Promise<Result>;
}

/**
 * Awaits `promise`, rejecting with an AbortError as soon as `signal` fires
 * (or immediately, if it has already fired). This is what lets a task's
 * `run()` reject promptly on cancel even when the wrapped function it calls
 * has no signal support of its own. Reserved for exactly that case — a
 * wrapped function that takes the signal already owns its own cancellation
 * — see the cancellation-gap comment in `add-lyrics` for what it can and
 * can't stop there.
 *
 * The abort listener is removed however the race settles, so a long run
 * never accumulates listeners on the signal.
 */
async function raceWithAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) throw makeAbortError();
  let onAbort!: () => void;
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(makeAbortError());
    signal.addEventListener('abort', onAbort, {once: true});
  });
  // The loser of the race stays rejected; mark it handled so it is never an
  // unhandled rejection.
  aborted.catch(() => {});
  try {
    return await Promise.race([promise, aborted]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

function requireAudio(ctx: AssistContext): AssistAudio {
  if (!ctx.audio) throw new Error('assist: this task requires ctx.audio');
  return ctx.audio;
}

// ---------------------------------------------------------------------------
// transcribe-drums
// ---------------------------------------------------------------------------

/** The regenerated chart's SyncTrack. The fresh notes' ticks are authored
 *  against it, and `regenerateProject` re-predicts it from scratch, so it
 *  must be applied together with the notes. */
export interface TranscribeDrumsSync {
  resolution: number;
  tempos: ChartDocument['parsedChart']['tempos'];
  timeSignatures: ChartDocument['parsedChart']['timeSignatures'];
}

export interface TranscribeDrumsResult {
  /** Fresh Expert Drums notes, ready for `ReplaceDrumTrackCommand`. */
  notes: DrumNote[];
  sync: TranscribeDrumsSync;
}

function requireProjectId(ctx: AssistContext): string {
  if (!ctx.project) {
    throw new Error('transcribe-drums requires ctx.project');
  }
  return ctx.project.id;
}

export const transcribeDrumsTask: AssistTaskDef<TranscribeDrumsResult> = {
  key: 'transcribe-drums',
  title: 'Drum transcription',

  async planSteps(ctx) {
    const projectId = requireProjectId(ctx);
    const separatingCached = await hasDrumStem(projectId);
    // A provided-grid project's tempo map is the user's own chart and is
    // never predicted; every other run re-predicts it (this task's only
    // consumer is Regenerate, which forces a fresh map).
    const {gridSource} = await getProject(projectId);
    const tempoCached = gridSource === 'provided';
    return REGENERATE_PLANNED_STEPS.map(cfg => ({
      ...cfg,
      cached:
        cfg.key === 'separating'
          ? separatingCached
          : cfg.key === 'tempo-mapping'
            ? tempoCached
            : false,
    }));
  },

  async run(ctx, signal, progress) {
    const projectId = requireProjectId(ctx);

    // The transcription and tempo workers resolve ONNX Runtime from the
    // page's `<Script>` global. That precondition belongs to the work that
    // needs it, not to whichever surface happens to start it. The poll takes
    // the signal, so a cancel here stops it outright.
    await waitForOrtRuntime({signal});

    // `regenerateProject` owns cancellation for this call: it checks the
    // signal at every stage boundary, terminates the separation,
    // tempo-mapping, and transcription workers on abort and rejects with an
    // AbortError, and it writes nothing until the run has fully succeeded,
    // so a cancel leaves the persisted project untouched.
    await regenerateProject(
      projectId,
      pipelineProgress => {
        progress(pipelineProgressToStepEvent(pipelineProgress));
      },
      undefined,
      {signal},
    );

    const chartFileName = await findProjectChartFile(projectId);
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
        'transcribe-drums: no Expert Drums track in the regenerated chart',
      );
    }

    return {
      notes: getDrumNotes(drumTrack),
      sync: {
        resolution: chartDoc.parsedChart.resolution,
        tempos: chartDoc.parsedChart.tempos,
        timeSignatures: chartDoc.parsedChart.timeSignatures,
      },
    };
  },
};

// ---------------------------------------------------------------------------
// add-lyrics
// ---------------------------------------------------------------------------

const VOCALS_STEM_NAME = 'vocals';

/** The separation step describes the branch `planSteps` predicted: a cache
 *  hit reuses the BS-Roformer vocals a drum-transcription run already
 *  separated, and only a miss runs Demucs. Labelling a cache hit "Demucs"
 *  would describe work that never happens. */
function separateStepDescription(cached: boolean): string {
  return cached
    ? 'Reusing the separated BS-Roformer vocals'
    : 'Demucs vocal separation';
}

const ADD_LYRICS_STEPS: ReadonlyArray<Omit<PlannedStep, 'cached'>> = [
  {
    key: 'separate',
    label: 'Separating vocals from the mix',
    description: undefined,
  },
  {key: 'load', label: 'Loading vocals stem', description: undefined},
  {
    key: 'syllabify',
    label: 'Splitting lyrics into syllables',
    description: undefined,
  },
  {key: 'align', label: 'Aligning syllables to audio', description: undefined},
];

export interface AddLyricsResult {
  syllables: AlignedSyllable[];
  /** True when `lowConfidenceFrac >= 0.75` (mirrors `alignVocals`'s own
   *  internal tier-2-escalation signal; not itself a tier-2 retry here). */
  lowConfidence: boolean;
  lowConfidenceFrac: number;
  /** True when the run aligned against roformer vocals from the stem cache
   *  rather than a fresh Demucs separation. */
  usedCachedVocals: boolean;
}

function requireLyrics(ctx: AssistContext): string {
  const lyrics = ctx.lyrics?.trim();
  if (!lyrics) throw new Error('add-lyrics requires ctx.lyrics');
  return lyrics;
}

/** The fingerprint the vocals stem would be cached under: the caller's
 *  authoritative value when it has one, else derived from the audio bytes. */
async function vocalsFingerprint(ctx: AssistContext): Promise<string> {
  const audio = requireAudio(ctx);
  if (audio.stemFingerprint) return audio.stemFingerprint;
  return computeStemFingerprint(
    await audio.loadOriginalBytes(),
    ROFORMER_SEPARATOR_ID,
  );
}

/** Test seam: the Demucs worker factory the fallback branch spawns. Lives on
 *  the task, not on `AssistContext` — it is specific to this task's
 *  implementation, and a shared payload has no business carrying it. */
export interface AddLyricsTaskDeps {
  createDemucsWorker?: (() => Worker) | undefined;
}

export function makeAddLyricsTask({
  createDemucsWorker = defaultCreateDemucsWorker,
}: AddLyricsTaskDeps = {}): AssistTaskDef<AddLyricsResult> {
  /** Demucs fallback branch: decode the full mix and separate vocals fresh.
   *  Real cancellation — `runDemucsInWorker` accepts `signal` and terminates
   *  its worker on abort. */
  async function separateWithDemucs(
    ctx: AssistContext,
    signal: AbortSignal,
    progress: AssistProgressSink,
  ): Promise<Float32Array> {
    if (signal.aborted) throw makeAbortError();
    progress({activeKey: 'separate', progress: 0});
    const audioBuffer = await decodeAndResampleTo44k(
      await requireAudio(ctx).loadOriginalBytes(),
    );
    if (signal.aborted) throw makeAbortError();
    const vocals16k = await runDemucsInWorker(
      audioBuffer,
      p =>
        progress({
          activeKey: 'separate',
          progress: p.percent ?? 0,
          etaSeconds: p.etaSeconds,
          detail: p.message,
        }),
      createDemucsWorker,
      signal,
    );
    progress({activeKey: 'separate', progress: 1});
    return vocals16k;
  }

  return {
    key: 'add-lyrics',
    title: 'Lyrics / Vocals',

    async planSteps(ctx) {
      const fingerprint = await vocalsFingerprint(ctx);
      const cached = await hasStemOpus(fingerprint, VOCALS_STEM_NAME);
      return ADD_LYRICS_STEPS.map(cfg =>
        cfg.key === 'separate'
          ? {...cfg, cached, description: separateStepDescription(cached)}
          : {...cfg, cached: false},
      );
    },

    async run(ctx, signal, progress) {
      const lyrics = requireLyrics(ctx);
      if (signal.aborted) throw makeAbortError();

      const fingerprint = await vocalsFingerprint(ctx);
      // The probe decides the branch; `loadStemOpus` is the one authority on
      // whether the bytes it hands back are actually usable (returns null on
      // a corrupt/interrupted entry), so a probe hit that turns into a load
      // miss still falls back to Demucs rather than failing the task.
      const cachedOpus = (await hasStemOpus(fingerprint, VOCALS_STEM_NAME))
        ? await loadStemOpus(fingerprint, VOCALS_STEM_NAME)
        : null;

      let vocals16k: Float32Array;
      let usedCachedVocals = false;
      if (cachedOpus) {
        progress({activeKey: 'load', progress: 0});
        vocals16k = await resampleTo16kMono(cachedOpus, 'audio/opus');
        usedCachedVocals = true;
      } else {
        vocals16k = await separateWithDemucs(ctx, signal, progress);
      }
      progress({activeKey: 'load', progress: 1});

      if (signal.aborted) throw makeAbortError();

      progress({activeKey: 'syllabify', progress: 0});

      // Cancellation gap: `alignVocals` (lib/lyrics-align/aligner.ts) has no
      // AbortSignal support — it owns a single persistent module-level
      // worker shared with any other page that preloaded it (e.g.
      // AddLyricsDialog's preload effect), so this task cannot terminate it
      // without breaking that sharing for other concurrent callers. The
      // `raceWithAbort` below still makes `run()` reject promptly on cancel;
      // the alignment worker keeps computing in the background until it
      // naturally finishes, and its result is simply discarded.
      const alignPromise = alignVocals(vocals16k, lyrics, (msg, info) => {
        if (msg.startsWith('Syllabified:')) {
          progress({activeKey: 'align', progress: 0});
        } else if (!msg.startsWith('Done:')) {
          progress({activeKey: 'align', detail: msg, progress: info?.percent});
        }
      });
      alignPromise.catch(() => {});

      const result = await raceWithAbort(alignPromise, signal);
      if (signal.aborted) throw makeAbortError();

      progress({activeKey: null, terminal: 'done'});
      return {
        syllables: result.syllables,
        lowConfidence: result.lowConfidence,
        lowConfidenceFrac: result.lowConfidenceFrac,
        usedCachedVocals,
      };
    },
  };
}

export const addLyricsTask = makeAddLyricsTask();
