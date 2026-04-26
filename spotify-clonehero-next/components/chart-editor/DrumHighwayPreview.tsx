'use client';

import {memo, useEffect, useMemo, useRef} from 'react';
import {
  setupRenderer,
  type OverlayState,
  InteractionManager,
  type HighwayMode,
  type SceneReconciler,
  type NoteRenderer,
} from '@/lib/preview/highway';
import type {WaveformSurfaceConfig} from '@/lib/preview/highway/WaveformSurface';
import type {GridOverlayConfig} from '@/lib/preview/highway/GridOverlay';
import {AudioManager} from '@/lib/preview/audioManager';
import type {ChartResponseEncore} from '@/lib/chartSelection';
import {parseChartFile} from '@eliwhite/scan-chart';
type ParsedChart = ReturnType<typeof parseChartFile>;

/** The subset of the renderer API that the editor needs. */
export interface HighwayRendererHandle {
  getCamera(): import('three').PerspectiveCamera;
  getHighwaySpeed(): number;
  /** Set overlay state for the current frame (read by render loop). */
  setOverlayState(state: OverlayState): void;
  /** Update timing data for tick-to-ms conversion. */
  setTimingData(
    timedTempos: {tick: number; msTime: number; beatsPerMinute: number}[],
    resolution: number,
  ): void;
  /** Get the InteractionManager for hit-testing and coordinate conversion. */
  getInteractionManager(): Promise<InteractionManager | null>;
  /** Get the SceneReconciler for declarative element management. */
  getReconciler(): Promise<SceneReconciler>;
  /** Get the NoteRenderer for overlay state management. */
  getNoteRenderer(): Promise<NoteRenderer>;
  /** Set waveform audio data for the highway surface. */
  setWaveformData(
    config: Omit<WaveformSurfaceConfig, 'highwayWidth' | 'highwaySpeed'>,
  ): Promise<void>;
  /** Set grid overlay data (tempos + time signatures). */
  setGridData(
    config: Omit<GridOverlayConfig, 'highwayWidth' | 'highwaySpeed'>,
  ): Promise<void>;
  /** Switch between 'classic' and 'waveform' highway modes. */
  setHighwayMode(mode: HighwayMode): void;
  /** Get the current highway display mode. */
  getHighwayMode(): HighwayMode;
}

interface DrumHighwayPreviewProps {
  metadata: ChartResponseEncore;
  chart: ParsedChart;
  audioManager: AudioManager;
  className?: string;
  /**
   * When false, render a neutral floor with no drum lanes / hitbox / notes.
   * Defaults to true. Pages that don't have a drum track (add-lyrics) set
   * this to false so the highway still renders markers + cursor without
   * drawing meaningless drum geometry.
   */
  showDrumLanes?: boolean;
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
  showDrumLanes = true,
  onRendererReady,
}: DrumHighwayPreviewProps) {
  const sizingRef = useRef<HTMLDivElement>(null!);
  const canvasRef = useRef<HTMLDivElement>(null!);
  const rendererRef = useRef<ReturnType<typeof setupRenderer> | null>(null);

  // Memoize so the reference is stable when chart hasn't changed.
  // When the chart has no drum track but lanes-off mode is requested, fall
  // back to a synthetic empty drum track so the renderer pipeline (which
  // expects an `instrument: 'drums'` track for texture loading) still runs.
  const drumTrack = useMemo(() => {
    const found = chart.trackData.find(
      t => t.instrument === 'drums' && t.difficulty === 'expert',
    );
    if (found) return found;
    if (!showDrumLanes) {
      return {
        instrument: 'drums',
        difficulty: 'expert',
        starPowerSections: [],
        rejectedStarPowerSections: [],
        soloSections: [],
        flexLanes: [],
        drumFreestyleSections: [],
        trackEvents: [],
        textEvents: [],
        versusPhrases: [],
        animations: [],
        unrecognizedMidiEvents: [],
        noteEventGroups: [],
      } as unknown as ParsedChart['trackData'][number];
    }
    return undefined;
  }, [chart, showDrumLanes]);

  // Use a ref to capture the latest drumTrack for the initial prepTrack() call.
  // The renderer lifecycle only depends on metadata and audioManager.
  // Data updates (chart edits) flow through the SceneReconciler, not renderer recreation.
  const drumTrackRef = useRef(drumTrack);
  drumTrackRef.current = drumTrack;

  useEffect(() => {
    const track = drumTrackRef.current;
    if (!canvasRef.current || !track) return;

    // Destroy previous renderer if any
    rendererRef.current?.destroy();

    const renderer = setupRenderer(
      metadata,
      chart,
      sizingRef,
      canvasRef,
      audioManager,
      {showDrumLanes},
    );
    rendererRef.current = renderer;
    renderer.prepTrack(track);
    renderer.startRender();

    // Expose renderer API to the editor overlay
    onRendererReady?.({
      getCamera: () => renderer.getCamera(),
      getHighwaySpeed: () => renderer.getHighwaySpeed(),
      setOverlayState: (state: OverlayState) => renderer.setOverlayState(state),
      setTimingData: (timedTempos, resolution) =>
        renderer.setTimingData(timedTempos, resolution),
      getInteractionManager: () => renderer.getInteractionManager(),
      getReconciler: () => renderer.getReconciler(),
      getNoteRenderer: () => renderer.getNoteRenderer(),
      setWaveformData: config => renderer.setWaveformData(config),
      setGridData: config => renderer.setGridData(config),
      setHighwayMode: mode => renderer.setHighwayMode(mode),
      getHighwayMode: () => renderer.getHighwayMode(),
    });

    return () => {
      renderer.destroy();
      rendererRef.current = null;
      onRendererReady?.(null);
    };
    // Only recreate the renderer when the instrument/audio changes.
    // Chart data updates flow through the SceneReconciler (not renderer recreation).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metadata, audioManager, onRendererReady]);

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
