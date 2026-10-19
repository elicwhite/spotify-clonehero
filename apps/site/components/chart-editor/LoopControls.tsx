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
import {loopEndRegionAt, loopStartRegionAt} from './piano-roll/loopFlags';
import {cn} from '@/lib/utils';

/** One cell of the segmented control: square corners, a hairline divider
 *  from its neighbour, and no shadow of its own. */
const SEGMENT_CLASS =
  'h-full flex-1 rounded-none px-2 text-[10.5px] font-medium text-muted-foreground shadow-none hover:bg-muted';

interface LoopControlsProps {
  audioManager: AudioManager;
  className?: string;
}

/**
 * A-B loop controls for section review.
 *
 * - "A" sets loop start at the current playhead position
 * - "B" sets loop end at the current playhead position
 * - "Clear" removes the loop
 *
 * Each button carries an accessible name and tooltip naming the interaction
 * (the bare "A"/"B" labels alone don't say what clicking them does).
 *
 * Positions are chart-relative ms — the same time base the piano roll and
 * the highway draw `state.loopRegion` in. Dispatching is the whole job: the
 * editor root carries the region to the engine through `useLoopRegionSync`.
 */
export default function LoopControls({
  audioManager,
  className,
}: LoopControlsProps) {
  const {state, dispatch} = useChartEditorContext();

  const setLoopStart = useCallback(() => {
    const currentMs = audioManager.chartTime * 1000;
    dispatch({
      type: 'SET_LOOP_REGION',
      region: loopStartRegionAt(currentMs, state.loopRegion),
    });
  }, [state.loopRegion, audioManager, dispatch]);

  const setLoopEnd = useCallback(() => {
    const currentMs = audioManager.chartTime * 1000;
    dispatch({
      type: 'SET_LOOP_REGION',
      region: loopEndRegionAt(currentMs, state.loopRegion),
    });
  }, [state.loopRegion, audioManager, dispatch]);

  const clearLoop = useCallback(() => {
    dispatch({type: 'SET_LOOP_REGION', region: null});
  }, [dispatch]);

  const hasLoop = state.loopRegion !== null;

  return (
    <TooltipProvider delayDuration={300}>
      {/* One segmented A | B | clear control, the prototype's `.seg`, rather
       *  than three loose buttons. */}
      <div className={cn('flex items-center gap-1.5', className)}>
        <div className="flex h-7 shrink-0 overflow-hidden rounded-md border">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                aria-label="Set loop start at playhead"
                className={cn(
                  SEGMENT_CLASS,
                  'border-r',
                  hasLoop && 'text-foreground',
                )}
                onClick={setLoopStart}>
                A
              </Button>
            </TooltipTrigger>
            <TooltipContent>Set loop start at playhead</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                aria-label="Set loop end at playhead"
                className={cn(
                  SEGMENT_CLASS,
                  'border-r',
                  hasLoop && 'text-foreground',
                )}
                onClick={setLoopEnd}>
                B
              </Button>
            </TooltipTrigger>
            <TooltipContent>Set loop end at playhead</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                aria-label="Clear loop"
                disabled={!hasLoop}
                className={SEGMENT_CLASS}
                onClick={clearLoop}>
                <X className="h-2.5 w-2.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              Clear loop ({formatForDisplay('Mod+L')})
            </TooltipContent>
          </Tooltip>
        </div>

        {hasLoop ? (
          <span className="text-[10px] text-muted-foreground font-mono">
            {formatMs(state.loopRegion!.startMs)} -{' '}
            {formatMs(state.loopRegion!.endMs)}
          </span>
        ) : (
          <Repeat className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        )}
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
