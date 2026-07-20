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
import type {TrackKey} from './scope';
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
  /**
   * Push fresh karaoke lyrics + vocal phrases. Called whenever the
   * editor's chartDoc updates (lyric flag drag, lyric edit, etc.).
   * Lazy-creates the lyrics overlay when the original chart had none.
   */
  setLyricsData(
    lyrics: {msTime: number; text: string; msLength?: number}[],
    vocalPhrases: {msTime: number; msLength: number}[],
  ): Promise<void>;
  /** Switch between 'classic' and 'waveform' highway modes. */
  setHighwayMode(mode: HighwayMode): void;
  /** Get the current highway display mode. */
  getHighwayMode(): HighwayMode;
}

interface HighwayPreviewProps {
  metadata: ChartResponseEncore;
  chart: ParsedChart;
  audioManager: AudioManager;
  className?: string;
  /**
   * When false, render a neutral floor with no instrument lanes / hitbox /
   * notes. Defaults to true. Pages that don't have a drum track
   * (add-lyrics) set this to false so the highway still renders markers +
   * cursor without drawing meaningless drum geometry.
   */
  showLanes?: boolean;
  /**
   * Instrument + difficulty to render. `undefined` for scopes with no
   * notes track (vocals/global — add-lyrics): the highway then renders
   * just the neutral floor + markers, with no instrument track resolved
   * at all (no lanes, no note textures loaded).
   */
  trackKey?: TrackKey | undefined;
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
 * track is found, renders the neutral floor (beat grid + markers) with
 * no lanes.
 */
const HighwayPreview = memo(function HighwayPreview({
  metadata,
  chart,
  audioManager,
  className,
  showLanes = true,
  trackKey,
  onRendererReady,
}: HighwayPreviewProps) {
  const sizingRef = useRef<HTMLDivElement>(null!);
  const canvasRef = useRef<HTMLDivElement>(null!);
  const rendererRef = useRef<ReturnType<typeof setupRenderer> | null>(null);

  // `null` when the page has no notes track for this scope (no trackKey —
  // vocals/global) or the chart doesn't contain the requested track. The
  // renderer then skips lanes, hitbox, and note-texture loading entirely
  // and draws only the neutral floor + markers.
  const activeTrack = useMemo(() => {
    if (!trackKey) return null;
    return (
      chart.trackData.find(
        t =>
          t.instrument === trackKey.instrument &&
          t.difficulty === trackKey.difficulty,
      ) ?? null
    );
  }, [chart, trackKey]);

  // Lanes only make sense when the chart actually has the active track;
  // otherwise render the neutral floor even when the capability profile
  // asks for lanes.
  const effectiveShowLanes = showLanes && activeTrack != null;

  // Use refs to capture the latest track + lanes flag for the initial
  // prepTrack()/setupRenderer() call. The renderer lifecycle only depends
  // on metadata and audioManager. Data updates (chart edits) flow through
  // the SceneReconciler, not renderer recreation.
  const activeTrackRef = useRef(activeTrack);
  activeTrackRef.current = activeTrack;
  const showLanesRef = useRef(effectiveShowLanes);
  showLanesRef.current = effectiveShowLanes;

  useEffect(() => {
    const track = activeTrackRef.current;
    if (!canvasRef.current) return;

    // Destroy previous renderer if any
    rendererRef.current?.destroy();

    const renderer = setupRenderer(
      metadata,
      chart,
      sizingRef,
      canvasRef,
      audioManager,
      {showDrumLanes: showLanesRef.current},
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
      setLyricsData: (lyrics, vocalPhrases) =>
        renderer.setLyricsData(lyrics, vocalPhrases),
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
  }, [
    metadata,
    audioManager,
    onRendererReady,
    trackKey?.instrument,
    trackKey?.difficulty,
  ]);

  return (
    <div
      className={`relative overflow-hidden rounded-lg border bg-black ${className ?? ''}`}
      ref={sizingRef}>
      <div ref={canvasRef} className="h-full w-full" />
    </div>
  );
});

export default HighwayPreview;
