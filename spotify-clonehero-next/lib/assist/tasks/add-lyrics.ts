/**
 * The `add-lyrics` assist task (plan 0074 Design A).
 *
 * One vocals-resolution implementation shared by the `/add-lyrics` home
 * screen and the in-editor dialog, so both surfaces get the same step list
 * and the same math. Which vocals a run aligns against is named by the
 * caller as a single union rather than inferred from which optional fields
 * happen to be set, so `planSteps` and `run` branch over the same value.
 */

import {
  DEMUCS_VOCALS_SAMPLE_RATE,
  hasStemOpus,
  loadStemOpus,
  storeStemOpus,
} from '@/lib/audio-pipeline/stem-cache';
import {encodePcmToOpus, isOpusEncodeSupported} from '@/lib/audio/opus-encoder';
import {VOCALS_STEM} from '@/lib/audio-pipeline/separate-stems';
import {
  mixStemsToAudioBuffer,
  resampleTo16kMono,
} from '@/lib/audio-pipeline/lyrics-audio';
import {decodeAndResampleTo44k} from '@/lib/audio-pipeline/decode-audio';
import {
  runDemucsInWorker,
  defaultCreateDemucsWorker,
} from '@/lib/lyrics-align/demucs-client';
import {alignVocals, type AlignedSyllable} from '@/lib/lyrics-align/aligner';
import {makeAbortError} from '@/lib/workers/abortable-worker';
import type {PlannedStep} from '../run-to-steps';
import {
  resolveDemucsStemFingerprint,
  resolveStemFingerprint,
  type AssistAudio,
  type AssistProgressSink,
  type AssistTaskDef,
} from './types';

/** A stem file as the host holds it, before any decode. */
export interface AddLyricsStemFile {
  data: Uint8Array;
  mimeType: string;
}

/** Where a run's vocals come from. The three arms are the plan's
 *  vocals-resolution rule made explicit at the call site. */
export type AddLyricsVocals =
  /**
   * A vocals stem already bundled in the chart package (a `vocals.ogg`/
   * `.mp3`/`.wav` a charter shipped alongside song/guitar/drums). This is
   * charter-provided audio, not anything the assist pipeline ever produced,
   * so its presence skips separation entirely: no cache probe, no Demucs.
   */
  | {kind: 'bundled'; stem: AddLyricsStemFile}
  /**
   * Force the Demucs branch against a mix of these stems. Used by
   * `/add-lyrics`'s tier-2 escalation, which always wants a fresh separation
   * over a reconstructed mix of every chart stem regardless of what pass 1
   * used. The mixdown happens inside the run so it is covered by the run's
   * cancellation and step list.
   */
  | {kind: 'stems'; stems: ReadonlyArray<AddLyricsStemFile>}
  /**
   * Resolve from the song audio: reuse the BS-Roformer vocals a separation
   * run already cached under this audio's fingerprint, else the Demucs
   * vocals an earlier run of this task cached, else separate fresh with
   * Demucs and cache that.
   */
  | {kind: 'resolve'; audio: AssistAudio};

export interface AddLyricsInput {
  /** Pasted lyrics text, one line per phrase. */
  lyrics: string;
  vocals: AddLyricsVocals;
}

/** Which cached vocals a `resolve` run found, in the order it prefers them:
 *  the 44.1 kHz stereo BS-Roformer stem a separation run left behind, else
 *  the 16 kHz mono stem an earlier Demucs fallback stored. Null is a miss on
 *  both, the only case that separates. */
type CachedVocals = 'roformer' | 'demucs' | null;

/** The separation step describes the branch `planSteps` predicted, naming
 *  which vocals a cache hit will reuse. Labelling a cache hit "Demucs
 *  separation" would describe work that never happens. */
function separateStepDescription(cached: CachedVocals): string {
  switch (cached) {
    case 'roformer':
      return 'Reusing the separated BS-Roformer vocals';
    case 'demucs':
      return 'Reusing the separated Demucs vocals';
    case null:
      return 'Demucs vocal separation';
  }
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

/** The step list with only the separation step's prediction varying — every
 *  other step is plain work in all three branches. */
function planWithSeparation(
  cached: boolean,
  description: string,
): PlannedStep[] {
  return ADD_LYRICS_STEPS.map(cfg =>
    cfg.key === 'separate'
      ? {...cfg, cached, description}
      : {...cfg, cached: false},
  );
}

export interface AddLyricsResult {
  syllables: AlignedSyllable[];
  /** True when `lowConfidenceFrac >= 0.75` (mirrors `alignVocals`'s own
   *  internal tier-2-escalation signal; not itself a tier-2 retry here). */
  lowConfidence: boolean;
  lowConfidenceFrac: number;
  /** Which of the three vocals-resolution branches this run took. */
  vocalsSource: 'bundled' | 'cache' | 'demucs';
  /** A copy of the resolved vocals stem this run aligned against, 16kHz
   *  mono. A host that renders a highway waveform (`/add-lyrics`) uses this
   *  rather than re-deriving it; never serialized into a downloaded chart.
   *  Owned by the caller: `alignVocals` transfers the stem it aligns, so
   *  this is a separate buffer that survives the run. */
  vocals16k: Float32Array;
}

/**
 * Awaits `promise`, rejecting with an AbortError as soon as `signal` fires
 * (or immediately, if it has already fired). This is what lets `run()`
 * reject promptly on cancel even though `alignVocals` has no signal support
 * of its own — see the cancellation-gap comment below for what it can and
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

/** Test seam: the Demucs worker factory the fallback branch spawns. Lives on
 *  the task, not in its input — it is specific to this task's
 *  implementation, and a run's data has no business carrying it. */
export interface AddLyricsTaskDeps {
  createDemucsWorker?: (() => Worker) | undefined;
}

export function makeAddLyricsTask({
  createDemucsWorker = defaultCreateDemucsWorker,
}: AddLyricsTaskDeps = {}): AssistTaskDef<AddLyricsResult, AddLyricsInput> {
  /** Demucs separation against an already-decoded mix. Real cancellation —
   *  `runDemucsInWorker` accepts `signal` and terminates its worker on
   *  abort. Shared by the cache-miss branch (decodes the caller's original
   *  bytes first) and the tier-2 forced branch (already has a mix). */
  async function separateWithDemucsBuffer(
    audioBuffer: AudioBuffer,
    signal: AbortSignal,
    progress: AssistProgressSink,
  ): Promise<Float32Array> {
    if (signal.aborted) throw makeAbortError();
    progress({activeKey: 'separate', progress: 0});
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

  /** Which cached vocals a `resolve` run would use. Shared by `planSteps`
   *  (which only reports it) and `run` (which reads it back), so the step
   *  list and the work always name the same branch. */
  async function probeCachedVocals(audio: AssistAudio): Promise<CachedVocals> {
    if (await hasStemOpus(await resolveStemFingerprint(audio), VOCALS_STEM)) {
      return 'roformer';
    }
    if (
      await hasStemOpus(await resolveDemucsStemFingerprint(audio), VOCALS_STEM)
    ) {
      return 'demucs';
    }
    return null;
  }

  /**
   * Caches the vocals a Demucs run just separated, so the next run on this
   * audio reuses them and the editor can offer them as a stem — the same
   * courtesy a BS-Roformer separation already does. Filed under the Demucs
   * separator id: these are 16 kHz mono, not roformer's 44.1 kHz stereo.
   *
   * Never throws. Alignment that worked must not fail over a cache write.
   */
  async function cacheDemucsVocals(
    audio: AssistAudio,
    vocals16k: Float32Array,
  ): Promise<void> {
    // Nothing to report on a browser without WebCodecs: the vocals simply
    // stay in memory for this run, exactly as they did before there was a
    // cache entry to write.
    if (!isOpusEncodeSupported()) return;
    try {
      const opus = await encodePcmToOpus(
        vocals16k,
        DEMUCS_VOCALS_SAMPLE_RATE,
        1,
      );
      await storeStemOpus(
        await resolveDemucsStemFingerprint(audio),
        VOCALS_STEM,
        opus,
      );
    } catch (err) {
      console.warn('Could not cache the separated Demucs vocals:', err);
    }
  }

  /** The `resolve` branch: whichever cached vocals `probeCachedVocals` found,
   *  else a fresh Demucs separation of the decoded mix, which is cached on
   *  the way out. */
  async function resolveVocals(
    audio: AssistAudio,
    signal: AbortSignal,
    progress: AssistProgressSink,
  ): Promise<{vocals16k: Float32Array; source: 'cache' | 'demucs'}> {
    // The probe decides the branch; `loadStemOpus` is the one authority on
    // whether the bytes it hands back are actually usable (returns null on a
    // corrupt/interrupted entry), so a probe hit that turns into a load miss
    // still falls back to Demucs rather than failing the task.
    const cached = await probeCachedVocals(audio);
    const cachedOpus = cached
      ? await loadStemOpus(
          cached === 'roformer'
            ? await resolveStemFingerprint(audio)
            : await resolveDemucsStemFingerprint(audio),
          VOCALS_STEM,
        )
      : null;

    if (cachedOpus) {
      progress({activeKey: 'load', progress: 0});
      return {
        vocals16k: await resampleTo16kMono(cachedOpus, 'audio/opus'),
        source: 'cache',
      };
    }

    if (signal.aborted) throw makeAbortError();
    const audioBuffer = await decodeAndResampleTo44k(
      await audio.loadOriginalBytes(),
      {signal},
    );
    if (signal.aborted) throw makeAbortError();
    const vocals16k = await separateWithDemucsBuffer(
      audioBuffer,
      signal,
      progress,
    );
    await cacheDemucsVocals(audio, vocals16k);
    return {vocals16k, source: 'demucs'};
  }

  return {
    key: 'add-lyrics',
    title: 'Lyrics',

    async planSteps({vocals}) {
      switch (vocals.kind) {
        case 'stems':
          return planWithSeparation(
            false,
            'Re-separating vocals from full mix',
          );
        case 'bundled':
          return planWithSeparation(true, 'Vocals stem bundled with the chart');
        case 'resolve': {
          const cached = await probeCachedVocals(vocals.audio);
          return planWithSeparation(
            cached != null,
            separateStepDescription(cached),
          );
        }
      }
    },

    async run({lyrics: lyricsText, vocals}, signal, progress) {
      const lyrics = lyricsText.trim();
      if (!lyrics) throw new Error('add-lyrics requires lyrics text');
      if (signal.aborted) throw makeAbortError();

      let vocals16k: Float32Array;
      let vocalsSource: AddLyricsResult['vocalsSource'];

      switch (vocals.kind) {
        case 'stems': {
          progress({
            activeKey: 'separate',
            progress: 0,
            detail: 'Mixing chart stems for re-separation...',
          });
          const mixed = await mixStemsToAudioBuffer([...vocals.stems]);
          if (signal.aborted) throw makeAbortError();
          vocals16k = await separateWithDemucsBuffer(mixed, signal, progress);
          vocalsSource = 'demucs';
          break;
        }
        case 'bundled': {
          progress({activeKey: 'load', progress: 0});
          vocals16k = await resampleTo16kMono(
            vocals.stem.data,
            vocals.stem.mimeType,
          );
          vocalsSource = 'bundled';
          break;
        }
        case 'resolve': {
          const resolved = await resolveVocals(vocals.audio, signal, progress);
          vocals16k = resolved.vocals16k;
          vocalsSource = resolved.source;
          break;
        }
      }
      progress({activeKey: 'load', progress: 1});

      if (signal.aborted) throw makeAbortError();

      progress({activeKey: 'syllabify', progress: 0});

      // `alignVocals` transfers `vocals16k.buffer` into its worker, which
      // detaches the view. Copy first so the returned stem is still readable
      // by a host that renders a waveform from it. Cheap (~5 MB for a
      // five-minute song at 16 kHz).
      const vocals16kForCaller = new Float32Array(vocals16k);

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
        vocalsSource,
        vocals16k: vocals16kForCaller,
      };
    },
  };
}

export const addLyricsTask = makeAddLyricsTask();
