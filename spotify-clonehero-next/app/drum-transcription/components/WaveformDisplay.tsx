'use client';

import {useCallback, useEffect, useRef} from 'react';
import WaveSurfer from 'wavesurfer.js';
import type {AudioManager} from '@/lib/preview/audioManager';

interface WaveformDisplayProps {
  /** Raw audio data (e.g. drum stem) to visualize as a waveform. */
  audioData: Blob | Uint8Array;
  /** The AudioManager that drives playback timing. */
  audioManager: AudioManager;
  /** Total song duration in seconds. */
  durationSeconds: number;
  /** Optional CSS class for the container. */
  className?: string;
}

/**
 * Waveform visualization using WaveSurfer.js.
 *
 * This component is display-only -- it does NOT play audio. The
 * AudioManager is the single timing authority. WaveSurfer renders
 * the waveform and syncs its cursor position to audioManager.currentTime
 * via requestAnimationFrame.
 *
 * When the user clicks on the waveform, it seeks the AudioManager
 * to the corresponding position.
 */
export default function WaveformDisplay({
  audioData,
  audioManager,
  durationSeconds,
  className,
}: WaveformDisplayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const animationFrameRef = useRef<number>(0);

  // Sync WaveSurfer cursor to AudioManager's current time
  const syncCursor = useCallback(() => {
    const ws = wavesurferRef.current;
    if (!ws || durationSeconds <= 0) return;

    if (audioManager.isPlaying && audioManager.isInitialized) {
      const currentTimeSec = audioManager.currentTime;
      const progress = Math.max(0, Math.min(1, currentTimeSec / durationSeconds));
      ws.seekTo(progress);
    }

    animationFrameRef.current = requestAnimationFrame(syncCursor);
  }, [audioManager, durationSeconds]);

  // Initialize WaveSurfer
  useEffect(() => {
    if (!containerRef.current) return;

    const ws = WaveSurfer.create({
      container: containerRef.current,
      height: 80,
      waveColor: '#4a90d9',
      progressColor: '#1e5aa0',
      cursorColor: '#ef4444',
      cursorWidth: 2,
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      interact: true,
      // No media element -- visualization only, no audio playback
      backend: 'WebAudio',
    });

    wavesurferRef.current = ws;

    // Load audio data for visualization
    const blob =
      audioData instanceof Blob
        ? audioData
        : new Blob([audioData], {type: 'audio/wav'});
    ws.loadBlob(blob);

    // When user clicks the waveform, seek AudioManager
    ws.on('seeking', (progress: number) => {
      const timeSec = progress * durationSeconds;
      audioManager.play({time: timeSec});
    });

    // Mute WaveSurfer's own audio output since AudioManager handles playback
    ws.setVolume(0);

    return () => {
      cancelAnimationFrame(animationFrameRef.current);
      ws.destroy();
      wavesurferRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Start/stop cursor sync loop based on playback state
  useEffect(() => {
    // Start sync loop
    animationFrameRef.current = requestAnimationFrame(syncCursor);

    return () => {
      cancelAnimationFrame(animationFrameRef.current);
    };
  }, [syncCursor]);

  return (
    <div
      className={`rounded-lg border bg-background p-2 ${className ?? ''}`}>
      <div ref={containerRef} className="w-full" />
    </div>
  );
}
