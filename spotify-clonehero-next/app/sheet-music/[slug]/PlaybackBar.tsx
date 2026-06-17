import {RefObject, useState} from 'react';
import useInterval from 'use-interval';
import {Slider} from '@/components/ui/slider';
import {cn} from '@/lib/utils';
import {AudioManager} from '@/lib/preview/audioManager';
import {formatSeconds} from './formatTime';

/**
 * The transport scrubber + elapsed-time readout.
 *
 * This owns the 100ms playback-position polling so the parent SongView does
 * NOT re-render 10x/second. SongView's subtree (the VexFlow notation and the
 * Clone Hero highway) is expensive to reconcile; re-rendering it on every poll
 * dropped a frame every ~100ms, producing a visible 10Hz scroll stutter on
 * slower machines. Keeping the high-frequency state in this leaf confines the
 * re-render to the scrubber.
 */
export default function PlaybackBar({
  audioManagerRef,
  isPlaying,
  setIsPlaying,
  songDuration,
  songLengthMs,
  isMobileMode,
}: {
  audioManagerRef: RefObject<AudioManager | null>;
  isPlaying: boolean;
  setIsPlaying: (playing: boolean) => void;
  songDuration: number;
  songLengthMs: number;
  isMobileMode: boolean;
}) {
  const [currentPlayback, setCurrentPlayback] = useState(0);

  useInterval(
    () => {
      setCurrentPlayback(audioManagerRef.current?.currentTime ?? 0);

      // Check for practice mode looping
      if (audioManagerRef.current && isPlaying) {
        audioManagerRef.current.checkPracticeModeLoop();
      }
    },
    isPlaying ? 100 : null,
  );

  return (
    <div
      className={cn(
        'h-12 border-b flex items-center md:px-4 gap-4 bg-background/95 backdrop-blur-sm',
        'sticky top-[60px] z-30',
        !isMobileMode && 'md:static',
      )}>
      <Slider
        value={[currentPlayback]}
        max={songDuration || 100}
        min={0}
        onValueChange={values => {
          const newTime = values[0];
          setCurrentPlayback(newTime);
          if (audioManagerRef.current) {
            audioManagerRef.current.play({
              time: newTime,
            });
            setIsPlaying(true);
          }
        }}
      />
      <span className="text-sm text-muted-foreground whitespace-nowrap">
        {formatSeconds(currentPlayback)} / {formatSeconds(songLengthMs / 1000)}
      </span>
    </div>
  );
}
