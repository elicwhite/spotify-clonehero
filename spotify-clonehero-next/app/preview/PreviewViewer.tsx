'use client';

import {useEffect, useState} from 'react';
import {Loader2, AlertCircle} from 'lucide-react';
import type {ChartDocument} from '@/lib/chart-edit';
import type {Files} from '@/lib/preview/chorus-chart-processing';
import type {ChartResponseEncore} from '@/lib/chartSelection';
import {AudioManager} from '@/lib/preview/audioManager';
import {getChartDelayMs} from '@/lib/chart-utils/chartDelay';
import {
  mixToInterleavedStereo,
  type DecodedStem,
} from '@/lib/preview/waveformMix';
import {
  ChartEditorProvider,
  PREVIEW_CAPABILITIES,
  DEFAULT_DRUMS_EXPERT_SCOPE,
  useChartEditorContext,
} from '@/components/chart-editor';
import ChartEditor from '@/components/chart-editor/ChartEditor';

export interface PreviewChart {
  metadata: ChartResponseEncore;
  chartDoc: ChartDocument;
  audioFiles: Files;
}

/**
 * Read-only chart previewer on the shared chart-editor shell: 3D highway
 * (classic or waveform surface), transport waveform, and section
 * navigation. No editing, no export — the sidebar only exposes playback
 * controls (loop, speed, zoom, highway mode).
 */
export default function PreviewViewer({chart}: {chart: PreviewChart}) {
  return (
    <ChartEditorProvider
      capabilities={PREVIEW_CAPABILITIES}
      activeScope={DEFAULT_DRUMS_EXPERT_SCOPE}>
      <PreviewViewerInner chart={chart} />
    </ChartEditorProvider>
  );
}

function PreviewViewerInner({chart}: {chart: PreviewChart}) {
  const {state, dispatch, audioManagerRef} = useChartEditorContext();
  const [audioManager, setAudioManager] = useState<AudioManager | null>(null);
  const [audioData, setAudioData] = useState<Float32Array | null>(null);
  const [audioChannels, setAudioChannels] = useState(2);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const am = new AudioManager(chart.audioFiles, () => {
          dispatch({type: 'SET_PLAYING', isPlaying: false});
        });
        await am.ready;
        if (cancelled) {
          am.destroy();
          return;
        }
        am.setChartDelay(
          getChartDelayMs(chart.chartDoc.parsedChart.metadata) / 1000,
        );
        audioManagerRef.current = am;
        setAudioManager(am);
        setDurationSeconds(am.duration);
        dispatch({type: 'SET_CHART_DOC', chartDoc: chart.chartDoc});

        // Decode all stems into one mixed PCM buffer for the transport
        // waveform and the waveform highway surface. Waveforms are
        // optional — undecodable stems are skipped, and the preview
        // still works with no waveform at all.
        const waveformCtx = new AudioContext({sampleRate: 44100});
        try {
          const stems = (
            await Promise.all(
              chart.audioFiles.map(
                async (file): Promise<DecodedStem | null> => {
                  try {
                    const buffer = file.data.slice(0).buffer;
                    const decoded = await waveformCtx.decodeAudioData(
                      buffer as ArrayBuffer,
                    );
                    return {
                      channelData: Array.from(
                        {length: decoded.numberOfChannels},
                        (_, ch) => decoded.getChannelData(ch),
                      ),
                    };
                  } catch {
                    console.warn(
                      `Could not decode ${file.fileName} for waveform display`,
                    );
                    return null;
                  }
                },
              ),
            )
          ).filter((stem): stem is DecodedStem => stem !== null);

          const mixed = mixToInterleavedStereo(stems);
          if (!cancelled && mixed) {
            setAudioData(mixed.data);
            setAudioChannels(mixed.channels);
          }
        } finally {
          await waveformCtx.close();
        }
      } catch (err) {
        if (cancelled) return;
        const msg =
          err instanceof Error ? err.message : 'Failed to load chart audio';
        console.error('PreviewViewer load error:', err);
        setErrorMessage(msg);
      }
    }

    load();

    return () => {
      cancelled = true;
      audioManagerRef.current?.destroy();
      audioManagerRef.current = null;
      setAudioManager(null);
    };
    // audioManagerRef/dispatch are stable context values
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chart]);

  if (errorMessage) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 gap-4">
        <AlertCircle className="h-10 w-10 text-destructive" />
        <p className="text-sm text-destructive">{errorMessage}</p>
      </div>
    );
  }

  const parsedChart = state.chartDoc?.parsedChart ?? null;
  if (!parsedChart || !audioManager) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 gap-4">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Preparing preview...</p>
      </div>
    );
  }

  return (
    <ChartEditor
      metadata={chart.metadata}
      chart={parsedChart}
      audioManager={audioManager}
      audioData={audioData ?? undefined}
      audioChannels={audioChannels}
      durationSeconds={durationSeconds}
      sections={parsedChart.sections}
      songName={chart.metadata.name}
      artistName={chart.metadata.artist}
      charterName={chart.metadata.charter}
    />
  );
}
