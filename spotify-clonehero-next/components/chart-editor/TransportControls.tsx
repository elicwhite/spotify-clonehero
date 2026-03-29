'use client';

import {useCallback, useEffect, useRef, useState} from 'react';
import {useHotkey, formatForDisplay} from '@tanstack/react-hotkeys';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Minus,
  Plus,
} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type {AudioManager} from '@/lib/preview/audioManager';

interface Section {
  name: string;
  msTime: number;
}

interface TransportControlsProps {
  audioManager: AudioManager;
  /** Total song duration in seconds. */
  durationSeconds: number;
  /** Chart sections for section jumping (optional). */
  sections?: Section[];
  /** Content rendered between the time display and speed controls (e.g. waveform). */
  children?: React.ReactNode;
  /** Optional CSS class for the container. */
  className?: string;
}

/** Format seconds as m:ss or h:mm:ss. */
function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '0:00';
  const totalSec = Math.floor(seconds);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Available speed presets. */
const SPEED_PRESETS = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0];

/**
 * Unified playback transport controls for the drum transcription editor.
 *
 * All controls drive AudioManager directly. The highway renderer and
 * WaveformDisplay follow automatically since they read from AudioManager
 * in their animation loops.
 *
 * Features:
 * - Play/Pause toggle
 * - Seek slider with current time display
 * - Speed control with presets
 * - Section jumping (skip forward/back between chart sections)
 * - Keyboard shortcuts (Space, Left/Right, [ / ])
 */
export default function TransportControls({
  audioManager,
  durationSeconds,
  sections = [],
  children,
  className,
}: TransportControlsProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [tempo, setTempo] = useState(1.0);
  const animationFrameRef = useRef<number>(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // Update current time display via animation frame
  const updateTime = useCallback(() => {
    if (audioManager.isInitialized) {
      setCurrentTime(audioManager.currentTime);
    }
    setIsPlaying(audioManager.isPlaying);
    animationFrameRef.current = requestAnimationFrame(updateTime);
  }, [audioManager]);

  useEffect(() => {
    animationFrameRef.current = requestAnimationFrame(updateTime);
    return () => cancelAnimationFrame(animationFrameRef.current);
  }, [updateTime]);

  // Play/Pause toggle
  const togglePlayPause = useCallback(async () => {
    if (audioManager.isPlaying) {
      await audioManager.pause();
    } else if (audioManager.isInitialized) {
      await audioManager.resume();
    } else {
      await audioManager.play({time: currentTime});
    }
  }, [audioManager, currentTime]);

  // Speed control
  const handleSpeedChange = useCallback(
    (delta: number) => {
      const currentIdx = SPEED_PRESETS.indexOf(tempo);
      const nextIdx = Math.max(
        0,
        Math.min(SPEED_PRESETS.length - 1, currentIdx + delta),
      );
      const newTempo = SPEED_PRESETS[nextIdx];
      audioManager.setTempo(newTempo);
      setTempo(newTempo);
    },
    [audioManager, tempo],
  );

  // Section jumping
  const jumpToNextSection = useCallback(() => {
    if (sections.length === 0) return;
    const currentMs = currentTime * 1000;
    const nextSection = sections.find(s => s.msTime > currentMs + 100);
    if (nextSection) {
      audioManager.play({time: nextSection.msTime / 1000});
    }
  }, [audioManager, currentTime, sections]);

  const jumpToPrevSection = useCallback(() => {
    if (sections.length === 0) return;
    const currentMs = currentTime * 1000;
    // Find the section before the current position (with 500ms tolerance)
    const prevSections = sections.filter(s => s.msTime < currentMs - 500);
    if (prevSections.length > 0) {
      const prevSection = prevSections[prevSections.length - 1];
      audioManager.play({time: prevSection.msTime / 1000});
    } else {
      // Go to beginning
      audioManager.play({time: 0});
    }
  }, [audioManager, currentTime, sections]);

  // Keyboard shortcuts via @tanstack/react-hotkeys
  useHotkey('Space', () => {
    togglePlayPause();
  });

  // Arrow keys are handled by useEditorKeyboard (grid navigation)

  useHotkey('[', () => {
    handleSpeedChange(-1);
  });

  useHotkey(']', () => {
    handleSpeedChange(1);
  });

  return (
    <TooltipProvider delayDuration={300}>
      <div
        ref={containerRef}
        className={`flex items-center gap-2 w-full ${className ?? ''}`}>
        {/* Section skip back */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={jumpToPrevSection}
              disabled={sections.length === 0}>
              <SkipBack className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Previous section ({formatForDisplay('Mod+ArrowLeft')})</TooltipContent>
        </Tooltip>

        {/* Play/Pause */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={togglePlayPause}>
              {isPlaying ? (
                <Pause className="h-4 w-4" />
              ) : (
                <Play className="h-4 w-4" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {isPlaying ? 'Pause' : 'Play'} (Space)
          </TooltipContent>
        </Tooltip>

        {/* Section skip forward */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={jumpToNextSection}
              disabled={sections.length === 0}>
              <SkipForward className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Next section ({formatForDisplay('Mod+ArrowRight')})</TooltipContent>
        </Tooltip>

        {/* Time display */}
        <span className="min-w-[5.5rem] text-sm font-mono text-muted-foreground tabular-nums whitespace-nowrap">
          {formatTime(currentTime)} / {formatTime(durationSeconds)}
        </span>

        {/* Slot for waveform or other content between controls */}
        {children ?? <div className="flex-1" />}

        {/* Speed control */}
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => handleSpeedChange(-1)}
                disabled={tempo <= SPEED_PRESETS[0]}>
                <Minus className="h-3 w-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Slower ([)</TooltipContent>
          </Tooltip>

          <span className="min-w-[3.5rem] text-center text-xs font-mono text-muted-foreground">
            {tempo}x
          </span>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => handleSpeedChange(1)}
                disabled={tempo >= SPEED_PRESETS[SPEED_PRESETS.length - 1]}>
                <Plus className="h-3 w-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Faster (])</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </TooltipProvider>
  );
}
