/**
 * The `separate-stems` assist task (plan 0123): separates a project's audio
 * into isolated drums and vocals on demand, so a user who never runs a
 * feature that separates as a side effect — or whose browser evicted the stem
 * cache — can still get the stems onto the mixer and the piano roll.
 *
 * One task with a model arm rather than two tasks: both arms produce the same
 * two stems into the same cache and differ only in quality and time, so one
 * run card, one runner lock and one analytics id cover the pair.
 *
 * | Arm        | Model       | Time  | Cache identity                |
 * | ---------- | ----------- | ----- | ----------------------------- |
 * | `demucs`   | htdemucs    | fast  | `DEMUCS_STEREO_SEPARATOR_ID`  |
 * | `roformer` | BS-Roformer | slow  | `ROFORMER_SEPARATOR_ID`       |
 *
 * The cache is the product: nothing is returned to be installed, and no chart
 * edit follows. That is why the task is outside `CHART_EDITING_TASKS` and is
 * never recorded in a project's `toolsApplied`.
 *
 * The arms are deliberately NOT interchangeable to the features that consume
 * stems. A task that needs BS-Roformer's output still separates for itself
 * when only the Demucs entry exists, exactly as it did before this task
 * existed — the entries live under different separator ids precisely so that
 * cannot go wrong silently.
 */

import {encodePcmToOpus, isOpusEncodeSupported} from '@/lib/audio/opus-encoder';
import {decodeAndResampleTo44k} from '@/lib/audio-pipeline/decode-audio';
import {encodeStemCacheBytesInWorker} from '@/lib/audio-pipeline/pcm-client';
import {
  DEMUCS_VOCALS_SAMPLE_RATE,
  STEM_CACHE_SAMPLE_RATE,
  hasStem,
  hasStemOpus,
  storeStemBytes,
  storeStemOpus,
} from '@/lib/audio-pipeline/stem-cache';
import {
  DRUMS_STEM,
  VOCALS_STEM,
  separateStems,
  type DrumSeparationProgress,
} from '@/lib/audio-pipeline/separate-stems';
import {
  defaultCreateDemucsWorker,
  runDemucsInWorker,
} from '@/lib/lyrics-align/demucs-client';
import type {DemucsStereoStem} from '@/lib/lyrics-align/demucs-worker';
import {hasDemucsModelCached} from '@/lib/lyrics-align/model-urls';
import {hasRoformerModelCached} from '@/lib/tempo-map/models';
import {makeAbortError} from '@/lib/workers/abortable-worker';
import type {PlannedStep} from '../run-to-steps';
import {
  resolveDemucsStereoStemFingerprint,
  resolveDemucsStemFingerprint,
  resolveStemFingerprint,
  type AssistAudio,
  type AssistProgressSink,
  type AssistTaskDef,
} from './types';

/** Which separator a run uses. The user-facing choice is speed against
 *  quality; this is what that choice selects. */
export type StemSeparationModel = 'demucs' | 'roformer';

const STEREO = 2;

/** Copy in the step list for each arm. The download sizes are the models'
 *  real sizes, and they are the reason the step exists: a first run of either
 *  arm spends minutes on a download before any audio is touched. */
const MODEL_COPY: Record<
  StemSeparationModel,
  {downloadLabel: string; downloadDescription: string}
> = {
  demucs: {
    downloadLabel: 'Downloading the fast separator',
    downloadDescription:
      'About 169 MB. Only happens the first time, then it is saved in your ' +
      'browser.',
  },
  roformer: {
    downloadLabel: 'Downloading the high-quality separator',
    downloadDescription:
      'About 336 MB. Only happens the first time, then it is saved in your ' +
      'browser.',
  },
};

export interface SeparateStemsInput {
  audio: AssistAudio;
  model: StemSeparationModel;
}

export interface SeparateStemsResult {
  model: StemSeparationModel;
  /** The stems this run put in the cache, in mixer order. Empty when every
   *  one of them was already there. */
  separated: string[];
}

/** What a run of `model` still has to produce for this audio. Shared by
 *  `planSteps` and `run`, so the step list and the work always agree. */
interface Missing {
  drums: boolean;
  vocals: boolean;
  /** The 16 kHz mono vocals the aligner reads. Demucs arm only. */
  vocals16k: boolean;
}

function nothingMissing(missing: Missing): boolean {
  return !missing.drums && !missing.vocals && !missing.vocals16k;
}

/**
 * Test seam: the worker factories each arm spawns. Lives on the task, not in
 * its input, matching `AddLyricsTaskDeps`.
 */
export interface SeparateStemsTaskDeps {
  createDemucsWorker?: (() => Worker) | undefined;
  createPcmWorker?: (() => Worker) | undefined;
}

export function makeSeparateStemsTask({
  createDemucsWorker = defaultCreateDemucsWorker,
  createPcmWorker,
}: SeparateStemsTaskDeps = {}): AssistTaskDef<
  SeparateStemsResult,
  SeparateStemsInput
> {
  /** What the roformer arm still owes. Its two entries live under one
   *  fingerprint, the same one every other BS-Roformer consumer uses. */
  async function missingRoformer(audio: AssistAudio): Promise<Missing> {
    const fingerprint = await resolveStemFingerprint(audio);
    const [drums, vocals] = await Promise.all([
      hasStem(fingerprint, DRUMS_STEM),
      hasStemOpus(fingerprint, VOCALS_STEM),
    ]);
    return {drums: !drums, vocals: !vocals, vocals16k: false};
  }

  /**
   * What the Demucs arm still owes. Two fingerprints: the full-rate stereo
   * pair this task introduced, and the 16 kHz mono vocals `add-lyrics`
   * already caches. The mono one is written here too — it is about a
   * megabyte, the samples are already in hand, and it saves a later lyrics
   * run a separation it would otherwise pay for itself.
   */
  async function missingDemucs(audio: AssistAudio): Promise<Missing> {
    const [stereoFingerprint, monoFingerprint] = await Promise.all([
      resolveDemucsStereoStemFingerprint(audio),
      resolveDemucsStemFingerprint(audio),
    ]);
    const [drums, vocals, vocals16k] = await Promise.all([
      hasStem(stereoFingerprint, DRUMS_STEM),
      hasStemOpus(stereoFingerprint, VOCALS_STEM),
      hasStemOpus(monoFingerprint, VOCALS_STEM),
    ]);
    return {
      drums: !drums,
      // Opus is how both vocals entries are stored, so a browser without
      // WebCodecs owes neither of them: it cannot write one.
      vocals: !vocals && isOpusEncodeSupported(),
      vocals16k: !vocals16k && isOpusEncodeSupported(),
    };
  }

  function missingFor(input: SeparateStemsInput): Promise<Missing> {
    return input.model === 'roformer'
      ? missingRoformer(input.audio)
      : missingDemucs(input.audio);
  }

  function modelCached(model: StemSeparationModel): Promise<boolean> {
    return model === 'roformer'
      ? hasRoformerModelCached()
      : hasDemucsModelCached();
  }

  /** The roformer arm. `separateStems` owns the whole of it — probe,
   *  separation, and both cache writes — so this only maps its progress onto
   *  the step list. The stems it hands back are dropped: the cache is what
   *  this task exists to fill. */
  async function runRoformer(
    audio: AssistAudio,
    missing: Missing,
    signal: AbortSignal,
    progress: AssistProgressSink,
  ): Promise<void> {
    const onProgress = (p: DrumSeparationProgress) => {
      switch (p.step) {
        case 'loading-model':
          progress({activeKey: 'download-model', progress: p.percent});
          return;
        case 'processing':
          progress({
            activeKey: 'separate',
            progress: p.percent,
            etaSeconds: p.etaSeconds,
          });
          return;
        case 'storing':
          progress({activeKey: 'store', progress: p.percent});
          return;
        case 'done':
          return;
      }
    };
    await separateStems(
      await audio.loadOriginalBytes(),
      {
        drums: missing.drums,
        vocals: missing.vocals,
        signal,
        createPcmWorker,
      },
      onProgress,
    );
  }

  /** One stem's channels as the interleaved PCM the Opus encoder takes. */
  function interleave(stem: DemucsStereoStem): Float32Array {
    const frames = Math.min(stem.left.length, stem.right.length);
    const interleaved = new Float32Array(frames * STEREO);
    for (let i = 0; i < frames; i++) {
      interleaved[i * STEREO] = stem.left[i];
      interleaved[i * STEREO + 1] = stem.right[i];
    }
    return interleaved;
  }

  /** The Demucs arm: one pass over the song producing whatever is still
   *  missing, then the cache writes. */
  async function runDemucs(
    audio: AssistAudio,
    missing: Missing,
    signal: AbortSignal,
    progress: AssistProgressSink,
  ): Promise<void> {
    const decoded = await decodeAndResampleTo44k(
      await audio.loadOriginalBytes(),
      {signal, createWorker: createPcmWorker},
    );
    if (signal.aborted) throw makeAbortError();

    const result = await runDemucsInWorker(
      decoded,
      {
        drums: missing.drums,
        vocals: missing.vocals,
        vocals16k: missing.vocals16k,
      },
      p =>
        progress({
          activeKey:
            p.phase === 'loading-model' ? 'download-model' : 'separate',
          progress: p.percent ?? 0,
          etaSeconds: p.etaSeconds,
          detail: p.message,
        }),
      createDemucsWorker,
      signal,
    );
    if (signal.aborted) throw makeAbortError();

    progress({activeKey: 'store', progress: 0});
    const [stereoFingerprint, monoFingerprint] = await Promise.all([
      resolveDemucsStereoStemFingerprint(audio),
      resolveDemucsStemFingerprint(audio),
    ]);

    if (result.drums) {
      // Packed and gzipped in the PCM worker for the same reason
      // `separateStems` does it there: a full-song stem is tens of megabytes
      // and Blink deflates one write in a single uninterrupted task.
      const {bytes} = await encodeStemCacheBytesInWorker(result.drums, {
        createWorker: createPcmWorker,
        signal,
      });
      await storeStemBytes(stereoFingerprint, DRUMS_STEM, bytes);
    }
    progress({activeKey: 'store', progress: 0.5});
    if (result.vocals) {
      await storeStemOpus(
        stereoFingerprint,
        VOCALS_STEM,
        await encodePcmToOpus(
          interleave(result.vocals),
          STEM_CACHE_SAMPLE_RATE,
          STEREO,
        ),
      );
    }
    if (result.vocals16k) {
      await storeStemOpus(
        monoFingerprint,
        VOCALS_STEM,
        await encodePcmToOpus(result.vocals16k, DEMUCS_VOCALS_SAMPLE_RATE, 1),
      );
    }
    progress({activeKey: 'store', progress: 1});
  }

  return {
    key: 'separate-stems',
    title: 'Separate stems',

    async planSteps(input) {
      const copy = MODEL_COPY[input.model];
      const [missing, downloaded] = await Promise.all([
        missingFor(input),
        modelCached(input.model),
      ]);
      // Everything already cached means the run does nothing at all, so no
      // step is pending — including the download, which only happens to
      // separate.
      const cached = nothingMissing(missing);
      const steps: PlannedStep[] = [
        {
          key: 'download-model',
          label: copy.downloadLabel,
          description: copy.downloadDescription,
          cached: cached || downloaded,
        },
        {
          key: 'separate',
          label: 'Splitting the song into stems',
          description:
            'Listening for the drum kit and the voice separately. This is ' +
            'the longest step.',
          cached,
        },
        {
          key: 'store',
          label: 'Saving the stems',
          description: undefined,
          cached,
        },
      ];
      return steps;
    },

    async run({audio, model}, signal, progress) {
      if (signal.aborted) throw makeAbortError();

      const missing = await missingFor({audio, model});
      // Both arms are re-runnable: a second run over a fully cached song is a
      // no-op rather than a repeated separation.
      if (!nothingMissing(missing)) {
        if (model === 'roformer') {
          await runRoformer(audio, missing, signal, progress);
        } else {
          await runDemucs(audio, missing, signal, progress);
        }
      }

      progress({activeKey: null, terminal: 'done'});
      const separated: string[] = [];
      if (missing.drums) separated.push(DRUMS_STEM);
      if (missing.vocals || missing.vocals16k) separated.push(VOCALS_STEM);
      return {model, separated};
    },
  };
}

export const separateStemsTask = makeSeparateStemsTask();
