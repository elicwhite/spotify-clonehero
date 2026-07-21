'use client';

import {useEffect, useState} from 'react';
import {Slider} from '@/components/ui/slider';
import {Label} from '@/components/ui/label';
import type {AudioManager} from '@/lib/preview/audioManager';
import {cn} from '@/lib/utils';

interface ClickVolumeControlProps {
  audioManager: AudioManager;
  className?: string;
}

/**
 * Standalone volume slider for the synthesized "click" metronome stem.
 * No configuration menu — just the one slider, defaulting to silent (0)
 * until the user raises it. Renders nothing if the current AudioManager has
 * no click stem (e.g. the chart's audio hadn't decoded yet when the click
 * track was generated).
 *
 * For pages with a full stem-volumes panel (e.g. drum-transcription), the
 * click stem is folded into that panel instead of this component.
 */
export default function ClickVolumeControl({
  audioManager,
  className,
}: ClickVolumeControlProps) {
  const [volume, setVolume] = useState(0);
  const hasClick = audioManager.trackNames.includes('click');

  useEffect(() => {
    if (!hasClick) return;
    audioManager.setVolume('click', volume);
  }, [audioManager, hasClick, volume]);

  if (!hasClick) return null;

  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-lg border bg-background px-3 py-2 text-sm',
        className,
      )}>
      <Label className="text-xs shrink-0 w-12 truncate">Click</Label>
      <Slider
        value={[volume * 100]}
        min={0}
        max={100}
        step={1}
        onValueChange={v => setVolume(v[0] / 100)}
        className="flex-1"
      />
    </div>
  );
}
