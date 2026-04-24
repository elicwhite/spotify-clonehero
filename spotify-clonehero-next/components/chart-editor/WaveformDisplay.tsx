'use client';

import {useCallback, useEffect, useRef} from 'react';
import type {AudioManager} from '@/lib/preview/audioManager';

interface WaveformDisplayProps {
  /** Raw PCM audio data (Float32 interleaved stereo) to visualize. */
  audioData: Float32Array;
  /** Number of audio channels (1 or 2). */
  channels: number;
  /** The AudioManager that drives playback timing. */
  audioManager: AudioManager;
  /** Total song duration in seconds. */
  durationSeconds: number;
  /** Optional CSS class for the container. */
  className?: string;
}

/** Number of bars to render across the waveform width. */
const BAR_WIDTH = 2;
const BAR_GAP = 1;
const BAR_RADIUS = 2;
const WAVEFORM_HEIGHT = 48;
const WAVE_COLOR = '#4a90d9';
const PROGRESS_COLOR = '#1e5aa0';
const CURSOR_COLOR = '#ef4444';
const CURSOR_WIDTH = 2;

/**
 * Canvas-based waveform display. No WaveSurfer dependency.
 *
 * Renders pre-computed peaks from raw PCM audio data. The played portion
 * is drawn in a darker color to indicate progress. A red cursor line
 * shows the current playback position.
 *
 * AudioManager is the single timing authority — this component reads
 * audioManager.currentTime via requestAnimationFrame for smooth updates.
 * Click-to-seek drives AudioManager.play().
 */
export default function WaveformDisplay({
  audioData,
  channels,
  audioManager,
  durationSeconds,
  className,
}: WaveformDisplayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);
  const peaksRef = useRef<Float32Array | null>(null);
  const lastProgressRef = useRef<number>(-1);

  // Compute peaks from PCM data whenever audioData changes
  const computePeaks = useCallback(
    (width: number): Float32Array => {
      const barCount = Math.floor(width / (BAR_WIDTH + BAR_GAP));
      const peaks = new Float32Array(barCount);
      const totalSamples = audioData.length / channels;
      const samplesPerBar = totalSamples / barCount;

      for (let i = 0; i < barCount; i++) {
        const start = Math.floor(i * samplesPerBar) * channels;
        const end = Math.floor((i + 1) * samplesPerBar) * channels;
        let max = 0;
        for (let j = start; j < end && j < audioData.length; j++) {
          const abs = Math.abs(audioData[j]);
          if (abs > max) max = abs;
        }
        peaks[i] = max;
      }

      return peaks;
    },
    [audioData, channels],
  );

  // Draw the waveform with progress coloring
  const drawWaveform = useCallback((progress: number) => {
    const canvas = canvasRef.current;
    const peaks = peaksRef.current;
    if (!canvas || !peaks) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.width / dpr;
    const height = canvas.height / dpr;
    const barCount = peaks.length;
    const progressX = progress * width;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(dpr, dpr);

    const centerY = height / 2;

    for (let i = 0; i < barCount; i++) {
      const x = i * (BAR_WIDTH + BAR_GAP);
      const barHeight = Math.max(1, peaks[i] * height * 0.9);
      const y = centerY - barHeight / 2;

      ctx.fillStyle = x + BAR_WIDTH <= progressX ? PROGRESS_COLOR : WAVE_COLOR;

      // Rounded rect for each bar
      if (BAR_RADIUS > 0 && barHeight > BAR_RADIUS * 2) {
        ctx.beginPath();
        ctx.roundRect(x, y, BAR_WIDTH, barHeight, BAR_RADIUS);
        ctx.fill();
      } else {
        ctx.fillRect(x, y, BAR_WIDTH, barHeight);
      }
    }

    // Draw cursor line
    if (progress > 0 && progress < 1) {
      ctx.fillStyle = CURSOR_COLOR;
      ctx.fillRect(progressX - CURSOR_WIDTH / 2, 0, CURSOR_WIDTH, height);
    }

    ctx.restore();
  }, []);

  // Set up canvas sizing and compute peaks
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const resizeObserver = new ResizeObserver(entries => {
      for (const entry of entries) {
        const width = entry.contentRect.width;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = width * dpr;
        canvas.height = WAVEFORM_HEIGHT * dpr;
        canvas.style.width = `${width}px`;
        canvas.style.height = `${WAVEFORM_HEIGHT}px`;

        peaksRef.current = computePeaks(width);
        lastProgressRef.current = -1; // Force redraw
        drawWaveform(0);
      }
    });

    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, [computePeaks, drawWaveform]);

  // Animation frame loop — reads audioManager.currentTime directly
  useEffect(() => {
    function tick() {
      if (durationSeconds > 0) {
        const currentTime = audioManager.currentTime;
        const progress = Math.max(
          0,
          Math.min(1, currentTime / durationSeconds),
        );

        // Only redraw if progress changed meaningfully (avoid unnecessary draws)
        if (Math.abs(progress - lastProgressRef.current) > 0.0005) {
          lastProgressRef.current = progress;
          drawWaveform(progress);
        }
      }
      animFrameRef.current = requestAnimationFrame(tick);
    }

    animFrameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [audioManager, durationSeconds, drawWaveform]);

  // Click to seek
  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas || durationSeconds <= 0) return;

      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const progress = x / rect.width;
      const time = Math.max(
        0,
        Math.min(durationSeconds, progress * durationSeconds),
      );
      audioManager.play({time});
    },
    [audioManager, durationSeconds],
  );

  return (
    <div ref={containerRef} className={className ?? ''}>
      <canvas
        ref={canvasRef}
        className="w-full cursor-pointer"
        style={{height: WAVEFORM_HEIGHT}}
        onClick={handleClick}
      />
    </div>
  );
}
