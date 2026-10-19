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
import SnapControl from './SnapControl';
import {useUndoRedo} from './hooks/useEditCommands';
import {usePlaybackSpeed} from './hooks/usePlaybackSpeed';
import {cn} from '@/lib/utils';

/**
 * How often the transport readout re-reads `AudioManager` while stopped.
 * Matches the piano roll's and the highway stage's idle poll, so every surface
 * catches an outside seek in the same tick.
 */
const TRANSPORT_IDLE_POLL_MS = 120;

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
  /** Exact playback position, for the cold-start seek below. Held in a ref
   *  because nothing renders it — the readout reads `audioManager.chartTime`
   *  directly — so tracking it in state would re-render on every frame. */
  const currentTimeRef = useRef(0);
  /** The whole second the readout is showing. Re-rendering the transport is
   *  what refreshes the readout, and the readout only ever shows whole
   *  seconds, so this changes 1x per second rather than 1x per frame. The
   *  bar carries a row of tooltips, and re-rendering those every frame cost
   *  more main thread than the piano roll's entire grid. */
  const [, setDisplaySecond] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const {capabilities} = useChartEditorContext();
  const {undo, redo, canUndo, canRedo} = useUndoRedo();
  // Playback speed is one editor-wide value with one ladder: the sidebar's
  // stepper and this bar's hotkeys are two surfaces on the same hook.
  const {step: stepSpeed} = usePlaybackSpeed(audioManager);

  // Poll AudioManager to drive the time/playing displays. Every frame while
  // the transport is running, because the readout counts up with the audio;
  // a low-rate poll while it is stopped, where the only thing that can move
  // the readout is a seek, and the display is only accurate to the second
  // anyway. Same shape and same rate as the piano roll's idle poll.
  //
  // Keep the loop functions and their handles local to the effect so none of
  // them needs to reference itself through a closure.
  const kickTransportPollRef = useRef<() => void>(() => {});
  useEffect(() => {
    let rafId = 0;
    let intervalId: ReturnType<typeof setInterval> | null = null;
    let mode: 'raf' | 'idle' | null = null;

    const sample = () => {
      if (audioManager.isInitialized) {
        currentTimeRef.current = Math.min(
          audioManager.currentTime,
          durationSeconds,
        );
      }
      const chartSecond = Math.floor(audioManager.chartTime);
      setDisplaySecond(Number.isFinite(chartSecond) ? chartSecond : 0);
      setIsPlaying(audioManager.isPlaying);
    };

    const switchToIdle = () => {
      if (mode === 'idle') return;
      mode = 'idle';
      intervalId = setInterval(idleTick, TRANSPORT_IDLE_POLL_MS);
    };

    const switchToRaf = () => {
      if (mode === 'raf') return;
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
      mode = 'raf';
      rafId = requestAnimationFrame(rafTick);
    };

    function rafTick() {
      sample();
      if (audioManager.isPlaying) rafId = requestAnimationFrame(rafTick);
      else switchToIdle();
    }

    function idleTick() {
      sample();
      if (audioManager.isPlaying) switchToRaf();
    }

    // The controls that start playback themselves call this, so the readout
    // switches over on the same tick instead of waiting for the idle poll.
    kickTransportPollRef.current = () => {
      sample();
      if (audioManager.isPlaying) switchToRaf();
    };

    if (audioManager.isPlaying) switchToRaf();
    else switchToIdle();
    sample();

    return () => {
      kickTransportPollRef.current = () => {};
      if (rafId) cancelAnimationFrame(rafId);
      if (intervalId !== null) clearInterval(intervalId);
    };
  }, [audioManager, durationSeconds]);

  // Play/Pause toggle
  const togglePlayPause = useCallback(async () => {
    if (audioManager.isPlaying) {
      await audioManager.pause();
    } else if (audioManager.isInitialized) {
      await audioManager.resume();
    } else {
      await audioManager.play({time: currentTimeRef.current});
    }
    kickTransportPollRef.current();
  }, [audioManager]);

  // Section jumping
  // Section msTime values are chart time — use playChartTime for seeking
  // and chartTime for comparison.
  const jumpToNextSection = useCallback(async () => {
    if (sections.length === 0) return;
    const chartMs = audioManager.chartTime * 1000;
    const nextSection = sections.find(s => s.msTime > chartMs + 100);
    if (!nextSection) return;
    await audioManager.playChartTime(nextSection.msTime / 1000);
    kickTransportPollRef.current();
  }, [audioManager, sections]);

  const jumpToPrevSection = useCallback(async () => {
    if (sections.length === 0) return;
    const chartMs = audioManager.chartTime * 1000;
    // Find the section before the current position (with 500ms tolerance)
    const prevSections = sections.filter(s => s.msTime < chartMs - 500);
    if (prevSections.length > 0) {
      const prevSection = prevSections[prevSections.length - 1];
      await audioManager.playChartTime(prevSection.msTime / 1000);
    } else {
      // Go to beginning
      await audioManager.play({time: 0});
    }
    kickTransportPollRef.current();
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
        {/* Snap sits with the tools rather than in the sidebar: it changes
         *  what the next click does, so it belongs beside the mode switch it
         *  modifies. Gated on editing, not the tool palette — a page can snap
         *  without placing notes. */}
        {capabilities.showEditingControls && (
          <div className="flex shrink-0 items-center">
            <span className="mx-1 h-4 w-px bg-[var(--ed-surface-hover)]" />
            <SnapControl />
          </div>
        )}

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
