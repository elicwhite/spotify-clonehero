'use client';

/**
 * The stems an assist run separated out of a project's audio, read back from
 * the fingerprint-keyed stem cache and handed to `usePaddedAudio` so they
 * appear on the Stems mixer with their AI-separated badge (plan 0076 item
 * 18).
 *
 * The cache is the authority on what was actually separated — a
 * `generate-tempo-map` run's BS-Roformer pass writes both its drums and its
 * vocals there, and an `add-lyrics` run writes the Demucs vocals it fell back
 * to — so this probes the cache rather than trying to catch each task's own
 * result shape. It probes on mount (so stems separated in an earlier session
 * are on the mixer from the start) and again the moment a run that can
 * separate succeeds.
 *
 * The cache key is project state when already known, but old projects and
 * projects created by another entrypoint may have cached stems without that
 * metadata link. On open, the editor resolves the key from the project's
 * canonical audio bytes, persists it, and probes the cache. This makes cache
 * contents authoritative regardless of which entrypoint created the project.
 *
 * The same probe answers the other half of the question (plan 0123): which
 * `separate-stems` runs would still add something. It is the one place that
 * knows both what the package lacks and what each separator has already
 * produced, so deciding it anywhere else would mean probing the cache twice
 * and risking two different answers.
 */

import {useCallback, useEffect, useRef, useState} from 'react';

import {
  hasStem,
  hasStemOpus,
  loadStem,
  loadStemOpus,
  STEM_CACHE_SAMPLE_RATE,
} from '@/lib/audio-pipeline/stem-cache';
import type {StereoStem} from '@/lib/audio-pipeline/stem-cache';
import {DRUMS_STEM, VOCALS_STEM} from '@/lib/audio-pipeline/separate-stems';
import {resampleStereoInWorker} from '@/lib/audio-pipeline/pcm-client';
import {
  resolveDemucsStereoStemFingerprint,
  resolveDemucsStemFingerprint,
  resolveStemFingerprint,
} from '@/lib/assist/tasks/types';
import type {LoadAssistAudio} from '@/lib/assist/tasks/types';
import {decodeAtRate} from '@/lib/audio-pipeline/decode-audio';
import {rememberDecodedBuffer} from '@/lib/preview/decodedPcm';
import {interleaveAudioBuffer} from '@/lib/drum-transcription/audio/decoder';
import {useAssistRunnerContext} from '@/components/assist/AssistRunnerProvider';
import {useAssistRunActivity} from '@/components/assist/useAssistRunner';
import {packageHasDrumsAudio, type DecodedPackageAudio} from './projectAudio';
import type {AudioStemInput} from './usePaddedAudio';

/** The tasks whose success can leave a new stem in the cache. */
const SEPARATING_TASKS = new Set([
  'generate-tempo-map',
  'add-lyrics',
  'transcribe-drums',
  'separate-stems',
]);

/** A cached stem's planar L/R as the interleaved stereo PCM the rest of the
 *  editor's audio path carries. */
function interleaveStereoStem(stem: StereoStem): Float32Array {
  const frames = Math.min(stem.left.length, stem.right.length);
  const interleaved = new Float32Array(frames * 2);
  for (let i = 0; i < frames; i++) {
    interleaved[i * 2] = stem.left[i];
    interleaved[i * 2 + 1] = stem.right[i];
  }
  return interleaved;
}

/**
 * A cached stem as interleaved PCM at the package's own rate.
 *
 * The cache is always at {@link STEM_CACHE_SAMPLE_RATE} — it holds what the
 * separator produced — while a package plays at whatever rate its own files
 * decode at. Every track in one `AudioManager` build is padded and measured
 * against a single rate, so a stem that doesn't match has to be brought to
 * the package's, or it would play at the wrong speed under the mixer.
 */
async function stemAtPackageRate(
  stem: StereoStem,
  sampleRate: number,
): Promise<Float32Array> {
  if (sampleRate === STEM_CACHE_SAMPLE_RATE) return interleaveStereoStem(stem);
  // Copies: the caller's channels stay usable, and the worker detaches what
  // it is given.
  const resampled = await resampleStereoInWorker(
    stem.left.slice(),
    stem.right.slice(),
    STEM_CACHE_SAMPLE_RATE,
    sampleRate,
  );
  return interleaveStereoStem(resampled);
}

/**
 * Which separator a stem on the mixer came out of. Carried beside the stem
 * list so a re-probe can tell "the same two stems" from "the same two stems,
 * upgraded" — running BS-Roformer over a project that only had the 16 kHz
 * Demucs vocals produces a list with identical names, and comparing names
 * alone would leave the worse audio playing.
 */
type StemSource = 'roformer' | 'demucs';

interface ProbedStem {
  name: string;
  source: StemSource;
}

/** Two probes found the same stems, from the same separators. */
function sameStems(
  a: ReadonlyArray<ProbedStem>,
  b: ReadonlyArray<ProbedStem>,
): boolean {
  return (
    a.length === b.length &&
    a.every((stem, i) => stem.name === b[i].name && stem.source === b[i].source)
  );
}

/**
 * Which separators are worth running on this project, from what the cache
 * already holds.
 *
 * A separator is offered while it does not hold every stem the package
 * itself lacks. BS-Roformer holding all of them also retires the Demucs
 * option: it is the faster and worse of the two, so once the better output
 * exists there is nothing left for it to add.
 */
export interface StemSeparationOffer {
  demucs: boolean;
  roformer: boolean;
}

const NO_OFFER: StemSeparationOffer = {demucs: false, roformer: false};

export interface UseSeparatedStemsParams {
  /** Identity of the project being edited. Everything here is per-project:
   *  the host component is reused across a client-side project switch, and a
   *  retained fingerprint would load the previous song's stems. */
  projectId: string;
  /** The project's own decoded audio. Null until it has loaded — nothing can
   *  be probed before then, since which stems are even wanted depends on
   *  which the package already ships. */
  packageAudio: DecodedPackageAudio | null;
  /** The host's assist-audio loader, the same one the assist tasks work
   *  from, so the fingerprint derived here keys the same cache entries they
   *  write. */
  loadAssistAudio: LoadAssistAudio | null | undefined;
  /** The fingerprint already persisted for this project, when there is one. */
  storedFingerprint: string | null | undefined;
  /** Called with a freshly computed fingerprint so the host can persist it.
   *  Must be referentially stable. */
  onFingerprintResolved: (fingerprint: string) => void;
}

export interface SeparatedStems {
  /** The separated stems to play, in mixer order. */
  stems: ReadonlyArray<AudioStemInput>;
  /** Which `separate-stems` runs would still add something. */
  offer: StemSeparationOffer;
}

export function useSeparatedStems({
  projectId,
  packageAudio,
  loadAssistAudio,
  storedFingerprint,
  onFingerprintResolved,
}: UseSeparatedStemsParams): SeparatedStems {
  const [stems, setStems] = useState<ReadonlyArray<AudioStemInput>>([]);
  const [offer, setOffer] = useState<StemSeparationOffer>(NO_OFFER);
  // The fingerprint in hand: the persisted one, or one computed after a
  // separating run. Cleared on a project switch (the effect below).
  const fingerprintRef = useRef<string | null>(null);
  // The two Demucs keys, hashed at most once per project each. Neither is
  // ever the persisted fingerprint (that one is BS-Roformer's): the stereo
  // key files what an on-demand fast separation wrote, the mono key what an
  // `add-lyrics` fallback wrote.
  const demucsStereoFingerprintRef = useRef<string | null>(null);
  const demucsFingerprintRef = useRef<string | null>(null);
  // What the last published list actually was, by name AND separator.
  const publishedRef = useRef<ReadonlyArray<ProbedStem>>([]);
  // Identity of the last assist run this hook reacted to, so one run's
  // success triggers exactly one probe.
  const lastAssistOutcomeRef = useRef('');

  useEffect(() => {
    return () => {
      fingerprintRef.current = null;
      demucsStereoFingerprintRef.current = null;
      demucsFingerprintRef.current = null;
      publishedRef.current = [];
      lastAssistOutcomeRef.current = '';
      setStems([]);
      setOffer(NO_OFFER);
    };
  }, [projectId]);

  /**
   * Reads back whatever the cache holds for this project and publishes it,
   * along with which separators still have work to do.
   * `mayComputeFingerprint` remains explicit so callers can choose whether a
   * missing key should be resolved before probing.
   *
   * Silent on every failure: a missing/corrupt cache entry simply means
   * there is no separated stem to show.
   */
  const probe = useCallback(
    async (mayComputeFingerprint: boolean) => {
      const pkg = packageAudio;
      if (!pkg || !loadAssistAudio) return;
      // Decide what could possibly be wanted BEFORE paying for a
      // fingerprint: a package that ships its own drums and its own vocals
      // has no room for either separated stem, so there is nothing to look
      // up and nothing to offer separating.
      const wantDrums = !packageHasDrumsAudio(pkg);
      const wantVocals = !pkg.stems.some(stem => stem.name === VOCALS_STEM);
      if (!wantDrums && !wantVocals) {
        setOffer(NO_OFFER);
        return;
      }

      try {
        let fingerprint = fingerprintRef.current ?? storedFingerprint ?? null;
        if (!fingerprint) {
          if (!mayComputeFingerprint) return;
          fingerprint = await resolveStemFingerprint(await loadAssistAudio());
          onFingerprintResolved(fingerprint);
        }
        fingerprintRef.current = fingerprint;

        // The full-rate Demucs key. Paid for once per project: every probe
        // below needs it, both to play what a fast separation produced and
        // to decide whether running one again would add anything.
        const demucsStereoFingerprint = (demucsStereoFingerprintRef.current ??=
          await resolveDemucsStereoStemFingerprint(await loadAssistAudio()));

        const {sampleRate} = pkg.meta;
        const next: AudioStemInput[] = [];
        const probed: ProbedStem[] = [];
        // What each separator holds of what this package lacks. Seeded true
        // for a stem the package ships itself: neither separator owes it.
        const roformerHas = {drums: !wantDrums, vocals: !wantVocals};
        const demucsHas = {drums: !wantDrums, vocals: !wantVocals};

        if (wantDrums) {
          const roformerDrums = await loadStem(fingerprint, DRUMS_STEM);
          roformerHas.drums = roformerDrums != null;
          const drums =
            roformerDrums ??
            (await loadStem(demucsStereoFingerprint, DRUMS_STEM));
          // A load answers the demucs probe too when the roformer one
          // missed; otherwise ask the cache directly rather than reading a
          // stem this render will not play.
          demucsHas.drums = roformerDrums
            ? await hasStem(demucsStereoFingerprint, DRUMS_STEM)
            : drums != null;
          if (drums) {
            next.push({
              name: DRUMS_STEM,
              pcm: await stemAtPackageRate(drums, sampleRate),
              origin: 'ai-separated',
            });
            probed.push({
              name: DRUMS_STEM,
              source: roformerDrums ? 'roformer' : 'demucs',
            });
          }
        }
        if (wantVocals) {
          // Best first: BS-Roformer's 44.1 kHz stereo vocals, then the
          // 44.1 kHz stereo vocals an on-demand Demucs run left, then the
          // lyrics tool's 16 kHz mono Demucs fallback under its own
          // separator key. All three were produced for this project's audio,
          // and any of them is a real track the mixer and the piano roll can
          // show.
          let source: StemSource = 'roformer';
          let vocalsOpus = await loadStemOpus(fingerprint, VOCALS_STEM);
          roformerHas.vocals = vocalsOpus != null;
          if (!vocalsOpus) {
            vocalsOpus = await loadStemOpus(
              demucsStereoFingerprint,
              VOCALS_STEM,
            );
            source = 'demucs';
          }
          demucsHas.vocals = roformerHas.vocals
            ? await hasStemOpus(demucsStereoFingerprint, VOCALS_STEM)
            : vocalsOpus != null;
          if (!vocalsOpus) {
            demucsFingerprintRef.current ??= await resolveDemucsStemFingerprint(
              await loadAssistAudio(),
            );
            vocalsOpus = await loadStemOpus(
              demucsFingerprintRef.current,
              VOCALS_STEM,
            );
          }
          if (vocalsOpus) {
            // Decoded straight at the package's rate: this is only ever
            // played and drawn, so the decoder's own resample is the whole
            // conversion.
            const decoded = await decodeAtRate(vocalsOpus, sampleRate);
            const pcm = interleaveAudioBuffer(decoded);
            rememberDecodedBuffer(pcm, decoded);
            next.push({name: VOCALS_STEM, pcm, origin: 'ai-separated'});
            probed.push({name: VOCALS_STEM, source});
          }
        }

        const roformerComplete = roformerHas.drums && roformerHas.vocals;
        setOffer({
          roformer: !roformerComplete,
          demucs: !roformerComplete && !(demucsHas.drums && demucsHas.vocals),
        });

        // Leave the live list alone when the re-probe found exactly what is
        // already playing: swapping in freshly-decoded copies of the same
        // stems would rebuild the AudioManager for nothing.
        if (sameStems(publishedRef.current, probed)) return;
        publishedRef.current = probed;
        setStems(next);
      } catch (err) {
        console.warn('Could not read separated stems for this project:', err);
      }
    },
    [packageAudio, loadAssistAudio, storedFingerprint, onFingerprintResolved],
  );

  // Probe once the project's own audio is decoded, resolving and persisting a
  // missing fingerprint. That catches cached stems regardless of which route
  // created the project. Every state write happens inside the async closure
  // (never synchronously in an effect body), so a throw can't block render.
  useEffect(() => {
    (async () => {
      await probe(true);
    })();
  }, [probe]);

  // Probe again the moment a run that can separate stems succeeds, which is
  // what puts a freshly separated stem on the mixer without a reload.
  // Subscribes to the run's IDENTITY only (task + status), never its steps,
  // so a run in flight doesn't re-render the host on progress ticks.
  const {store: assistStore} = useAssistRunnerContext();
  const assistActivity = useAssistRunActivity(assistStore);
  useEffect(() => {
    const outcome = `${assistActivity.task}:${assistActivity.status}`;
    if (outcome === lastAssistOutcomeRef.current) return;
    lastAssistOutcomeRef.current = outcome;
    if (assistActivity.status !== 'success') return;
    if (!SEPARATING_TASKS.has(assistActivity.task ?? '')) return;
    (async () => {
      await probe(true);
    })();
  }, [assistActivity, probe]);

  return {stems, offer};
}
