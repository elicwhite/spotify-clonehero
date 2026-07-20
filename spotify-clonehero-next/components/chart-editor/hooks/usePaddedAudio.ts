'use client';

/**
 * Padded-AudioManager lifecycle (0064 addendum §5), shared by every chart-
 * editor host page. Builds an AudioManager from ORIGINAL (unpadded) PCM —
 * a full mix, optionally plus a secondary stem (e.g. isolated drums) —
 * padded to match the chart doc's `audioAnchor`, and rebuilds it whenever
 * that anchor changes at runtime: the leading-silence button's apply, its
 * undo/redo, or a grid-glue tempo edit near the start. The stored audio at
 * rest is never touched — padding happens on a decoded copy here.
 *
 * Retains the ORIGINAL (unpadded) PCM by reference, not the padded copies,
 * so repeated anchor changes always re-pad from source rather than
 * compounding padding on top of a previously-padded buffer.
 */

import {useEffect, useRef, useState} from 'react';
import {toast} from 'sonner';
import {AudioManager} from '@/lib/preview/audioManager';
import {getChartDelayMs} from '@/lib/chart-utils/chartDelay';
import {padPcmStart} from '@/lib/drum-transcription/audio/pad-pcm';
import {encodeWavBlob} from '@/lib/audio/wav-encoder';
import {getAudioAnchor} from '@/lib/chart-edit';
import type {ChartDocument} from '@/lib/chart-edit';
import {useAudioServiceContext} from '../AudioServiceContext';

export interface PaddedAudioMeta {
  sampleRate: number;
  channels: number;
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
 * Build a fresh AudioManager from ORIGINAL (unpadded) PCM buffers and a
 * pad-sample count. Pads the full mix and an optional secondary stem,
 * WAV-encodes them, and constructs the manager.
 */
export async function buildPaddedAudioManager(
  padSamples: number,
  meta: PaddedAudioMeta,
  fullMixPcm: Float32Array,
  secondaryPcm: Float32Array | null,
  chartDoc: ChartDocument,
  onSongEnded: () => void,
  secondaryFileName = 'drums.wav',
): Promise<{
  audioManager: AudioManager;
  paddedFullMixPcm: Float32Array;
  paddedSecondaryPcm: Float32Array | null;
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

  let paddedSecondaryPcm: Float32Array | null = null;
  if (secondaryPcm) {
    paddedSecondaryPcm = padPcmStart(secondaryPcm, padSamples, meta.channels);
    const stemWav = encodeWavBlob(
      paddedSecondaryPcm,
      meta.sampleRate,
      meta.channels,
    );
    const stemArray = new Uint8Array(await stemWav.arrayBuffer());
    audioFiles.push({fileName: secondaryFileName, data: stemArray});
  }

  const audioManager = new AudioManager(audioFiles, onSongEnded);
  await audioManager.ready;
  audioManager.setChartDelay(
    getChartDelayMs(chartDoc.parsedChart.metadata) / 1000,
  );

  return {audioManager, paddedFullMixPcm, paddedSecondaryPcm};
}

export interface UsePaddedAudioParams {
  /** Chart doc driving both chart-delay and `audioAnchor`. Null until the
   *  host page has loaded/parsed the chart. */
  chartDoc: ChartDocument | null;
  audioMeta: PaddedAudioMeta | null;
  /** ORIGINAL (unpadded) full-mix PCM. Null until loaded. */
  fullMixPcm: Float32Array | null;
  /** ORIGINAL (unpadded) secondary stem PCM (e.g. an isolated drum stem).
   *  Omit (or pass null) for pages with a single audio source, e.g. /tempo. */
  secondaryPcm?: Float32Array | null;
  secondaryFileName?: string;
  onSongEnded: () => void;
}

export interface UsePaddedAudioResult {
  audioManager: AudioManager | null;
  /** Padded full-mix PCM, matching the live `audioManager`. */
  fullMixPcm: Float32Array | null;
  /** Padded secondary-stem PCM, matching the live `audioManager`. */
  secondaryPcm: Float32Array | null;
  durationSeconds: number;
  /** True while the AudioManager is being rebuilt after the chart's
   *  `audioAnchor` changed (leading-silence apply/undo/redo, or a
   *  grid-glue tempo edit near the start). False during the initial build. */
  rebuilding: boolean;
}

export function usePaddedAudio({
  chartDoc,
  audioMeta,
  fullMixPcm,
  secondaryPcm = null,
  secondaryFileName = 'drums.wav',
  onSongEnded,
}: UsePaddedAudioParams): UsePaddedAudioResult {
  const {audioManagerRef, setAudioManager: publishAudioManager} =
    useAudioServiceContext();
  const [audioManager, setAudioManager] = useState<AudioManager | null>(null);
  const [paddedFullMixPcm, setPaddedFullMixPcm] = useState<Float32Array | null>(
    null,
  );
  const [paddedSecondaryPcm, setPaddedSecondaryPcm] =
    useState<Float32Array | null>(null);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [rebuilding, setRebuilding] = useState(false);

  // Pad-sample count the CURRENT audioManager/PCM state was built with.
  // null = never built yet (still the initial build).
  const padSamplesRef = useRef<number | null>(null);
  // Guards overlapping rebuilds (rapid undo/redo).
  const rebuildTokenRef = useRef(0);

  useEffect(() => {
    if (!chartDoc || !audioMeta || !fullMixPcm) return;

    const anchor = getAudioAnchor(chartDoc);
    const nextPadSamples = anchorPadSamples(anchor, audioMeta.sampleRate);
    if (padSamplesRef.current === nextPadSamples) return;

    let cancelled = false;
    const token = ++rebuildTokenRef.current;
    const isFirstBuild = padSamplesRef.current === null;

    (async () => {
      if (!isFirstBuild) setRebuilding(true);
      try {
        const oldManager = audioManagerRef.current;
        const wasPlaying = oldManager?.isPlaying ?? false;
        const chartTimePos = oldManager?.chartTime ?? 0;
        if (oldManager) await oldManager.pause();

        const built = await buildPaddedAudioManager(
          nextPadSamples,
          audioMeta,
          fullMixPcm,
          secondaryPcm,
          chartDoc,
          onSongEnded,
          secondaryFileName,
        );

        if (cancelled || token !== rebuildTokenRef.current) {
          built.audioManager.destroy();
          return;
        }

        publishAudioManager(built.audioManager);
        setAudioManager(built.audioManager);
        setPaddedFullMixPcm(built.paddedFullMixPcm);
        setPaddedSecondaryPcm(built.paddedSecondaryPcm);
        setDurationSeconds(built.audioManager.duration);
        padSamplesRef.current = nextPadSamples;

        if (!isFirstBuild) {
          await built.audioManager.seekToChartTime(chartTimePos);
          if (wasPlaying) await built.audioManager.resume();
        }

        oldManager?.destroy();
      } catch (err) {
        console.error('Failed to build/rebuild padded audio:', err);
        toast.error('Failed to update audio for the leading-silence change');
      } finally {
        if (!cancelled) setRebuilding(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // secondaryFileName intentionally omitted: static per page. `onSongEnded`
    // and `secondaryPcm` ARE listed — an identity/value change alone reruns
    // this effect, but the padSamples check above short-circuits it into a
    // no-op unless the anchor actually changed, so this never causes an
    // extra rebuild.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    chartDoc,
    audioMeta,
    fullMixPcm,
    secondaryPcm,
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
    secondaryPcm: paddedSecondaryPcm,
    durationSeconds,
    rebuilding,
  };
}
