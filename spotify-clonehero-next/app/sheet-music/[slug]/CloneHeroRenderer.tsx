import {parseChartFile} from '@eliwhite/scan-chart';
import {useEffect, useRef} from 'react';

import {setupRenderer} from '@/lib/preview/highway';
import {AudioManager} from '@/lib/preview/audioManager';
import {ChartResponseEncore} from '@/lib/chartSelection';

type ParsedChart = ReturnType<typeof parseChartFile>;

export default function CloneHeroRenderer({
  metadata,
  chart,
  track,
  audioManager,
}: {
  metadata: ChartResponseEncore;
  chart: ParsedChart;
  track: ParsedChart['trackData'][0];
  audioManager: AudioManager;
}) {
  const sizingRef = useRef<HTMLDivElement>(null!);
  const ref = useRef<HTMLDivElement>(null!);
  const rendererRef = useRef<ReturnType<typeof setupRenderer> | null>(null);

  useEffect(() => {
    const renderer = setupRenderer(
      metadata,
      chart,
      sizingRef,
      ref,
      audioManager,
    );
    rendererRef.current = renderer;
    renderer.prepTrack(track);
    renderer.setGridData({
      tempos: chart.tempos,
      timeSignatures: chart.timeSignatures,
      resolution: chart.resolution,
      durationMs: metadata.song_length || 60 * 5 * 1000,
    });
    renderer.startRender();
    return () => {
      renderer.destroy();
    };
  }, [metadata, audioManager, chart, track]);

  return (
    <div className="flex-1 flex-col justify-center bg-white rounded-lg border overflow-y-auto">
      {/* <InstrumentDifficultyPicker
        chart={chart}
        selectedTrack={selectedTrack}
        onTrackSelected={setSelectedTrack}
      /> */}

      <div className="relative h-full" ref={sizingRef}>
        <div ref={ref} className="h-full" />
      </div>
    </div>
  );
}
