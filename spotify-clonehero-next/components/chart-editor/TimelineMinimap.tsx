'use client';

import {useCallback, useEffect, useRef, useState} from 'react';
import type {AudioManager} from '@/lib/preview/audioManager';
import {cn} from '@/lib/utils';

interface Section {
  name: string;
  /** Position as milliseconds from song start. */
  timeMs: number;
}

interface TimelineMinimapProps {
  audioManager: AudioManager;
  /** Total song duration in milliseconds. */
  durationMs: number;
  /** Chart sections with names and pre-computed ms positions. */
  sections: Section[];
  className?: string;
}

/** Format seconds to mm:ss.cc (centiseconds). */
function formatTimePrecise(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '00:00.00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const centis = Math.floor((seconds % 1) * 100);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${centis.toString().padStart(2, '0')}`;
}

/**
 * Timeline minimap for the right sidebar.
 *
 * Shows the full song length as a vertical bar with:
 * - Draggable position handle that seeks AudioManager
 * - Section labels with dot indicators
 * - Current time and percentage display
 * - Click-to-seek on the track area
 *
 * Updates every animation frame from audioManager.currentTime.
 */
export default function TimelineMinimap({
  audioManager,
  durationMs,
  sections,
  className,
}: TimelineMinimapProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const animFrameRef = useRef<number>(0);
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const wasPlayingRef = useRef(false);

  const percentage =
    durationMs > 0 ? Math.min(100, (currentTimeMs / durationMs) * 100) : 0;

  // Animation frame loop to track playback position (chart-relative)
  useEffect(() => {
    function tick() {
      if (!isDragging) {
        setCurrentTimeMs(audioManager.chartTime * 1000);
      }
      animFrameRef.current = requestAnimationFrame(tick);
    }
    animFrameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [audioManager, isDragging]);

  // Convert a clientY position on the track to a time in ms.
  // The track is oriented so the bottom = 0ms (song start), top = end.
  const clientYToTimeMs = useCallback(
    (clientY: number): number => {
      const track = trackRef.current;
      if (!track || durationMs <= 0) return 0;
      const rect = track.getBoundingClientRect();
      // Bottom of the track = song start (0ms), top = song end
      const fraction = 1 - (clientY - rect.top) / rect.height;
      return Math.max(0, Math.min(durationMs, fraction * durationMs));
    },
    [durationMs],
  );

  // Click anywhere on track to jump
  const handleTrackClick = useCallback(
    (e: React.MouseEvent) => {
      if (isDragging) return;
      const chartTimeMs = clientYToTimeMs(e.clientY);
      audioManager.playChartTime(chartTimeMs / 1000);
      setCurrentTimeMs(chartTimeMs);
    },
    [audioManager, clientYToTimeMs, isDragging],
  );

  // Drag handling for the position handle
  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(true);
      wasPlayingRef.current = audioManager.isPlaying;
      if (audioManager.isPlaying) {
        audioManager.pause();
      }
    },
    [audioManager],
  );

  useEffect(() => {
    if (!isDragging) return;

    function onMouseMove(e: MouseEvent) {
      const chartTimeMs = clientYToTimeMs(e.clientY);
      setCurrentTimeMs(chartTimeMs);
      audioManager.playChartTime(chartTimeMs / 1000);
    }

    function onMouseUp() {
      setIsDragging(false);
      if (wasPlayingRef.current) {
        audioManager.resume();
      }
    }

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [isDragging, audioManager, clientYToTimeMs]);

  // Section click handler (timeMs is chart time)
  const handleSectionClick = useCallback(
    (timeMs: number) => {
      audioManager.playChartTime(timeMs / 1000);
      setCurrentTimeMs(timeMs);
    },
    [audioManager],
  );

  // Position handle Y as a bottom percentage (song start at bottom)
  const handleBottomPct = percentage;

  return (
    <div
      className={cn(
        'flex flex-col h-full w-[140px] bg-background border-l select-none',
        className,
      )}>
      {/* Time and percentage at top */}
      <div className="shrink-0 px-3 py-3 text-center">
        <div className="text-sm font-mono text-foreground tabular-nums">
          {formatTimePrecise(currentTimeMs / 1000)}
        </div>
        <div className="text-xs font-mono text-muted-foreground tabular-nums">
          {percentage.toFixed(0)}%
        </div>
      </div>

      {/* Track area with sections and position handle */}
      <div
        ref={trackRef}
        className="relative flex-1 min-h-0 mx-3 mb-3 cursor-pointer"
        onClick={handleTrackClick}>
        {/* Track background bar */}
        <div className="absolute left-1/2 top-0 bottom-0 w-[3px] -translate-x-1/2 rounded-full bg-border" />

        {/* Progress fill (from bottom up to handle) */}
        <div
          className="absolute left-1/2 bottom-0 w-[3px] -translate-x-1/2 rounded-full bg-primary/60"
          style={{height: `${handleBottomPct}%`}}
        />

        {/* Section markers */}
        {sections.map((section, i) => {
          const bottomPct =
            durationMs > 0 ? (section.timeMs / durationMs) * 100 : 0;
          return (
            <button
              key={`${section.name}-${i}`}
              className="absolute right-0 flex items-center gap-1.5 -translate-y-1/2 group"
              style={{bottom: `${bottomPct}%`}}
              onClick={e => {
                e.stopPropagation();
                handleSectionClick(section.timeMs);
              }}
              title={`${section.name} (${formatTimePrecise(section.timeMs / 1000)})`}>
              <span className="text-[11px] text-foreground group-hover:text-foreground truncate max-w-[90px] text-right leading-tight font-medium">
                {section.name}
              </span>
              <span className="w-2 h-2 rounded-full bg-foreground/50 group-hover:bg-foreground shrink-0" />
            </button>
          );
        })}

        {/* Position handle */}
        <div
          className={cn(
            'absolute left-0 right-0 -translate-y-1/2 z-10 cursor-grab',
            isDragging && 'cursor-grabbing',
          )}
          style={{bottom: `${handleBottomPct}%`}}
          onMouseDown={handleDragStart}>
          <div className="h-[3px] bg-primary rounded-full shadow-sm" />
          {/* Wider invisible grab area */}
          <div className="absolute -top-2 -bottom-2 left-0 right-0" />
        </div>
      </div>
    </div>
  );
}
