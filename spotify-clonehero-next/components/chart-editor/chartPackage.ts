'use client';

/**
 * The chart-package host boundary: turning an in-memory `ChartDocument` plus
 * the audio files that shipped with it into what `ChartEditor` needs.
 *
 * Two hosts mount the editor this way — `/chart-editor` (through
 * `TrackEditPage`, audio read back from its OPFS project) and the
 * `/drum-difficulties` / `/guitar-difficulties` flow (audio held in memory
 * for the visit) — so the pieces that must agree between them live here:
 * the metronome click stem, the chart delay applied to playback, the
 * waveform PCM and its sample rate, the export audio sources, and the Chart
 * Assist audio boundary with the reason a chart package can't offer every
 * card.
 */

import {useCallback, useMemo} from 'react';

import {chartDocToFolderFiles, writeChartFileAs} from '@/lib/chart-edit';
import type {ChartDocument} from '@/lib/chart-edit';
import type {Files} from '@/lib/preview/chorus-chart-processing';
import {
  AudioManager,
  type AudioSource as AudioManagerSource,
} from '@/lib/preview/audioManager';
import {getChartDelayMs} from '@/lib/chart-utils/chartDelay';
import {
  CLICK_TRACK_NAME,
  generateBeatClickTrackSamples,
} from '@/lib/preview/clickTrack';
import {mixStemsToAudioBuffer} from '@/lib/audio-pipeline/lyrics-audio';
import {interleaveAudioBuffer} from '@/lib/drum-transcription/audio/decoder';
import {encodeWavBlob} from '@/lib/audio/wav-encoder';
import {audioMimeType} from '@/lib/sng/file-utils';
import {getBasename} from '@/lib/src-shared/utils';
import type {AssistAudio} from '@/lib/assist/tasks/types';
import {defaultVolumeFor} from './sidebar/mixerBus';
import type {ChartFileFormat} from '@/lib/chart-files/chart-file-names';
import type {AudioSource} from './ExportDialog';
import type {ChartAssistProps} from './sidebar/ChartAssist';

// ---------------------------------------------------------------------------
// Audio
// ---------------------------------------------------------------------------

export interface PreparedChartPackageAudio {
  audioManager: AudioManager;
  /** Interleaved PCM of the package's first audio file, for the piano roll's
   *  waveform. Undefined when that file couldn't be decoded. */
  audioData: Float32Array | undefined;
  audioChannels: number;
  audioSampleRate: number | undefined;
  /** Duration of that same file, or 0 when it couldn't be decoded. */
  durationSeconds: number;
}

/**
 * Builds the `AudioManager` a chart package plays through, plus the decoded
 * PCM the piano roll draws.
 *
 * The chart's `delay` is applied to playback and a metronome click stem is
 * synthesized from its tempo map and registered as another audio file, so
 * the click gets the same speed/seek sync as every other stem and shows up
 * as the Stems mixer's click row (silent by default).
 *
 * `audioFiles` is never mutated: the click stem goes into a copy, so the
 * caller's list stays the package's real audio for export and Chart Assist.
 */
export async function prepareChartPackageAudio(options: {
  chartDoc: ChartDocument;
  audioFiles: Files;
  onPlaybackEnded: () => void;
}): Promise<PreparedChartPackageAudio> {
  const {chartDoc, audioFiles, onPlaybackEnded} = options;
  if (audioFiles.length === 0) {
    throw new Error('No audio files found in chart package');
  }

  let audioData: Float32Array | undefined;
  let audioChannels = 2;
  let audioSampleRate: number | undefined;
  let durationSeconds = 0;
  try {
    const decodeCtx = new AudioContext({sampleRate: 44100});
    try {
      const buffer = audioFiles[0].data.slice(0).buffer;
      const decoded = await decodeCtx.decodeAudioData(buffer as ArrayBuffer);
      audioChannels = decoded.numberOfChannels;
      audioSampleRate = decoded.sampleRate;
      durationSeconds = decoded.duration;
      const interleaved = new Float32Array(decoded.length * audioChannels);
      for (let ch = 0; ch < audioChannels; ch++) {
        const channelData = decoded.getChannelData(ch);
        for (let i = 0; i < decoded.length; i++) {
          interleaved[i * audioChannels + ch] = channelData[i];
        }
      }
      audioData = interleaved;
    } finally {
      await decodeCtx.close();
    }
  } catch {
    // The waveform and the exact duration are both optional — a package
    // whose first file won't decode still plays through AudioManager.
    console.warn('Could not decode audio for waveform display');
  }

  const chartDelayMs = getChartDelayMs(chartDoc.parsedChart.metadata);
  const stems: AudioManagerSource[] = [...audioFiles];
  if (durationSeconds > 0) {
    try {
      const clickPcm = await generateBeatClickTrackSamples(
        chartDoc.parsedChart,
        durationSeconds * 1000,
        chartDelayMs,
      );
      stems.push({fileName: `${CLICK_TRACK_NAME}.wav`, pcm: clickPcm});
    } catch (err) {
      // Click track is a nice-to-have — don't fail the whole load if
      // synthesis fails.
      console.warn('Could not generate click track:', err);
    }
  }

  const audioManager = new AudioManager(stems, onPlaybackEnded);
  await audioManager.ready;
  audioManager.setChartDelay(chartDelayMs / 1000);
  try {
    audioManager.setVolume(
      CLICK_TRACK_NAME,
      defaultVolumeFor(CLICK_TRACK_NAME) / 100,
    );
  } catch {
    // Click track failed to generate above — no such stem to silence.
  }

  return {
    audioManager,
    audioData,
    audioChannels,
    audioSampleRate,
    durationSeconds,
  };
}

// ---------------------------------------------------------------------------
// Chart text / assist audio
// ---------------------------------------------------------------------------

/** The doc as `notes.chart` text, the format both hosts save and export.
 *  The `song.ini` from the same serialization is what carries the metadata
 *  this text cannot ({@link chartDocToFolderFiles}); a host that persists the
 *  project writes both. */
export function chartDocToChartText(chartDoc: ChartDocument): string {
  const {chart} = chartDocToFolderFiles(chartDoc);
  if (chart.fileName !== 'notes.chart') {
    throw new Error('writeChartFolder did not produce notes.chart');
  }
  return new TextDecoder().decode(chart.data);
}

/**
 * The package's audio as one file's bytes, for the assist tasks that work
 * from audio alone. A single file IS the full mix, so its bytes go over
 * verbatim and the fingerprint derived from them matches the same file
 * separated by any other tool. A multi-stem package has no single mixed
 * file, so the stems are summed back into one and encoded, the same
 * reconstruction `/add-lyrics` performs before re-separating.
 *
 * The metronome click is not music and is dropped from the sum: it is a
 * charting aid, and mixing it in would put a click on every beat of the
 * audio these tasks separate and transcribe.
 */
export async function chartPackageAudioBytes(
  audioFiles: Files,
): Promise<Uint8Array> {
  const musicFiles = audioFiles.filter(
    f => getBasename(f.fileName).toLowerCase() !== CLICK_TRACK_NAME,
  );
  if (musicFiles.length === 0) {
    throw new Error('No audio files found in chart package');
  }
  if (musicFiles.length === 1) return musicFiles[0].data;
  const mixed = await mixStemsToAudioBuffer(
    musicFiles.map(f => ({
      data: f.data,
      mimeType: audioMimeType(f.fileName),
    })),
  );
  const wav = encodeWavBlob(interleaveAudioBuffer(mixed), mixed.sampleRate, 2);
  return new Uint8Array(await wav.arrayBuffer());
}

/**
 * Why a chart-package host can't offer one of the Chart Assist cards' actions.
 * The card still renders — its advice and note counts are worth reading —
 * with the action disabled and this on the tooltip.
 */
export const CHART_PACKAGE_ASSIST_DISABLED_REASONS = {
  /** Padding the chart is only half of adding leading silence: a host that
   *  builds playback straight from the package's audio files and never pads
   *  them would let a shifted chart drift away from its audio. Declared by
   *  the difficulty-generation flow, which does exactly that; `TrackEditPage`
   *  pads both its playback (`usePaddedAudio`) and its exported audio, so it
   *  declares no reason at all. */
  leadingSilence: "Can't pad this editor's audio to match a shifted chart yet.",
} as const;

// ---------------------------------------------------------------------------
// Editor props
// ---------------------------------------------------------------------------

export interface ChartPackageEditorProps {
  getChartFile: (args: {
    format: ChartFileFormat;
  }) => Promise<{fileName: string; data: Uint8Array}>;
  getAudioSources: () => Promise<AudioSource[]>;
  chartAssist: ChartAssistProps;
}

/**
 * The `ChartEditor` props a chart-package host derives from its prepared
 * audio and its live chart doc.
 *
 * Chart Assist on these hosts, card by card (plan 0074 Phase 2):
 * - Tempo map: RUNS. `generate-tempo-map` needs nothing but the song's audio
 *   bytes, which the chart package supplies.
 * - Lyrics: RUNS. `add-lyrics` needs audio bytes plus the pasted
 *   text. With no stem-cache fingerprint to offer, a chart whose audio was
 *   never separated here takes the Demucs branch, which is exactly what
 *   `/add-lyrics` does with the same input.
 * - Add leading silence: shown either way. A host that builds playback
 *   straight from the package's files declares
 *   `CHART_PACKAGE_ASSIST_DISABLED_REASONS.leadingSilence` and the action is
 *   disabled; a host that pads its playback and its exported audio
 *   (`TrackEditPage`) declares nothing and the action runs.
 * - Drum transcription: RUNS, on charts that have Expert Drums.
 *   `transcribe-drums-from-audio` separates its own drum stem out of the same
 *   audio bytes, so it needs no OPFS drum-transcription project.
 *
 * `loadAudioFiles` must be referentially stable (a `useCallback`): it is a
 * dependency of the memoized callbacks handed to the editor.
 */
export function useChartPackageEditor(args: {
  chartDoc: ChartDocument | null;
  loadAudioFiles: () => Promise<Files>;
  /**
   * The stem-cache fingerprint this host has persisted for the audio, when
   * it has one. Supplied, assist tasks key the cache with it verbatim rather
   * than hashing the bytes — which for a multi-file package means mixing the
   * whole song down first.
   */
  stemFingerprint?: string | undefined;
}): ChartPackageEditorProps {
  const {chartDoc, loadAudioFiles, stemFingerprint} = args;

  // Serializes the live document to the format the export dialog asks for,
  // rather than to `.chart` alone. A project keeps the format its chart
  // arrived in, so a `.mid` project exports `.mid` unless the user picks
  // otherwise.
  const getChartFile = useCallback(
    async ({
      format,
    }: {
      format: ChartFileFormat;
    }): Promise<{fileName: string; data: Uint8Array}> => {
      if (!chartDoc) throw new Error('No chart document');
      return writeChartFileAs(chartDoc, format);
    },
    [chartDoc],
  );

  const getAudioSources = useCallback(async (): Promise<AudioSource[]> => {
    const files = await loadAudioFiles();
    return files.map(f => ({
      fileName: f.fileName,
      data: f.data.buffer as ArrayBuffer,
    }));
  }, [loadAudioFiles]);

  const loadAudio = useCallback(
    async (): Promise<AssistAudio> => ({
      loadOriginalBytes: async () =>
        chartPackageAudioBytes(await loadAudioFiles()),
      stemFingerprint,
    }),
    [loadAudioFiles, stemFingerprint],
  );

  const chartAssist = useMemo<ChartAssistProps>(
    () => ({loadAudio}),
    [loadAudio],
  );

  return {getChartFile, getAudioSources, chartAssist};
}
