'use client';

/**
 * Padded-AudioManager lifecycle (0064 addendum §5), shared by every
 * chart-editor host page. Builds an AudioManager from ORIGINAL (unpadded)
 * PCM — a full mix, plus zero or more named stems (e.g. an isolated drum
 * stem, an AI-separated vocal stem) — padded to match the chart doc's
 * `audioAnchor`, and rebuilds it whenever that anchor changes at runtime
 * (the leading-silence button's apply, its undo/redo, a grid-glue tempo
 * edit near the start) or whenever the stem list itself changes (a stem
 * added/removed/swapped, e.g. the mixer's drop-to-add). The stored audio at
 * rest is never touched — padding happens on a decoded copy here.
 *
 * Retains the ORIGINAL (unpadded) PCM by reference, not the padded copies,
 * so repeated anchor/stem-list changes always re-pad from source rather
 * than compounding padding on top of a previously-padded buffer.
 *
 * The padded samples go into `AudioManager` as PCM, not as WAV files: it
 * builds its `AudioBuffer`s from them directly, so nothing on this path
 * encodes a container or decodes one back.
 *
 * The padding itself runs in `pad-tracks-worker.ts`. It is memory traffic
 * over the whole song, per track, and an anchor change is something a user
 * does from a button, so it may not land on the main thread. A surface that
 * is ABOUT to move the anchor can pay for it in advance, under its own
 * progress UI, via {@link PadAudioAhead}. A zero anchor — every load of a
 * chart that has no leading silence — pads nothing and skips the worker
 * entirely.
 */

import {useCallback, useEffect, useRef, useState} from 'react';
import {toast} from 'sonner';
import {AudioManager, type AudioSource} from '@/lib/preview/audioManager';
import {getChartDelayMs} from '@/lib/chart-utils/chartDelay';
import {
  CLICK_TRACK_NAME,
  clickTrackSignature,
  generateBeatClickTrackSamples,
} from '@/lib/preview/clickTrack';
import {padTracksInWorker} from '@/lib/audio/pad-tracks-client';
import type {PaddedTrack} from '@/lib/audio/pad-tracks';
import {forgetDecodedBuffer} from '@/lib/preview/decodedPcm';
import {getAudioAnchor} from '@/lib/chart-edit';
import type {ChartDocument} from '@/lib/chart-edit';
import {useAudioServiceContext} from '../AudioServiceContext';
import type {PadAudioAhead} from '../AudioServiceContext';
import {defaultMuteFor, defaultVolumeFor} from '../sidebar/mixerBus';

export interface PaddedAudioMeta {
  sampleRate: number;
  channels: number;
}

/**
 * Where a stem's audio came from — drives the StemsMixer's badge:
 *  - `'chart-file'`: one of the chart package's own audio files.
 *  - `'ai-separated'`: produced by stem separation (Demucs/roformer).
 *  - `'user-added'`: dropped onto the mixer's drop-zone row at runtime
 *    (plan 0074 Phase 5) — neither of the above, since nothing separated it
 *    and it isn't part of the chart package.
 */
export type AudioStemOrigin = 'chart-file' | 'ai-separated' | 'user-added';

/** A named stem's ORIGINAL (unpadded) PCM, as supplied by the host page. */
export interface AudioStemInput {
  name: string;
  pcm: Float32Array;
  origin: AudioStemOrigin;
}

/** A named stem's PADDED PCM, matching the live `audioManager`. */
export interface AudioStem {
  name: string;
  pcm: Float32Array;
  origin: AudioStemOrigin;
}

/** Everything a build is determined by. Every field has to be here: a
 *  project that gains its first audio file changes only `fullMixPcm`, and a
 *  `song_length` rewrite changes only `silentDurationSeconds`, so leaving
 *  either out would silently skip the rebuild those need. */
interface BuildTarget {
  padSamples: number;
  stems: ReadonlyArray<AudioStemInput>;
  /** Compared by reference, like stem PCM. */
  fullMixPcm: Float32Array | null;
  fullMixName: string;
  silentDurationSeconds: number | undefined;
}

/** What `padAudioAhead` padded, and what it padded FROM — a build may only
 *  use it when it is building exactly that. */
interface PrebuiltPad {
  padSamples: number;
  fullMixPcm: Float32Array | null;
  fullMixName: string;
  stems: ReadonlyArray<AudioStemInput>;
  padded: PaddedTrack[];
}

/** The click stem a live `AudioManager` is carrying. */
interface LiveClickTrack {
  manager: AudioManager;
  /** {@link clickTrackSignature} of the map it was rendered from. */
  signature: string;
  /** Span it was rendered over, which a tempo edit doesn't change — the
   *  audio is still the same length — so a regeneration reuses it. */
  durationMs: number;
}

/** The build inputs `padAudioAhead` reads at call time. */
interface PadAheadInputs {
  audioMeta: PaddedAudioMeta | null;
  fullMixPcm: Float32Array | null;
  fullMixName: string;
  stems: ReadonlyArray<AudioStemInput>;
}

/** Sample rate a silent (no-audio) project's click track is rendered at. */
export const SILENT_PROJECT_SAMPLE_RATE = 44100;

const SILENT_PROJECT_META: PaddedAudioMeta = {
  sampleRate: SILENT_PROJECT_SAMPLE_RATE,
  channels: 2,
};

function targetsEqual(a: BuildTarget, b: BuildTarget): boolean {
  return (
    a.padSamples === b.padSamples &&
    a.fullMixPcm === b.fullMixPcm &&
    a.fullMixName === b.fullMixName &&
    a.silentDurationSeconds === b.silentDurationSeconds &&
    stemsEqual(a.stems, b.stems)
  );
}

/** The padded PCM of the stem named `name`, or null when the manager doesn't
 *  carry it (e.g. a project with no separated drum stem yet). */
export function stemPcm(
  stems: ReadonlyArray<AudioStem>,
  name: string,
): Float32Array | null {
  return stems.find(stem => stem.name === name)?.pcm ?? null;
}

/** Sample-quantized pad amount for `anchor`, or 0 when there is none. */
export function anchorPadSamples(
  anchor: {ms: number} | null,
  sampleRate: number,
): number {
  if (!anchor || anchor.ms <= 0) return 0;
  return Math.round((anchor.ms * sampleRate) / 1000);
}

/**
 * True when two stem lists are equivalent for rebuild purposes: same
 * length, same names/origins in the same order, and each entry's PCM is the
 * same buffer by reference. Content-based (not array-identity) so a host
 * page passing a freshly-literal array every render — same names, same
 * underlying PCM buffers — doesn't trigger a rebuild.
 */
function stemsEqual(
  a: ReadonlyArray<AudioStemInput>,
  b: ReadonlyArray<AudioStemInput>,
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (
      a[i].name !== b[i].name ||
      a[i].origin !== b[i].origin ||
      a[i].pcm !== b[i].pcm
    ) {
      return false;
    }
  }
  return true;
}

/** The tracks a build pads, in the order the results come back: the full mix
 *  first (when there is one), then the stems as given. */
function tracksToPad(
  fullMixPcm: Float32Array | null,
  fullMixName: string,
  stems: ReadonlyArray<AudioStemInput>,
) {
  const tracks = stems.map(stem => ({name: stem.name, pcm: stem.pcm}));
  if (fullMixPcm) tracks.unshift({name: fullMixName, pcm: fullMixPcm});
  return tracks;
}

/** Extra inputs a build can take beyond the audio itself. */
export interface BuildPaddedAudioOptions {
  /** Already-padded tracks for this exact build, from a
   *  {@link PadAudioAhead} run. Used verbatim when supplied, so the padding
   *  is not repeated; the caller is responsible for only passing results
   *  that match the pad amount and source PCM being built from. */
  prebuilt?: ReadonlyArray<PaddedTrack> | undefined;
  /** Forwarded to the pad worker client (tests inject a fake). */
  createWorker?: (() => Worker) | null | undefined;
  /**
   * The click is all this project will ever have to play, so it starts
   * audible rather than silent ({@link defaultVolumeFor}). Defaults to
   * "there is no full mix", which is right for a chart with no audio; a host
   * whose audio is merely still loading passes `false`, or the metronome
   * would come up loud and — carried across the rebuild that installs the
   * song — stay that way.
   */
  silentProject?: boolean | undefined;
}

/**
 * Build a fresh AudioManager from ORIGINAL (unpadded) PCM buffers and a
 * pad-sample count. Pads the full mix and every stem identically in a worker,
 * then constructs the manager from those samples directly — each track's
 * `AudioBuffer` is filled from its PCM, so no WAV is written and none is
 * decoded back.
 *
 * A zero pad short-circuits the worker: `padPcmStart` would return the source
 * buffers unchanged, so the build uses them by reference and the round trip
 * (a copy in, a copy out) is skipped. That is every load of a chart with no
 * leading silence.
 *
 * `fullMixName` is the mixer/track name the full mix registers under. It
 * defaults to `song`, but a package with no `song` file promotes one of its
 * own files (e.g. `guitar`) to the full-mix slot, and that row has to carry
 * the name of the audio it is actually playing.
 *
 * `fullMixPcm` is null on a project with no audio yet. The manager is then
 * the click track alone, spanning `silentDurationSeconds`, so the transport,
 * seeking and the beat grid all work against the chart's own length.
 */
export async function buildPaddedAudioManager(
  padSamples: number,
  meta: PaddedAudioMeta,
  fullMixPcm: Float32Array | null,
  stems: ReadonlyArray<AudioStemInput>,
  chartDoc: ChartDocument,
  onSongEnded: () => void,
  fullMixName = 'song',
  silentDurationSeconds = 0,
  {prebuilt, createWorker, silentProject}: BuildPaddedAudioOptions = {},
): Promise<{
  audioManager: AudioManager;
  paddedFullMixPcm: Float32Array | null;
  paddedStems: ReadonlyArray<AudioStem>;
  /** Identity of the tempo map / length / delay the click stem inside this
   *  manager was rendered from, so a caller can tell when it has gone
   *  stale. See {@link clickTrackSignature}. */
  clickSignature: string;
  /** Span the click stem covers. A caller re-rendering the click for a new
   *  tempo map must reuse this exactly: derive it again from the built
   *  manager's duration and the signature would never settle. */
  clickDurationMs: number;
}> {
  const sources = tracksToPad(fullMixPcm, fullMixName, stems);
  const padded =
    prebuilt ??
    (padSamples <= 0
      ? sources.map(track => ({name: track.name, paddedPcm: track.pcm}))
      : await padTracksInWorker(sources, {
          padSamples,
          channels: meta.channels,
          createWorker,
        }));

  // Padding produced fresh buffers, so the `AudioBuffer`s the host's ORIGINAL
  // samples were decoded into are not what plays any more. Releasing them
  // hands back a second full copy of the song (a gigabyte on an album-length
  // chart) that would otherwise stay reachable for the rest of the session,
  // just in case the anchor ever returns to zero. It costs that one rebuild
  // a de-interleave.
  if (padded.some((track, index) => track.paddedPcm !== sources[index]?.pcm)) {
    for (const track of sources) forgetDecodedBuffer(track.pcm);
  }

  const audioFiles: AudioSource[] = [];
  for (const track of padded) {
    audioFiles.push({
      fileName: `${track.name}.wav`,
      pcm: {
        samples: track.paddedPcm,
        sampleRate: meta.sampleRate,
        channels: meta.channels,
      },
    });
  }

  // The full mix leads `padded` when there is one, so the stems line up
  // with the tail of the list, in order.
  const stemsOffset = fullMixPcm ? 1 : 0;
  const paddedFullMixPcm = fullMixPcm ? padded[0].paddedPcm : null;
  const paddedStems: AudioStem[] = stems.map((stem, index) => ({
    name: stem.name,
    pcm: padded[stemsOffset + index].paddedPcm,
    origin: stem.origin,
  }));

  // Synthesized metronome click, registered as its own "click" stem so it
  // gets the same playback-speed/seek sync as every other track. Volume is
  // silent (0) until the user raises it in the stem-volumes UI — the samples
  // themselves carry fixed relative loudness for accented vs. unaccented
  // beats; real-time loudness is controlled entirely via setVolume.
  const chartDelayMs = getChartDelayMs(chartDoc.parsedChart.metadata);
  const durationMs = paddedFullMixPcm
    ? (paddedFullMixPcm.length / meta.channels / meta.sampleRate) * 1000
    : silentDurationSeconds * 1000;
  const clickPcm = await generateBeatClickTrackSamples(
    chartDoc.parsedChart,
    durationMs,
    chartDelayMs,
  );
  audioFiles.push({fileName: `${CLICK_TRACK_NAME}.wav`, pcm: clickPcm});

  const audioManager = new AudioManager(audioFiles, onSongEnded);
  await audioManager.ready;
  audioManager.setChartDelay(chartDelayMs / 1000);
  audioManager.setVolume(
    CLICK_TRACK_NAME,
    defaultVolumeFor(CLICK_TRACK_NAME, {
      silentProject: silentProject ?? !paddedFullMixPcm,
    }) / 100,
  );
  // A stem that arrives muted on the mixer has to be silent from the first
  // sample, not from the mixer's first commit: the manager may resume
  // playback before that render lands, and a separated stem doubling the
  // full mix for a beat is exactly what muting it is meant to prevent.
  for (const stem of stems) {
    if (defaultMuteFor(stem.origin)) audioManager.setVolume(stem.name, 0);
  }

  return {
    audioManager,
    paddedFullMixPcm,
    paddedStems,
    clickSignature: clickTrackSignature(
      chartDoc.parsedChart,
      durationMs,
      chartDelayMs,
    ),
    clickDurationMs: durationMs,
  };
}

export interface UsePaddedAudioParams {
  /** Chart doc driving both chart-delay and `audioAnchor`. Null until the
   *  host page has loaded/parsed the chart. */
  chartDoc: ChartDocument | null;
  audioMeta: PaddedAudioMeta | null;
  /** ORIGINAL (unpadded) full-mix PCM. Null until loaded. */
  fullMixPcm: Float32Array | null;
  /** Track name for the full mix. Defaults to `song`; a package with no
   *  `song` file passes the name of the file it promoted instead. */
  fullMixName?: string;
  /** ORIGINAL (unpadded) named stems (e.g. an isolated drum stem, an
   *  AI-separated vocal stem). Empty (or omitted) for pages with a single
   *  audio source, e.g. /tempo. Changing the list (add/remove/swap a stem)
   *  triggers a rebuild, same as an `audioAnchor` change; the hook is the
   *  single authority on what stems the live `audioManager` actually
   *  carries. */
  stems?: ReadonlyArray<AudioStemInput>;
  /**
   * Build a click-only AudioManager spanning this many seconds when there is
   * no decoded audio. Mutually exclusive with `fullMixPcm`: whenever a full
   * mix is present it decides the length instead.
   */
  silentDurationSeconds?: number | undefined;
  /**
   * This project has no audio of its own, as opposed to having some that
   * hasn't finished decoding. Decides only whether the click comes up
   * audible — see {@link BuildPaddedAudioOptions.silentProject}. Defaults to
   * "there is no full mix".
   */
  silentProject?: boolean | undefined;
  onSongEnded: () => void;
}

export interface UsePaddedAudioResult {
  audioManager: AudioManager | null;
  /** Padded full-mix PCM, matching the live `audioManager`. */
  fullMixPcm: Float32Array | null;
  /** Padded stems, matching the live `audioManager` — the single source of
   *  truth for what stems (and origins) the manager currently carries.
   *  When the chart has a non-zero `audioAnchor`, each entry's `pcm` is a
   *  padded COPY, so a stem's samples are resident three times: the host's
   *  original, this padded copy, and the AudioManager's decoded
   *  AudioBuffer. At a zero anchor `padPcmStart` returns the original by
   *  reference and there is no extra copy. */
  stems: ReadonlyArray<AudioStem>;
  durationSeconds: number;
  /** True while the AudioManager is being rebuilt after the chart's
   *  `audioAnchor` changed (leading-silence apply/undo/redo, or a
   *  grid-glue tempo edit near the start) or the stem list changed. False
   *  during the initial build. */
  rebuilding: boolean;
}

export function usePaddedAudio({
  chartDoc,
  audioMeta,
  fullMixPcm,
  fullMixName = 'song',
  stems = [],
  silentDurationSeconds,
  silentProject,
  onSongEnded,
}: UsePaddedAudioParams): UsePaddedAudioResult {
  const {
    audioManagerRef,
    setAudioManager: publishAudioManager,
    setPadAudioAhead,
  } = useAudioServiceContext();
  const [audioManager, setAudioManager] = useState<AudioManager | null>(null);
  const [paddedFullMixPcm, setPaddedFullMixPcm] = useState<Float32Array | null>(
    null,
  );
  const [paddedStems, setPaddedStems] = useState<ReadonlyArray<AudioStem>>([]);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [rebuilding, setRebuilding] = useState(false);

  // What the CURRENT audioManager/PCM state was built from: its pad-sample
  // count and its stem list (ORIGINAL, unpadded). Stems are compared by
  // content (see stemsEqual) rather than array identity, so a
  // freshly-literal same-content array from the host doesn't trigger a
  // rebuild. null = never built yet (still the initial build).
  const builtRef = useRef<BuildTarget | null>(null);
  // What an IN-FLIGHT build is targeting, written synchronously when the
  // build starts. A build takes a second or more (worker pad/encode,
  // click-track render, decode)
  // and `chartDoc` changes on every chart edit, so without this an edit
  // mid-rebuild would re-enter, see the not-yet-updated `builtRef`, and
  // start a second full build of the same target.
  const inFlightRef = useRef<BuildTarget | null>(null);
  // Guards overlapping rebuilds (rapid undo/redo, or an anchor change
  // racing a stem-list change): only the newest token may publish.
  const rebuildTokenRef = useRef(0);
  // Whether this hook is still mounted. A build outlives many effect runs
  // (hosts pass a fresh `onSongEnded` closure every render, so the effect
  // re-runs constantly and short-circuits), so "should this build still
  // publish?" is decided by the token and this flag, never by an effect
  // cleanup — an unrelated re-run must not abandon an in-flight build.
  const mountedRef = useRef(true);
  // A pad+encode a Chart Assist run already paid for, off the main thread,
  // for the anchor change it is about to make (see `padAudioAhead` below).
  // Consumed by the first build whose target it matches, and dropped by the
  // first build it doesn't — either way exactly one build looks at it.
  const prebuiltRef = useRef<PrebuiltPad | null>(null);
  // The click stem currently inside the live manager: which manager it
  // belongs to, what tempo map it was rendered from, and how long it is.
  // The click-sync effect below compares the chart's current signature
  // against this to decide whether the metronome still describes the chart.
  const clickRef = useRef<LiveClickTrack | null>(null);
  // Only the newest click regeneration may install itself, so a burst of
  // tempo edits leaves the LAST map on the manager rather than whichever
  // render finished last.
  const clickTokenRef = useRef(0);
  // The latest build inputs, for the non-reactive `padAudioAhead` closure.
  // Written after every render so a run started now encodes from the audio
  // the hook would build from now.
  const inputsRef = useRef<PadAheadInputs>({
    audioMeta,
    fullMixPcm,
    fullMixName,
    stems,
  });
  useEffect(() => {
    inputsRef.current = {audioMeta, fullMixPcm, fullMixName, stems};
  });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /**
   * Pads the current audio for `padSamples` in a worker and holds the result
   * for the rebuild the caller is about to trigger. Never installs anything
   * itself: the AudioManager is only ever swapped by the build effect below,
   * when the chart's anchor actually moves.
   */
  const padAudioAhead = useCallback<PadAudioAhead>(
    async (anchorMs, {signal, onProgress}) => {
      const inputs = inputsRef.current;
      const meta = inputs.audioMeta;
      const tracks = tracksToPad(
        inputs.fullMixPcm,
        inputs.fullMixName,
        inputs.stems,
      );
      // A silent project has no audio format and nothing to pad; the click
      // track is regenerated by the build either way.
      if (!meta || tracks.length === 0) return;

      const padSamples = anchorPadSamples({ms: anchorMs}, meta.sampleRate);
      const padded = await padTracksInWorker(tracks, {
        padSamples,
        channels: meta.channels,
        signal,
        onProgress: p =>
          onProgress?.(p.completed / p.total, `${p.completed} of ${p.total}`),
      });
      prebuiltRef.current = {
        padSamples,
        fullMixPcm: inputs.fullMixPcm,
        fullMixName: inputs.fullMixName,
        stems: inputs.stems,
        padded,
      };
    },
    [],
  );

  useEffect(() => {
    setPadAudioAhead(padAudioAhead);
    return () => setPadAudioAhead(null);
  }, [padAudioAhead, setPadAudioAhead]);

  useEffect(() => {
    // The full mix is its PCM and the format that PCM is in, together: one
    // without the other is not something this hook can build from. A silent
    // project has neither — nothing has established its audio format yet —
    // so the click's own rate stands in.
    const fullMix =
      audioMeta && fullMixPcm ? {meta: audioMeta, pcm: fullMixPcm} : null;
    const isSilentProject = !fullMix && silentDurationSeconds != null;
    if (!chartDoc || (!fullMix && !isSilentProject)) return;

    const meta = fullMix?.meta ?? SILENT_PROJECT_META;
    const anchor = getAudioAnchor(chartDoc);
    const nextPadSamples = anchorPadSamples(anchor, meta.sampleRate);
    const nextTarget: BuildTarget = {
      padSamples: nextPadSamples,
      stems,
      fullMixPcm: fullMix?.pcm ?? null,
      fullMixName,
      silentDurationSeconds: isSilentProject
        ? silentDurationSeconds
        : undefined,
    };
    const target = inFlightRef.current ?? builtRef.current;
    if (target && targetsEqual(target, nextTarget)) return;

    const token = ++rebuildTokenRef.current;
    const isFirstBuild = builtRef.current === null;
    inFlightRef.current = nextTarget;

    // Claim any pre-padded audio, but only when it was made for exactly
    // this build. A run whose plan changed under it (a tempo edit while the
    // padding was in flight) leaves a result for a pad amount this build no
    // longer wants, and the honest response is to pad again rather than
    // install audio that doesn't match the chart. Cleared either way, so a
    // stale result never reaches a later build and never keeps a second copy
    // of the song's samples alive.
    const claimed = prebuiltRef.current;
    prebuiltRef.current = null;
    const prebuilt =
      claimed &&
      claimed.padSamples === nextPadSamples &&
      claimed.fullMixPcm === nextTarget.fullMixPcm &&
      claimed.fullMixName === fullMixName &&
      stemsEqual(claimed.stems, stems)
        ? claimed.padded
        : undefined;

    (async () => {
      if (!isFirstBuild) setRebuilding(true);
      try {
        const oldManager = audioManagerRef.current;
        const wasPlaying = oldManager?.isPlaying ?? false;
        const chartTimePos = oldManager?.chartTime ?? 0;
        // Mixer state (volume/mute/solo) lives in the UI as resolved
        // per-track volumes on the manager, so carry those across the swap
        // and apply them BEFORE resuming: otherwise a muted or
        // solo-silenced track plays a full-volume blip on the new manager
        // until the mixer's next commit re-applies it.
        const carriedVolumes = new Map<string, number>();
        for (const trackName of oldManager?.trackNames ?? []) {
          const volume = oldManager?.getVolume(trackName);
          if (volume != null) carriedVolumes.set(trackName, volume);
        }
        if (oldManager) await oldManager.pause();

        const built = await buildPaddedAudioManager(
          nextPadSamples,
          meta,
          nextTarget.fullMixPcm,
          stems,
          chartDoc,
          onSongEnded,
          fullMixName,
          silentDurationSeconds ?? 0,
          {prebuilt, silentProject},
        );

        if (!mountedRef.current || token !== rebuildTokenRef.current) {
          built.audioManager.destroy();
          return;
        }

        for (const trackName of built.audioManager.trackNames) {
          const carried = carriedVolumes.get(trackName);
          if (carried != null) built.audioManager.setVolume(trackName, carried);
        }

        clickRef.current = {
          manager: built.audioManager,
          signature: built.clickSignature,
          durationMs: built.clickDurationMs,
        };
        publishAudioManager(built.audioManager);
        setAudioManager(built.audioManager);
        setPaddedFullMixPcm(built.paddedFullMixPcm);
        setPaddedStems(built.paddedStems);
        setDurationSeconds(built.audioManager.duration);
        builtRef.current = nextTarget;
        inFlightRef.current = null;

        if (!isFirstBuild) {
          await built.audioManager.seekToChartTime(chartTimePos);
          if (wasPlaying) await built.audioManager.resume();
        }

        oldManager?.destroy();
      } catch (err) {
        if (token === rebuildTokenRef.current) inFlightRef.current = null;
        console.error('Failed to build/rebuild padded audio:', err);
        toast.error('Failed to update audio for playback');
      } finally {
        // Only the newest build owns the flag: a superseded one clearing it
        // would report "idle" while the live rebuild is still running.
        if (mountedRef.current && token === rebuildTokenRef.current) {
          setRebuilding(false);
        }
      }
    })();
    // `onSongEnded` and `stems` ARE listed — an identity/value change alone
    // reruns this effect, but the padSamples/stemsEqual check above
    // short-circuits it into a no-op unless the anchor or the stem list's
    // actual content changed, so this never causes an extra rebuild.
  }, [
    chartDoc,
    audioMeta,
    fullMixPcm,
    fullMixName,
    stems,
    silentDurationSeconds,
    silentProject,
    onSongEnded,
    audioManagerRef,
    publishAudioManager,
  ]);

  // -------------------------------------------------------------------
  // Click track ↔ tempo map
  // -------------------------------------------------------------------
  // The click is how a user hears a tempo map, so it follows every committed
  // tempo edit rather than waiting for the next full rebuild. Each edit is a
  // discrete command, so this fires at known moments, not continuously.
  //
  // It re-renders the click stem ALONE and swaps that one track
  // (`replaceTrack`), never the manager: a manager swap re-decodes every
  // stem of the song and stalls the editor, which would make tempo editing
  // unusable. Rendering an 8 kHz mono click over a four-minute song is a few
  // milliseconds of arithmetic: the samples go to `replaceTrack` as PCM, so
  // there is no WAV encode and no decode. It also cannot move: the click's
  // two oscillator samples come from an `OfflineAudioContext`, which a worker
  // doesn't have (and which is cached, so it runs once per session).
  //
  // Playback is not interrupted and the playhead does not move: the
  // replaced track restarts at the current position while everything else
  // keeps playing, so the next click the user hears is already on the new
  // map.
  useEffect(() => {
    const live = clickRef.current;
    if (!chartDoc || !audioManager || live?.manager !== audioManager) return;

    const chartDelayMs = getChartDelayMs(chartDoc.parsedChart.metadata);
    const signature = clickTrackSignature(
      chartDoc.parsedChart,
      live.durationMs,
      chartDelayMs,
    );
    if (signature === live.signature) return;
    clickRef.current = {...live, signature};

    const token = ++clickTokenRef.current;
    (async () => {
      try {
        const pcm = await generateBeatClickTrackSamples(
          chartDoc.parsedChart,
          live.durationMs,
          chartDelayMs,
        );
        if (token !== clickTokenRef.current || !mountedRef.current) return;
        if (clickRef.current?.manager !== audioManager) return;
        audioManager.setChartDelay(chartDelayMs / 1000);
        await audioManager.replaceTrack(CLICK_TRACK_NAME, pcm);
      } catch (err) {
        // The click is a charting aid: a failed re-render leaves the
        // previous one playing rather than taking the editor down.
        console.warn(
          'Could not update the click track for this tempo map:',
          err,
        );
      }
    })();
  }, [chartDoc, audioManager]);

  // Tear down the current AudioManager on unmount. Intentionally reads the
  // live ref at cleanup time (not a snapshot from mount) so it destroys
  // whatever AudioManager is current, even after later rebuilds.
  useEffect(() => {
    return () => {
      audioManagerRef.current?.destroy();
      publishAudioManager(null);
    };
  }, [audioManagerRef, publishAudioManager]);

  return {
    audioManager,
    fullMixPcm: paddedFullMixPcm,
    stems: paddedStems,
    durationSeconds,
    rebuilding,
  };
}
