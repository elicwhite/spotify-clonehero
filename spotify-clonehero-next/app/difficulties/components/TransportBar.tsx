'use client';

import {useCallback, useEffect, useState} from 'react';
import {Play, Pause} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Slider} from '@/components/ui/slider';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type {AudioManager} from '@/lib/preview/audioManager';

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5];

function fmt(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * The one shared transport for the whole grid. It drives a single
 * {@link AudioManager}; every highway cell reads that same instance per frame,
 * so nothing here has to touch the grid directly.
 */
export default function TransportBar({
  audioManager,
}: {
  audioManager: AudioManager;
}) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [scrubbing, setScrubbing] = useState(false);

  const duration = audioManager.duration || 0;

  // Poll the audio clock while playing so the scrubber tracks playback. Pausing
  // stops the loop; scrubbing suspends the readout so the thumb follows the drag.
  useEffect(() => {
    if (!isPlaying) return;
    let raf = 0;
    const tick = () => {
      if (!scrubbing) setCurrentTime(audioManager.currentTime);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, scrubbing, audioManager]);

  // A song that plays to the end leaves the AudioManager stopped; reflect it.
  useEffect(() => {
    const id = setInterval(() => {
      if (isPlaying && !audioManager.isPlaying) {
        setIsPlaying(false);
      }
    }, 250);
    return () => clearInterval(id);
  }, [isPlaying, audioManager]);

  const togglePlay = useCallback(() => {
    if (isPlaying) {
      audioManager.pause();
      setIsPlaying(false);
    } else if (!audioManager.isInitialized) {
      audioManager.play({time: currentTime});
      setIsPlaying(true);
    } else {
      audioManager.resume();
      setIsPlaying(true);
    }
  }, [isPlaying, currentTime, audioManager]);

  const onSeek = useCallback(
    (value: number) => {
      setScrubbing(true);
      setCurrentTime(value);
    },
    [],
  );

  const onSeekCommit = useCallback(
    (value: number) => {
      setScrubbing(false);
      setCurrentTime(value);
      if (isPlaying) {
        audioManager.playChartTime(value);
      } else {
        audioManager.seekToChartTime(value);
      }
    },
    [isPlaying, audioManager],
  );

  const onSpeed = useCallback(
    (value: string) => {
      const t = Number(value);
      setSpeed(t);
      audioManager.setTempo(t);
    },
    [audioManager],
  );

  return (
    <div className="flex items-center gap-4 rounded-lg border border-border bg-card/80 px-4 py-3 backdrop-blur">
      <Button
        size="icon"
        variant="secondary"
        onClick={togglePlay}
        aria-label={isPlaying ? 'Pause' : 'Play'}>
        {isPlaying ? (
          <Pause className="h-4 w-4" />
        ) : (
          <Play className="h-4 w-4" />
        )}
      </Button>

      <span className="w-12 text-right font-mono text-xs tabular-nums text-muted-foreground">
        {fmt(currentTime)}
      </span>

      <Slider
        className="flex-1"
        min={0}
        max={Math.max(duration, 0.001)}
        step={0.01}
        value={[Math.min(currentTime, duration)]}
        onValueChange={v => onSeek(v[0])}
        onValueCommit={v => onSeekCommit(v[0])}
      />

      <span className="w-12 font-mono text-xs tabular-nums text-muted-foreground">
        {fmt(duration)}
      </span>

      <Select value={String(speed)} onValueChange={onSpeed}>
        <SelectTrigger className="w-24" aria-label="Playback speed">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SPEEDS.map(s => (
            <SelectItem key={s} value={String(s)}>
              {s}x
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
