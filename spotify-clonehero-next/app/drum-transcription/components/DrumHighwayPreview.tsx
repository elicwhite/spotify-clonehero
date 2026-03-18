'use client';

import {useEffect, useRef} from 'react';
import {setupRenderer} from '@/lib/preview/highway';
import {AudioManager} from '@/lib/preview/audioManager';
import type {ChartResponseEncore} from '@/lib/chartSelection';
import type {ParsedChart} from '@/lib/drum-transcription/chart-io/reader';

interface DrumHighwayPreviewProps {
  metadata: ChartResponseEncore;
  chart: ParsedChart;
  audioManager: AudioManager;
  className?: string;
}

/**
 * Renders the 3D Clone Hero drum highway for the transcription editor.
 *
 * Wraps setupRenderer() from lib/preview/highway.ts. The highway
 * reads audioManager.currentTime in its animation loop, so it stays
 * in sync with all other views automatically.
 *
 * Automatically finds and renders the Expert Drums track. If no drum
 * track is found, displays a placeholder message.
 */
export default function DrumHighwayPreview({
  metadata,
  chart,
  audioManager,
  className,
}: DrumHighwayPreviewProps) {
  const sizingRef = useRef<HTMLDivElement>(null!);
  const canvasRef = useRef<HTMLDivElement>(null!);
  const rendererRef = useRef<ReturnType<typeof setupRenderer> | null>(null);

  // Find the expert drums track
  const drumTrack = chart.trackData.find(
    t => t.instrument === 'drums' && t.difficulty === 'expert',
  );

  useEffect(() => {
    if (!canvasRef.current || !drumTrack) return;

    // Destroy previous renderer if any
    rendererRef.current?.destroy();

    const renderer = setupRenderer(
      metadata,
      chart,
      sizingRef,
      canvasRef,
      audioManager,
    );
    rendererRef.current = renderer;
    renderer.prepTrack(drumTrack);
    renderer.startRender();

    return () => {
      renderer.destroy();
      rendererRef.current = null;
    };
  }, [metadata, chart, drumTrack, audioManager]);

  if (!drumTrack) {
    return (
      <div
        className={`flex items-center justify-center bg-muted/50 rounded-lg border text-sm text-muted-foreground ${className ?? ''}`}>
        No drum track found in chart data.
      </div>
    );
  }

  return (
    <div
      className={`relative overflow-hidden rounded-lg border bg-black ${className ?? ''}`}
      ref={sizingRef}>
      <div ref={canvasRef} className="h-full w-full" />
    </div>
  );
}
