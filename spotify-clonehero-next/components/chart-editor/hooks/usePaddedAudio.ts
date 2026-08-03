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
 */

import {useEffect, useRef, useState} from 'react';
import {toast} from 'sonner';
import {AudioManager} from '@/lib/preview/audioManager';
import {getChartDelayMs} from '@/lib/chart-utils/chartDelay';
import {
  CLICK_TRACK_NAME,
  generateBeatClickTrackWav,
} from '@/lib/preview/clickTrack';
import {padPcmStart} from '@/lib/drum-transcription/audio/pad-pcm';
import {encodeWavBlob} from '@/lib/audio/wav-encoder';
import {getAudioAnchor} from '@/lib/chart-edit';
import type {ChartDocument} from '@/lib/chart-edit';
import {useAudioServiceContext} from '../AudioServiceContext';

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

/** Everything a build is determined by: how much leading silence to pad in,
 *  and which stems to carry. */
interface BuildTarget {
  padSamples: number;
  stems: ReadonlyArray<AudioStemInput>;
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

/**
 * Build a fresh AudioManager from ORIGINAL (unpadded) PCM buffers and a
 * pad-sample count. Pads the full mix and every stem identically, WAV-
 * encodes them (one WAV per stem, named `${stem.name}.wav`), and constructs
 * the manager.
 */
export async function buildPaddedAudioManager(
  padSamples: number,
  meta: PaddedAudioMeta,
  fullMixPcm: Float32Array,
  stems: ReadonlyArray<AudioStemInput>,
  chartDoc: ChartDocument,
  onSongEnded: () => void,
): Promise<{
  audioManager: AudioManager;
  paddedFullMixPcm: Float32Array;
  paddedStems: ReadonlyArray<AudioStem>;
}> {
  const paddedFullMixPcm = padPcmStart(fullMixPcm, padSamples, meta.channels);
  const fullMixWav = encodeWavBlob(
    paddedFullMixPcm,
    meta.sampleRate,
    meta.channels,
  );
  const fullMixArray = new Uint8Array(await fullMixWav.arrayBuffer());
  const audioFiles: {fileName: string; data: Uint8Array}[] = [
    {fileName: 'song.wav', data: fullMixArray},
  ];

  const paddedStems: AudioStem[] = [];
  for (const stem of stems) {
    const paddedPcm = padPcmStart(stem.pcm, padSamples, meta.channels);
    const stemWav = encodeWavBlob(paddedPcm, meta.sampleRate, meta.channels);
    const stemArray = new Uint8Array(await stemWav.arrayBuffer());
    audioFiles.push({fileName: `${stem.name}.wav`, data: stemArray});
    paddedStems.push({name: stem.name, pcm: paddedPcm, origin: stem.origin});
  }

  // Synthesized metronome click, registered as its own "click" stem so it
  // gets the same playback-speed/seek sync as every other track. Volume is
  // silent (0) until the user raises it in the stem-volumes UI — the WAV
  // itself carries fixed relative loudness for accented vs. unaccented
  // beats; real-time loudness is controlled entirely via setVolume.
  const chartDelayMs = getChartDelayMs(chartDoc.parsedChart.metadata);
  const durationMs =
    (paddedFullMixPcm.length / meta.channels / meta.sampleRate) * 1000;
  const clickWav = await generateBeatClickTrackWav(
    chartDoc.parsedChart,
    durationMs,
    chartDelayMs,
  );
  audioFiles.push({fileName: `${CLICK_TRACK_NAME}.wav`, data: clickWav});

  const audioManager = new AudioManager(audioFiles, onSongEnded);
  await audioManager.ready;
  audioManager.setChartDelay(chartDelayMs / 1000);
  audioManager.setVolume(CLICK_TRACK_NAME, 0);

  return {audioManager, paddedFullMixPcm, paddedStems};
}

export interface UsePaddedAudioParams {
  /** Chart doc driving both chart-delay and `audioAnchor`. Null until the
   *  host page has loaded/parsed the chart. */
  chartDoc: ChartDocument | null;
  audioMeta: PaddedAudioMeta | null;
  /** ORIGINAL (unpadded) full-mix PCM. Null until loaded. */
  fullMixPcm: Float32Array | null;
  /** ORIGINAL (unpadded) named stems (e.g. an isolated drum stem, an
   *  AI-separated vocal stem). Empty (or omitted) for pages with a single
   *  audio source, e.g. /tempo. Changing the list (add/remove/swap a stem)
   *  triggers a rebuild, same as an `audioAnchor` change; the hook is the
   *  single authority on what stems the live `audioManager` actually
   *  carries. */
  stems?: ReadonlyArray<AudioStemInput>;
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
  stems = [],
  onSongEnded,
}: UsePaddedAudioParams): UsePaddedAudioResult {
  const {audioManagerRef, setAudioManager: publishAudioManager} =
    useAudioServiceContext();
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
  // build starts. A build takes seconds (WAV encode + click-track render)
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

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!chartDoc || !audioMeta || !fullMixPcm) return;

    const anchor = getAudioAnchor(chartDoc);
    const nextPadSamples = anchorPadSamples(anchor, audioMeta.sampleRate);
    const target = inFlightRef.current ?? builtRef.current;
    if (
      target &&
      target.padSamples === nextPadSamples &&
      stemsEqual(target.stems, stems)
    ) {
      return;
    }

    const token = ++rebuildTokenRef.current;
    const isFirstBuild = builtRef.current === null;
    inFlightRef.current = {padSamples: nextPadSamples, stems};

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
          audioMeta,
          fullMixPcm,
          stems,
          chartDoc,
          onSongEnded,
        );

        if (!mountedRef.current || token !== rebuildTokenRef.current) {
          built.audioManager.destroy();
          return;
        }

        for (const trackName of built.audioManager.trackNames) {
          const carried = carriedVolumes.get(trackName);
          if (carried != null) built.audioManager.setVolume(trackName, carried);
        }

        publishAudioManager(built.audioManager);
        setAudioManager(built.audioManager);
        setPaddedFullMixPcm(built.paddedFullMixPcm);
        setPaddedStems(built.paddedStems);
        setDurationSeconds(built.audioManager.duration);
        builtRef.current = {padSamples: nextPadSamples, stems};
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
    stems,
    onSongEnded,
    audioManagerRef,
    publishAudioManager,
  ]);

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
