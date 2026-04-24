'use client';

import {useCallback} from 'react';
import {formatForDisplay} from '@tanstack/react-hotkeys';
import {Repeat, X} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {useChartEditorContext} from './ChartEditorContext';
import type {AudioManager} from '@/lib/preview/audioManager';
import {cn} from '@/lib/utils';

interface LoopControlsProps {
  audioManager: AudioManager;
  className?: string;
}

/**
 * A-B loop controls for section review.
 *
 * - "Set A" sets loop start at current playback position
 * - "Set B" sets loop end at current playback position
 * - "Clear" removes the loop
 *
 * Uses AudioManager's setPracticeMode() for the actual loop playback.
 */
export default function LoopControls({
  audioManager,
  className,
}: LoopControlsProps) {
  const {state, dispatch} = useChartEditorContext();

  const setLoopStart = useCallback(() => {
    const currentMs = audioManager.currentTime * 1000;
    const endMs = state.loopRegion?.endMs ?? currentMs + 4000;

    const region = {
      startMs: currentMs,
      endMs: Math.max(currentMs + 100, endMs),
    };
    dispatch({type: 'SET_LOOP_REGION', region});

    // Apply to AudioManager
    audioManager.setPracticeMode({
      startMeasureMs: region.startMs,
      endMeasureMs: region.endMs,
      startTimeMs: Math.max(0, region.startMs - 2000),
      endTimeMs: region.endMs,
    });
  }, [state.loopRegion, audioManager, dispatch]);

  const setLoopEnd = useCallback(() => {
    const currentMs = audioManager.currentTime * 1000;
    const startMs = state.loopRegion?.startMs ?? Math.max(0, currentMs - 4000);

    const region = {
      startMs: Math.min(startMs, currentMs - 100),
      endMs: currentMs,
    };
    dispatch({type: 'SET_LOOP_REGION', region});

    audioManager.setPracticeMode({
      startMeasureMs: region.startMs,
      endMeasureMs: region.endMs,
      startTimeMs: Math.max(0, region.startMs - 2000),
      endTimeMs: region.endMs,
    });
  }, [state.loopRegion, audioManager, dispatch]);

  const clearLoop = useCallback(() => {
    dispatch({type: 'SET_LOOP_REGION', region: null});
    audioManager.setPracticeMode(null);
  }, [audioManager, dispatch]);

  const hasLoop = state.loopRegion !== null;

  return (
    <TooltipProvider delayDuration={300}>
      <div className={cn('flex items-center gap-1', className)}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={hasLoop ? 'secondary' : 'ghost'}
              size="sm"
              className={cn(
                'h-7 px-2 text-xs',
                hasLoop && 'ring-1 ring-blue-400',
              )}
              onClick={setLoopStart}>
              A
            </Button>
          </TooltipTrigger>
          <TooltipContent>Set loop start</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={hasLoop ? 'secondary' : 'ghost'}
              size="sm"
              className={cn(
                'h-7 px-2 text-xs',
                hasLoop && 'ring-1 ring-blue-400',
              )}
              onClick={setLoopEnd}>
              B
            </Button>
          </TooltipTrigger>
          <TooltipContent>Set loop end</TooltipContent>
        </Tooltip>

        {hasLoop && (
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-1"
                  onClick={clearLoop}>
                  <X className="h-3 w-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                Clear loop ({formatForDisplay('Mod+L')})
              </TooltipContent>
            </Tooltip>

            <span className="text-[10px] text-muted-foreground font-mono">
              {formatMs(state.loopRegion!.startMs)} -{' '}
              {formatMs(state.loopRegion!.endMs)}
            </span>
          </>
        )}

        {!hasLoop && <Repeat className="h-3.5 w-3.5 text-muted-foreground" />}
      </div>
    </TooltipProvider>
  );
}

function formatMs(ms: number): string {
  const sec = Math.floor(ms / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
