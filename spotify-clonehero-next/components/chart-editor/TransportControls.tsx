'use client';

import {useCallback, useEffect, useRef, useState} from 'react';
import {useHotkey, formatForDisplay} from '@tanstack/react-hotkeys';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  MousePointer2,
  Plus,
  Undo2,
  Redo2,
} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type {AudioManager} from '@/lib/preview/audioManager';
import type {ToolMode} from '@/lib/chart-editor-core';
import {useChartEditorContext} from './ChartEditorContext';
import {useUndoRedo} from './hooks/useEditCommands';
import {usePlaybackSpeed} from './hooks/usePlaybackSpeed';
import {cn} from '@/lib/utils';

/** Ghost icon button geometry shared by every control on this bar. */
const TRANSPORT_BUTTON_CLASS =
  'h-[1.625rem] w-[1.625rem] hover:bg-[var(--ed-surface-hover)] hover:text-white';

interface Section {
  name: string;
  msTime: number;
}

interface TransportControlsProps {
  audioManager: AudioManager;
  /** Total song duration in seconds. */
  durationSeconds: number;
  /** Chart sections for section jumping (optional). */
  sections?: Section[] | undefined;
  /** Content rendered between the time display and the tool actions (e.g. waveform). */
  children?: React.ReactNode | undefined;
  /** Optional CSS class for the container. */
  className?: string | undefined;
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

/**
 * Unified playback transport controls for the drum transcription editor.
 *
 * All controls drive AudioManager directly. The highway renderer and the
 * piano-roll timeline follow automatically since they read from AudioManager
 * in their animation loops.
 *
 * Features:
 * - Play/Pause toggle
 * - Current time display
 * - Section jumping (skip forward/back between chart sections)
 * - Tool actions at the right end: cursor / place-note, undo / redo
 * - Keyboard shortcuts (Space, Left/Right, [ / ])
 *
 * The `[` / `]` speed hotkeys live here, next to the other transport
 * shortcuts, while the speed value is shown and stepped once in the
 * sidebar's utility cluster — both surfaces read the same reducer value.
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
  const containerRef = useRef<HTMLDivElement>(null);
  const {capabilities} = useChartEditorContext();
  const {undo, redo, canUndo, canRedo} = useUndoRedo();
  // Playback speed is one editor-wide value with one ladder: the sidebar's
  // stepper and this bar's hotkeys are two surfaces on the same hook.
  const {step: stepSpeed} = usePlaybackSpeed(audioManager);

  // Poll AudioManager every frame to drive the time/playing displays.
  // Keep both the loop function and its handle local to the effect so
  // the function doesn't need to reference itself through a closure.
  useEffect(() => {
    let rafId = 0;
    const tick = () => {
      if (audioManager.isInitialized) {
        setCurrentTime(Math.min(audioManager.currentTime, durationSeconds));
      }
      setIsPlaying(audioManager.isPlaying);
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [audioManager, durationSeconds]);

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

  // Section jumping
  // Section msTime values are chart time — use playChartTime for seeking
  // and chartTime for comparison.
  const jumpToNextSection = useCallback(() => {
    if (sections.length === 0) return;
    const chartMs = audioManager.chartTime * 1000;
    const nextSection = sections.find(s => s.msTime > chartMs + 100);
    if (nextSection) {
      audioManager.playChartTime(nextSection.msTime / 1000);
    }
  }, [audioManager, sections]);

  const jumpToPrevSection = useCallback(() => {
    if (sections.length === 0) return;
    const chartMs = audioManager.chartTime * 1000;
    // Find the section before the current position (with 500ms tolerance)
    const prevSections = sections.filter(s => s.msTime < chartMs - 500);
    if (prevSections.length > 0) {
      const prevSection = prevSections[prevSections.length - 1];
      audioManager.playChartTime(prevSection.msTime / 1000);
    } else {
      // Go to beginning
      audioManager.play({time: 0});
    }
  }, [audioManager, sections]);

  // Keyboard shortcuts via @tanstack/react-hotkeys
  useHotkey('Space', () => {
    togglePlayPause();
  });

  // Plain arrow keys are handled by useEditorKeyboard (grid navigation).
  // Mod+Left/Right live here, not there, so they can call the same
  // jumpToPrevSection/jumpToNextSection handlers the buttons above use.
  useHotkey('Mod+ArrowLeft', () => {
    jumpToPrevSection();
  });

  useHotkey('Mod+ArrowRight', () => {
    jumpToNextSection();
  });

  useHotkey('[', () => {
    stepSpeed(-1);
  });

  useHotkey(']', () => {
    stepSpeed(1);
  });

  return (
    <TooltipProvider delayDuration={300}>
      <div
        ref={containerRef}
        // Layout only. The surface this sits on (dark in both themes, with
        // its own padding) belongs to the caller: `ChartEditor`'s `bottom`
        // grid area, which owns the whole bar between the highway and the
        // piano roll. The foregrounds and hover wash below read the shared
        // `--ed-surface-*` tokens (`app/globals.css`), so they follow that
        // surface rather than restating a color of their own.
        className={`flex items-center gap-2 w-full ${className ?? ''}`}>
        {/* Section skip back */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={TRANSPORT_BUTTON_CLASS}
              onClick={jumpToPrevSection}
              disabled={sections.length === 0}>
              <SkipBack className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            Previous section ({formatForDisplay('Mod+ArrowLeft')})
          </TooltipContent>
        </Tooltip>

        {/* Play/Pause */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={TRANSPORT_BUTTON_CLASS}
              onClick={togglePlayPause}>
              {isPlaying ? (
                <Pause className="h-3.5 w-3.5" />
              ) : (
                <Play className="h-3.5 w-3.5" />
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
              className={TRANSPORT_BUTTON_CLASS}
              onClick={jumpToNextSection}
              disabled={sections.length === 0}>
              <SkipForward className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            Next section ({formatForDisplay('Mod+ArrowRight')})
          </TooltipContent>
        </Tooltip>

        {/* Time display (chart-relative) */}
        <span className="min-w-[5.5rem] text-xs font-mono text-[color:var(--ed-surface-fg-muted)] tabular-nums whitespace-nowrap">
          {formatTime(audioManager.chartTime)} / {formatTime(durationSeconds)}
        </span>

        {/* Slot for waveform or other content between controls */}
        {children ?? <div className="flex-1" />}

        {/* Tool actions: the editor's mode switch and history, at the end of
         *  the bar. Gated by the same capability flag every other tool
         *  affordance uses, so capability-limited pages (preview-only, for
         *  instance) still get a bare transport. */}
        {capabilities.showToolPalette && (
          <div className="flex shrink-0 items-center gap-1">
            <span className="mx-1 h-4 w-px bg-[var(--ed-surface-hover)]" />
            <ToolButton
              mode="cursor"
              icon={MousePointer2}
              label="Cursor"
              hotkey="Mod+1"
            />
            <ToolButton
              mode="place"
              icon={Plus}
              label="Place Note"
              hotkey="Mod+2"
            />
            <span className="mx-1 h-4 w-px bg-[var(--ed-surface-hover)]" />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Undo"
                  className={TRANSPORT_BUTTON_CLASS}
                  disabled={!canUndo}
                  onClick={undo}>
                  <Undo2 className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">
                Undo ({formatForDisplay('Mod+Z')})
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Redo"
                  className={TRANSPORT_BUTTON_CLASS}
                  disabled={!canRedo}
                  onClick={redo}>
                  <Redo2 className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">
                Redo ({formatForDisplay('Mod+Shift+Z')})
              </TooltipContent>
            </Tooltip>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}

/** One tool-mode toggle. The active mode is editor state, so the button is a
 *  view of `state.activeTool` rather than holding a selection of its own. */
function ToolButton({
  mode,
  icon: Icon,
  label,
  hotkey,
}: {
  mode: ToolMode;
  icon: React.ElementType;
  label: string;
  hotkey: string;
}) {
  const {state, dispatch} = useChartEditorContext();
  const active = state.activeTool === mode;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={label}
          aria-pressed={active}
          className={cn(
            TRANSPORT_BUTTON_CLASS,
            active &&
              'bg-[var(--ed-surface-hover)] text-white ring-1 ring-primary',
          )}
          onClick={() => dispatch({type: 'SET_ACTIVE_TOOL', tool: mode})}>
          <Icon className="h-3.5 w-3.5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">
        {label} ({formatForDisplay(hotkey)})
      </TooltipContent>
    </Tooltip>
  );
}
