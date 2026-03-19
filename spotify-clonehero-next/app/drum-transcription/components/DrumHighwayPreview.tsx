'use client';

import {memo, useEffect, useMemo, useRef} from 'react';
import {setupRenderer} from '@/lib/preview/highway';
import {AudioManager} from '@/lib/preview/audioManager';
import type {ChartResponseEncore} from '@/lib/chartSelection';
import type {ParsedChart} from '@/lib/drum-transcription/chart-io/reader';

/** The subset of the renderer API that the overlay needs for coordinate mapping. */
export interface HighwayRendererHandle {
  getCamera(): import('three').PerspectiveCamera;
  getHighwaySpeed(): number;
}

interface DrumHighwayPreviewProps {
  metadata: ChartResponseEncore;
  chart: ParsedChart;
  audioManager: AudioManager;
  className?: string;
  /** Called when the renderer is ready (or destroyed). */
  onRendererReady?: (handle: HighwayRendererHandle | null) => void;
}

/**
 * Renders the 3D Clone Hero drum highway for the transcription editor.
 *
 * Wraps setupRenderer() from lib/preview/highway.ts. The highway
 * reads audioManager.currentTime in its animation loop, so it stays
 * in sync with all other views automatically.
 *
 * Wrapped in React.memo so that parent re-renders (e.g. from context
 * state changes like currentTimeMs or selectedNoteIds) do NOT tear down
 * the Three.js renderer as long as the props remain referentially stable.
 *
 * Automatically finds and renders the Expert Drums track. If no drum
 * track is found, displays a placeholder message.
 */
const DrumHighwayPreview = memo(function DrumHighwayPreview({
  metadata,
  chart,
  audioManager,
  className,
  onRendererReady,
}: DrumHighwayPreviewProps) {
  const sizingRef = useRef<HTMLDivElement>(null!);
  const canvasRef = useRef<HTMLDivElement>(null!);
  const rendererRef = useRef<ReturnType<typeof setupRenderer> | null>(null);

  // Memoize so the reference is stable when chart hasn't changed.
  const drumTrack = useMemo(
    () =>
      chart.trackData.find(
        t => t.instrument === 'drums' && t.difficulty === 'expert',
      ),
    [chart],
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

    // Expose camera/speed to the overlay
    onRendererReady?.({
      getCamera: () => renderer.getCamera(),
      getHighwaySpeed: () => renderer.getHighwaySpeed(),
    });

    return () => {
      renderer.destroy();
      rendererRef.current = null;
      onRendererReady?.(null);
    };
  }, [metadata, chart, drumTrack, audioManager, onRendererReady]);

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
});

export default DrumHighwayPreview;
