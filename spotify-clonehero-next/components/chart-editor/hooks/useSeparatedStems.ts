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
 */

import {useCallback, useEffect, useRef, useState} from 'react';

import {
  loadStem,
  loadStemOpus,
  STEM_CACHE_SAMPLE_RATE,
} from '@/lib/audio-pipeline/stem-cache';
import type {StereoStem} from '@/lib/audio-pipeline/stem-cache';
import {DRUMS_STEM, VOCALS_STEM} from '@/lib/audio-pipeline/separate-stems';
import {resampleStereoInWorker} from '@/lib/audio-pipeline/pcm-client';
import {
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

/** Two stem lists carry the same stems, by name. Used to leave the live list
 *  alone when a re-probe found exactly what is already playing — swapping in
 *  freshly-decoded copies of the same stems would rebuild the AudioManager
 *  for nothing. */
function sameStemNames(
  a: ReadonlyArray<AudioStemInput>,
  b: ReadonlyArray<AudioStemInput>,
): boolean {
  return a.length === b.length && a.every((stem, i) => stem.name === b[i].name);
}

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

export function useSeparatedStems({
  projectId,
  packageAudio,
  loadAssistAudio,
  storedFingerprint,
  onFingerprintResolved,
}: UseSeparatedStemsParams): ReadonlyArray<AudioStemInput> {
  const [stems, setStems] = useState<ReadonlyArray<AudioStemInput>>([]);
  // The fingerprint in hand: the persisted one, or one computed after a
  // separating run. Cleared on a project switch (the effect below).
  const fingerprintRef = useRef<string | null>(null);
  // The Demucs vocals key, hashed at most once per project. It is never the
  // persisted fingerprint (that one is BS-Roformer's) and is only paid for
  // when the roformer vocals probe misses.
  const demucsFingerprintRef = useRef<string | null>(null);
  // Identity of the last assist run this hook reacted to, so one run's
  // success triggers exactly one probe.
  const lastAssistOutcomeRef = useRef('');

  useEffect(() => {
    return () => {
      fingerprintRef.current = null;
      demucsFingerprintRef.current = null;
      lastAssistOutcomeRef.current = '';
      setStems([]);
    };
  }, [projectId]);

  /**
   * Reads back whatever the cache holds for this project and publishes it.
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
      // up.
      const wantDrums = !packageHasDrumsAudio(pkg);
      const wantVocals = !pkg.stems.some(stem => stem.name === VOCALS_STEM);
      if (!wantDrums && !wantVocals) return;

      try {
        let fingerprint = fingerprintRef.current ?? storedFingerprint ?? null;
        if (!fingerprint) {
          if (!mayComputeFingerprint) return;
          fingerprint = await resolveStemFingerprint(await loadAssistAudio());
          onFingerprintResolved(fingerprint);
        }
        fingerprintRef.current = fingerprint;

        const {sampleRate} = pkg.meta;
        const next: AudioStemInput[] = [];
        if (wantDrums) {
          const drums = await loadStem(fingerprint, DRUMS_STEM);
          if (drums) {
            next.push({
              name: DRUMS_STEM,
              pcm: await stemAtPackageRate(drums, sampleRate),
              origin: 'ai-separated',
            });
          }
        }
        if (wantVocals) {
          // BS-Roformer's 44.1 kHz stereo vocals first; the lyrics tool's
          // 16 kHz mono Demucs fallback, under its own separator key, only
          // when a separation run never left the better stem behind. Both
          // were produced for this project's audio, and either is a real
          // track the mixer and the piano roll can show.
          let vocalsOpus = await loadStemOpus(fingerprint, VOCALS_STEM);
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
          }
        }
        setStems(prev => (sameStemNames(prev, next) ? prev : next));
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

  return stems;
}
