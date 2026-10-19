'use client';

import {useEffect, useRef, useState} from 'react';

import type {AudioManager} from '@/lib/preview/audioManager';
import {cn} from '@/lib/utils';
import {backgroundVideoTime} from './backgroundVideoTime';

/** Drift past this is fixed with a seek; anything smaller is eased out. */
const SEEK_DRIFT_SECONDS = 0.5;
/** While paused, the frame follows the playhead to within this. */
const PAUSED_DRIFT_SECONDS = 0.04;
/** The largest share the playback rate is nudged by to ease out drift. */
const MAX_RATE_NUDGE = 0.1;

interface BackgroundVideoProps {
  /** An object URL for the chart's `video.*` file. */
  src: string;
  audioManager: AudioManager;
  /** The chart's `video_start_time`, in seconds. */
  videoStartSeconds: number;
  /**
   * Seconds of leading silence the editor's playback prepends to the stored
   * audio (the chart's `audioAnchor`). The video is synced to the stored
   * audio, so it is taken off the playback clock first.
   */
  audioLeadSeconds: number;
  songDurationSeconds: number;
  className?: string | undefined;
}

/**
 * The chart's video background, kept in step with the editor's playback.
 *
 * The audio clock is the master: every frame the video's position is checked
 * against where `backgroundVideoTime` says it should be. Large drift (a seek,
 * a loop wrap) is a seek; small drift is eased out through the playback rate,
 * because seeking a long video every few frames stalls it. The video is
 * always muted — the song plays through the `AudioManager`.
 */
export default function BackgroundVideo({
  src,
  audioManager,
  videoStartSeconds,
  audioLeadSeconds,
  songDurationSeconds,
  className,
}: BackgroundVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [hasFrame, setHasFrame] = useState(false);
  // Per `src`: the host keys this component on it.
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || failed) return;

    let rafId = 0;
    const tick = () => {
      rafId = requestAnimationFrame(tick);
      if (video.readyState < HTMLMediaElement.HAVE_METADATA) return;

      const target = backgroundVideoTime({
        audioTimeSeconds: audioManager.currentTime - audioLeadSeconds,
        videoStartSeconds,
        videoDurationSeconds: video.duration,
        songDurationSeconds,
      });
      setHasFrame(target != null);
      if (target == null) {
        if (!video.paused) video.pause();
        return;
      }

      const drift = video.currentTime - target;
      const playing = audioManager.isInitialized && audioManager.isPlaying;
      if (!playing) {
        if (!video.paused) video.pause();
        if (Math.abs(drift) > PAUSED_DRIFT_SECONDS && !video.seeking) {
          video.currentTime = target;
        }
        return;
      }

      const tempo = audioManager.getCurrentTempo();
      if (video.paused) {
        video.currentTime = target;
        video.playbackRate = tempo;
        void video.play().catch(() => {
          // Autoplay of a muted video is allowed; a rejection here is an
          // interrupted play() from a seek or pause, and the next frame
          // retries.
        });
        return;
      }
      if (video.seeking) return;
      if (Math.abs(drift) > SEEK_DRIFT_SECONDS) {
        video.currentTime = target;
        return;
      }
      const nudge = Math.max(-MAX_RATE_NUDGE, Math.min(MAX_RATE_NUDGE, drift));
      const rate = tempo * (1 - nudge);
      if (Math.abs(video.playbackRate - rate) > 0.005) {
        video.playbackRate = rate;
      }
    };
    rafId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafId);
      video.pause();
    };
  }, [
    audioManager,
    audioLeadSeconds,
    videoStartSeconds,
    songDurationSeconds,
    failed,
  ]);

  if (failed) return null;

  return (
    <video
      ref={videoRef}
      src={src}
      muted
      playsInline
      preload="auto"
      disablePictureInPicture
      aria-hidden
      onError={() => {
        // A format this browser cannot decode (an .avi, say). The highway
        // keeps its plain backdrop.
        console.warn('Could not play this chart’s video background');
        setFailed(true);
      }}
      className={cn(
        'pointer-events-none absolute inset-0 h-full w-full object-contain transition-opacity duration-200',
        hasFrame ? 'opacity-100' : 'opacity-0',
        className,
      )}
    />
  );
}
