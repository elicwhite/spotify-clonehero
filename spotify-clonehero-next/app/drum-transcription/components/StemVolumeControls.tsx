'use client';

import {useCallback, useEffect, useState} from 'react';
import {
  Volume2,
  VolumeX,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Slider} from '@/components/ui/slider';
import {Label} from '@/components/ui/label';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {useChartEditorContext} from '@/components/chart-editor/ChartEditorContext';
import type {AudioManager} from '@/lib/preview/audioManager';
import {cn} from '@/lib/utils';

/** Standard stem names the pipeline may produce. */
const STEM_NAMES = ['drums', 'bass', 'other', 'vocals', 'song'] as const;

interface StemVolumeControlsProps {
  audioManager: AudioManager;
  className?: string;
}

/**
 * Per-stem volume controls integrated with ChartEditorContext state.
 *
 * Features:
 * - Volume slider per available stem
 * - Solo button (S) -- mutes all other stems
 * - Mute button (M) -- mutes this stem
 * - D key toggles drums solo, M key toggles drums mute (handled by keyboard hook)
 *
 * Reads/writes trackVolumes, soloTrack, mutedTracks from ChartEditorContext.
 */
export default function StemVolumeControls({
  audioManager,
  className,
}: StemVolumeControlsProps) {
  const {state, dispatch} = useChartEditorContext();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [availableStems, setAvailableStems] = useState<string[]>([]);

  // Detect which stems are available in AudioManager
  useEffect(() => {
    const found: string[] = [];
    for (const stem of STEM_NAMES) {
      try {
        // Try setting volume to current value to probe existence
        audioManager.setVolume(stem, 1.0);
        found.push(stem);
      } catch {
        // Stem not available
      }
    }
    setAvailableStems(found);
  }, [audioManager]);

  // Apply volume changes to AudioManager whenever state changes
  useEffect(() => {
    for (const stem of availableStems) {
      let volume = state.trackVolumes[stem] ?? 1.0;

      // Apply solo logic: if a track is soloed, all others are silent
      if (state.soloTrack !== null && state.soloTrack !== stem) {
        volume = 0;
      }

      // Apply mute logic
      if (state.mutedTracks.has(stem)) {
        volume = 0;
      }

      try {
        audioManager.setVolume(stem, volume);
      } catch {
        // Stem may not exist
      }
    }
  }, [
    audioManager,
    availableStems,
    state.trackVolumes,
    state.soloTrack,
    state.mutedTracks,
  ]);

  const handleVolumeChange = useCallback(
    (stem: string, value: number[]) => {
      dispatch({
        type: 'SET_TRACK_VOLUME',
        track: stem,
        volume: value[0] / 100,
      });
    },
    [dispatch],
  );

  const handleToggleSolo = useCallback(
    (stem: string) => {
      dispatch({
        type: 'SET_SOLO_TRACK',
        track: state.soloTrack === stem ? null : stem,
      });
    },
    [state.soloTrack, dispatch],
  );

  const handleToggleMute = useCallback(
    (stem: string) => {
      dispatch({type: 'TOGGLE_MUTE_TRACK', track: stem});
    },
    [dispatch],
  );

  if (availableStems.length === 0) return null;

  const getEffectiveVolume = (stem: string): number => {
    if (state.mutedTracks.has(stem)) return 0;
    if (state.soloTrack !== null && state.soloTrack !== stem) return 0;
    return state.trackVolumes[stem] ?? 1.0;
  };

  return (
    <TooltipProvider delayDuration={300}>
      <div
        className={cn('rounded-lg border bg-background text-sm', className)}>
        {/* Header */}
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="flex w-full items-center justify-between px-3 py-2 hover:bg-accent/50 transition-colors rounded-t-lg">
          <div className="flex items-center gap-2">
            {isCollapsed ? (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            )}
            <span className="font-semibold text-xs">Stem Volumes</span>
          </div>
          {state.soloTrack && (
            <span className="text-xs text-amber-500 font-medium">
              Solo: {state.soloTrack}
            </span>
          )}
        </button>

        {!isCollapsed && (
          <div className="px-3 pb-3 space-y-2">
            {availableStems.map(stem => {
              const volume = state.trackVolumes[stem] ?? 1.0;
              const isMuted = state.mutedTracks.has(stem);
              const isSoloed = state.soloTrack === stem;
              const effectiveVol = getEffectiveVolume(stem);

              return (
                <div key={stem} className="flex items-center gap-2">
                  {/* Mute toggle */}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={() => handleToggleMute(stem)}
                        className={cn(
                          'shrink-0 text-muted-foreground hover:text-foreground transition-colors',
                          isMuted && 'text-red-400 hover:text-red-300',
                        )}>
                        {effectiveVol === 0 ? (
                          <VolumeX className="h-3.5 w-3.5" />
                        ) : (
                          <Volume2 className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {isMuted ? 'Unmute' : 'Mute'} {stem}
                      {stem === 'drums' ? ' (M)' : ''}
                    </TooltipContent>
                  </Tooltip>

                  {/* Label */}
                  <Label className="text-xs capitalize shrink-0 w-12 truncate">
                    {stem}
                  </Label>

                  {/* Volume slider */}
                  <Slider
                    value={[volume * 100]}
                    min={0}
                    max={100}
                    step={1}
                    onValueChange={v => handleVolumeChange(stem, v)}
                    className="flex-1"
                    disabled={isMuted}
                  />

                  {/* Solo button */}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant={isSoloed ? 'secondary' : 'ghost'}
                        size="sm"
                        className={cn(
                          'h-6 w-6 px-0 text-[10px] font-bold',
                          isSoloed && 'ring-1 ring-amber-400 text-amber-400',
                        )}
                        onClick={() => handleToggleSolo(stem)}>
                        S
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      Solo {stem}
                      {stem === 'drums' ? ' (D)' : ''}
                    </TooltipContent>
                  </Tooltip>
                </div>
              );
            })}

            <p className="text-[10px] text-muted-foreground pt-1">
              <kbd className="px-1 rounded bg-muted">D</kbd> solo drums{' '}
              <kbd className="px-1 rounded bg-muted">M</kbd> mute drums
            </p>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
