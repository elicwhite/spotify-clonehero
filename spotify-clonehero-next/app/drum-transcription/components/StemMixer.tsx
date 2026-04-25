'use client';

import {useCallback, useState} from 'react';
import {Volume2, VolumeX, Drum} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Slider} from '@/components/ui/slider';
import {Label} from '@/components/ui/label';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type {AudioManager} from '@/lib/preview/audioManager';

/** Standard stem names that AudioManager may have. */
const ALL_STEMS = [
  'drums',
  'song',
  'guitar',
  'bass',
  'rhythm',
  'keys',
  'vocals',
] as const;

interface StemMixerProps {
  audioManager: AudioManager;
  /** List of available stem names. If not provided, tries all standard stems. */
  availableStems?: string[];
  /** Optional CSS class for the container. */
  className?: string;
}

/**
 * Per-stem volume controls using audioManager.setVolume().
 *
 * Features:
 * - Individual volume sliders for each available stem
 * - Mute/unmute toggle per stem
 * - "Drums Only" preset (mutes everything except drums)
 * - "Full Mix" preset (restores all stems to default volume)
 */
export default function StemMixer({
  audioManager,
  availableStems,
  className,
}: StemMixerProps) {
  const stems = availableStems ?? (ALL_STEMS as unknown as string[]);

  // Track volume state for each stem
  const [volumes, setVolumes] = useState<Record<string, number>>(() => {
    const initial: Record<string, number> = {};
    for (const stem of stems) {
      initial[stem] = 1.0;
    }
    return initial;
  });

  // Track mute state (stores pre-mute volume)
  const [mutedVolumes, setMutedVolumes] = useState<Record<string, number>>({});

  const applyVolume = useCallback(
    (stem: string, volume: number) => {
      try {
        audioManager.setVolume(stem, volume);
      } catch {
        // Stem may not exist in AudioManager
      }
    },
    [audioManager],
  );

  const handleVolumeChange = useCallback(
    (stem: string, value: number[]) => {
      const vol = value[0] / 100;
      setVolumes(prev => ({...prev, [stem]: vol}));
      setMutedVolumes(prev => {
        const next = {...prev};
        delete next[stem];
        return next;
      });
      applyVolume(stem, vol);
    },
    [applyVolume],
  );

  const toggleMute = useCallback(
    (stem: string) => {
      if (mutedVolumes[stem] !== undefined) {
        // Unmute: restore previous volume
        const restored = mutedVolumes[stem];
        setVolumes(prev => ({...prev, [stem]: restored}));
        setMutedVolumes(prev => {
          const next = {...prev};
          delete next[stem];
          return next;
        });
        applyVolume(stem, restored);
      } else {
        // Mute: save current volume and set to 0
        setMutedVolumes(prev => ({...prev, [stem]: volumes[stem]}));
        setVolumes(prev => ({...prev, [stem]: 0}));
        applyVolume(stem, 0);
      }
    },
    [volumes, mutedVolumes, applyVolume],
  );

  // Drums only preset
  const drumsOnly = useCallback(() => {
    const newVolumes: Record<string, number> = {};
    for (const stem of stems) {
      const vol = stem === 'drums' ? 1.0 : 0.0;
      newVolumes[stem] = vol;
      applyVolume(stem, vol);
    }
    setVolumes(newVolumes);
    setMutedVolumes({});
  }, [stems, applyVolume]);

  // Full mix preset
  const fullMix = useCallback(() => {
    const newVolumes: Record<string, number> = {};
    for (const stem of stems) {
      const vol = stem === 'drums' ? 1.0 : 0.8;
      newVolumes[stem] = vol;
      applyVolume(stem, vol);
    }
    setVolumes(newVolumes);
    setMutedVolumes({});
  }, [stems, applyVolume]);

  const isMuted = (stem: string) =>
    mutedVolumes[stem] !== undefined || volumes[stem] === 0;

  return (
    <TooltipProvider delayDuration={300}>
      <div
        className={`flex items-center gap-4 rounded-lg border bg-background px-4 py-2 ${className ?? ''}`}>
        {/* Preset buttons */}
        <div className="flex gap-1 shrink-0">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={drumsOnly}>
                <Drum className="h-3 w-3 mr-1" />
                Solo
              </Button>
            </TooltipTrigger>
            <TooltipContent>Drums only (mute other stems)</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={fullMix}>
                <Volume2 className="h-3 w-3 mr-1" />
                Mix
              </Button>
            </TooltipTrigger>
            <TooltipContent>Full mix (restore all stems)</TooltipContent>
          </Tooltip>
        </div>

        {/* Per-stem volume controls */}
        <div className="flex items-center gap-4 flex-1 overflow-x-auto">
          {stems.map(stem => (
            <div key={stem} className="flex items-center gap-2 min-w-[140px]">
              <button
                onClick={() => toggleMute(stem)}
                className="shrink-0 text-muted-foreground hover:text-foreground transition-colors">
                {isMuted(stem) ? (
                  <VolumeX className="h-3.5 w-3.5" />
                ) : (
                  <Volume2 className="h-3.5 w-3.5" />
                )}
              </button>
              <Label className="text-xs capitalize shrink-0 w-12 truncate">
                {stem}
              </Label>
              <Slider
                value={[volumes[stem] * 100]}
                min={0}
                max={100}
                step={1}
                onValueChange={v => handleVolumeChange(stem, v)}
                className="w-[70px]"
              />
            </div>
          ))}
        </div>
      </div>
    </TooltipProvider>
  );
}
