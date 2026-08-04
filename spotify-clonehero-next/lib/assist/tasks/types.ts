/**
 * Shared assist-engine contracts (plan 0074 Design A).
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
 * A task is parameterised on its own `Input`, so the data a run needs is
 * named by the task that needs it rather than pooled in one payload every
 * task shares. Callers start a run by handing the runner the task itself,
 * so each call site's input AND result type come from the task it named,
 * and a missing field is a compile error rather than a runtime throw.
 *
 * The tasks themselves live one per file beside this one:
 * `transcribe-drums`, `add-lyrics`, `generate-tempo-map`,
 * `generate-sections`, `generate-difficulties`. `add-leading-silence` lands
 * in a later phase.
 */

import {
  computeStemFingerprint,
  ROFORMER_SEPARATOR_ID,
} from '@/lib/audio-pipeline/stem-cache';
import type {PlannedStep, StepProgressEvent} from '../run-to-steps';

export type AssistTaskKey =
  | 'transcribe-drums'
  | 'generate-tempo-map'
  | 'generate-sections'
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
  /**
   * The whole song as one decoded buffer, at whatever rate the host's decode
   * produced. Supplied by hosts that have already decoded the audio, and by
   * hosts whose audio is several stem files rather than a single mixdown (a
   * chart package), where decoding the bytes alone would analyze only the
   * first stem. Omitted, a task that needs samples decodes
   * {@link loadOriginalBytes} itself. Lazy for the same reason as the bytes:
   * a task that never needs samples never pays the decode.
   */
  loadDecodedMix?: (() => Promise<AudioBuffer>) | undefined;
}

/**
 * How a host page hands the assist engine its song audio. Returning the
 * lazy {@link AssistAudio} rather than bytes is what lets a task that
 * resolves its work from the stem cache (`add-lyrics` on a cache hit) skip
 * reading the audio entirely, while a task that always needs the samples
 * (`generate-tempo-map`) just calls `loadOriginalBytes` itself.
 */
export type LoadAssistAudio = () => Promise<AssistAudio>;

export type AssistProgressSink = (event: StepProgressEvent) => void;

export interface AssistTaskDef<Result, Input> {
  key: AssistTaskKey;
  title: string;
  /** Predicts the step list for this run (may consult existence probes /
   *  project state). Purely presentational; recomputed at start. */
  planSteps(input: Input): Promise<PlannedStep[]>;
  /** One implementation call. Receives a progress sink and the signal. */
  run(
    input: Input,
    signal: AbortSignal,
    progress: AssistProgressSink,
  ): Promise<Result>;
}

/**
 * The fingerprint this audio's stems are cached under: the host's
 * authoritative value when it has one, else a hash of the bytes. `bytes`
 * lets a caller that has already read them avoid a second read.
 */
export async function resolveStemFingerprint(
  audio: AssistAudio,
  bytes?: Uint8Array,
): Promise<string> {
  if (audio.stemFingerprint) return audio.stemFingerprint;
  return computeStemFingerprint(
    bytes ?? (await audio.loadOriginalBytes()),
    ROFORMER_SEPARATOR_ID,
  );
}
