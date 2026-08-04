'use client';

/**
 * The stems an assist run separated out of a project's audio, read back from
 * the fingerprint-keyed stem cache and handed to `usePaddedAudio` so they
 * appear on the Stems mixer with their AI-separated badge (plan 0076 item
 * 18).
 *
 * The cache is the authority on what was actually separated — a
 * `generate-tempo-map` run's drum isolation writes the drum stem there from
 * inside the pipeline worker, and an `add-lyrics` run that resolved against
 * BS-Roformer vocals finds them there — so this probes the cache rather than
 * trying to catch each task's own result shape. It probes on mount (so stems
 * separated in an earlier session are on the mixer from the start) and again
 * the moment a run that can separate succeeds.
 *
 * Cost discipline: the cache key is a hash of the project's audio bytes, and
 * a multi-file package has to be MIXED DOWN to produce those bytes at all.
 * So the key is treated as project state, persisted by the host the first
 * time it is computed: a project that carries one is probed with a direct
 * cache read, and a project that carries none has never had anything
 * separated, so it is not probed at all. The hash is paid exactly once, right
 * after a separating run — which just spent minutes on inference.
 */

import {useCallback, useEffect, useRef, useState} from 'react';

import {loadStem, loadStemOpus} from '@/lib/audio-pipeline/stem-cache';
import type {StereoStem} from '@/lib/audio-pipeline/stem-cache';
import {DRUMS_STEM, VOCALS_STEM} from '@/lib/audio-pipeline/separate-stems';
import {resolveStemFingerprint} from '@/lib/assist/tasks/types';
import type {LoadAssistAudio} from '@/lib/assist/tasks/types';
import {
  decodeAudio,
  interleaveAudioBuffer,
} from '@/lib/drum-transcription/audio/decoder';
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
  // Identity of the last assist run this hook reacted to, so one run's
  // success triggers exactly one probe.
  const lastAssistOutcomeRef = useRef('');

  useEffect(() => {
    return () => {
      fingerprintRef.current = null;
      lastAssistOutcomeRef.current = '';
      setStems([]);
    };
  }, [projectId]);

  /**
   * Reads back whatever the cache holds for this project and publishes it.
   * `mayComputeFingerprint` is what separates the two callers: the mount
   * probe only reads a fingerprint the project already carries, while the
   * post-run probe may pay to compute one.
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

        const next: AudioStemInput[] = [];
        if (wantDrums) {
          const drums = await loadStem(fingerprint, DRUMS_STEM);
          if (drums) {
            next.push({
              name: DRUMS_STEM,
              pcm: interleaveStereoStem(drums),
              origin: 'ai-separated',
            });
          }
        }
        if (wantVocals) {
          const vocalsOpus = await loadStemOpus(fingerprint, VOCALS_STEM);
          if (vocalsOpus) {
            const decoded = await decodeAudio(
              vocalsOpus.buffer.slice(
                vocalsOpus.byteOffset,
                vocalsOpus.byteOffset + vocalsOpus.byteLength,
              ) as ArrayBuffer,
            );
            next.push({
              name: VOCALS_STEM,
              pcm: interleaveAudioBuffer(decoded),
              origin: 'ai-separated',
            });
          }
        }
        setStems(prev => (sameStemNames(prev, next) ? prev : next));
      } catch (err) {
        console.warn('Could not read separated stems for this project:', err);
      }
    },
    [packageAudio, loadAssistAudio, storedFingerprint, onFingerprintResolved],
  );

  // Probe once the project's own audio is decoded, so stems separated in an
  // earlier session are on the mixer from the start. Every state write
  // happens inside the async closure (never synchronously in an effect
  // body), so a throw can't block the host's render.
  useEffect(() => {
    (async () => {
      await probe(false);
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
