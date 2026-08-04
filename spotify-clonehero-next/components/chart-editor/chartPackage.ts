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
 * Assist audio boundary with the reasons a chart package can't offer every
 * card.
 */

import {useCallback, useMemo} from 'react';

import {writeChartFolder} from '@/lib/chart-edit';
import type {ChartDocument} from '@/lib/chart-edit';
import type {Files} from '@/lib/preview/chorus-chart-processing';
import {AudioManager} from '@/lib/preview/audioManager';
import {getChartDelayMs} from '@/lib/chart-utils/chartDelay';
import {
  CLICK_TRACK_NAME,
  generateBeatClickTrackWav,
} from '@/lib/preview/clickTrack';
import {mixStemsToAudioBuffer} from '@/lib/audio-pipeline/lyrics-audio';
import {interleaveAudioBuffer} from '@/lib/drum-transcription/audio/decoder';
import {encodeWavBlob} from '@/lib/audio/wav-encoder';
import {audioMimeType} from '@/lib/sng/file-utils';
import type {AssistAudio} from '@/lib/assist/tasks/types';
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
  const stems: Files = [...audioFiles];
  if (durationSeconds > 0) {
    try {
      const clickWav = await generateBeatClickTrackWav(
        chartDoc.parsedChart,
        durationSeconds * 1000,
        chartDelayMs,
      );
      stems.push({fileName: `${CLICK_TRACK_NAME}.wav`, data: clickWav});
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
    audioManager.setVolume(CLICK_TRACK_NAME, 0);
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

/** The doc as `notes.chart` text, the format both hosts save and export. */
export function chartDocToChartText(chartDoc: ChartDocument): string {
  const files = writeChartFolder(chartDoc);
  const chartFile = files.find(f => f.fileName === 'notes.chart');
  if (!chartFile) {
    throw new Error('writeChartFolder did not produce notes.chart');
  }
  return new TextDecoder().decode(chartFile.data);
}

/**
 * The package's audio as one file's bytes, for the assist tasks that work
 * from audio alone. A single file IS the full mix, so its bytes go over
 * verbatim and the fingerprint derived from them matches the same file
 * separated by any other tool. A multi-stem package has no single mixed
 * file, so the stems are summed back into one and encoded, the same
 * reconstruction `/add-lyrics` performs before re-separating.
 */
export async function chartPackageAudioBytes(
  audioFiles: Files,
): Promise<Uint8Array> {
  if (audioFiles.length === 0) {
    throw new Error('No audio files found in chart package');
  }
  if (audioFiles.length === 1) return audioFiles[0].data;
  const mixed = await mixStemsToAudioBuffer(
    audioFiles.map(f => ({
      data: f.data,
      mimeType: audioMimeType(f.fileName),
    })),
  );
  const wav = encodeWavBlob(interleaveAudioBuffer(mixed), mixed.sampleRate, 2);
  return new Uint8Array(await wav.arrayBuffer());
}

/**
 * Why a chart-package host can't offer two of the Chart Assist cards' actions.
 * The cards still render — their advice and note counts are worth reading —
 * with the action disabled and these on the tooltip.
 */
export const CHART_PACKAGE_ASSIST_DISABLED_REASONS = {
  /** Padding the chart is only half of adding leading silence: these hosts
   *  build playback straight from the package's audio files and never pad
   *  them, so a shifted chart would drift away from its audio. */
  leadingSilence:
    "This editor builds its audio playback directly from the chart's files and never pads it to match a shifted chart, so it cannot add leading silence here yet.",
  /** Re-running transcription needs the separated drum stem an OPFS
   *  drum-transcription project holds, which a chart loaded from a file
   *  doesn't have. */
  drumRerun:
    'Re-running transcription needs the separated drum audio from the drum transcription tool. This chart was loaded from a file, so there is nothing to re-run here.',
} as const;

// ---------------------------------------------------------------------------
// Editor props
// ---------------------------------------------------------------------------

export interface ChartPackageEditorProps {
  audioData: Float32Array | undefined;
  audioChannels: number;
  getChartText: () => Promise<string>;
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
 * - Lyrics / Vocals: RUNS. `add-lyrics` needs audio bytes plus the pasted
 *   text. With no stem-cache fingerprint to offer, a chart whose audio was
 *   never separated here takes the Demucs branch, which is exactly what
 *   `/add-lyrics` does with the same input.
 * - Add leading silence: DISABLED, still shown.
 * - Drum transcription: DISABLED, still shown (only on charts that have
 *   Expert Drums). The note count and the staleness prompt come from editor
 *   state alone, and "Keep as-is" is a decision about that state, so both
 *   keep working.
 *
 * `loadAudioFiles` must be referentially stable (a `useCallback`): it is a
 * dependency of the memoized callbacks handed to the editor.
 */
export function useChartPackageEditor(args: {
  audio: PreparedChartPackageAudio | null;
  chartDoc: ChartDocument | null;
  loadAudioFiles: () => Promise<Files>;
}): ChartPackageEditorProps {
  const {audio, chartDoc, loadAudioFiles} = args;

  const getChartText = useCallback(async (): Promise<string> => {
    if (!chartDoc) throw new Error('No chart document');
    return chartDocToChartText(chartDoc);
  }, [chartDoc]);

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
    }),
    [loadAudioFiles],
  );

  const audioSampleRate = audio?.audioSampleRate;
  const chartAssist = useMemo<ChartAssistProps>(
    () => ({
      loadAudio,
      audioSampleRate,
      leadingSilenceDisabledReason:
        CHART_PACKAGE_ASSIST_DISABLED_REASONS.leadingSilence,
      drumRerunDisabledReason: CHART_PACKAGE_ASSIST_DISABLED_REASONS.drumRerun,
    }),
    [loadAudio, audioSampleRate],
  );

  return {
    audioData: audio?.audioData,
    audioChannels: audio?.audioChannels ?? 2,
    getChartText,
    getAudioSources,
    chartAssist,
  };
}
