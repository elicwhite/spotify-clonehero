/**
 * Render the synth backing track for a practice chart into a WAV file.
 *
 * The synth practice modes play through AudioManager — the same clock that
 * drives the highway and sheet-music playhead — so instead of live-scheduling
 * WebAudio voices, we render one loop pass (groove bars with kit + click, fill
 * bars silent) offline at the practice chart's exact ms timing and feed the
 * resulting WAV to AudioManager as a track. This mirrors the sheet-music
 * metronome (generateClickTrack) pattern.
 *
 * The musical decisions (which voice when) reuse the pure, tested
 * {@link scheduleLoopEvents}; the kit synthesis reuses {@link renderEvent} on an
 * OfflineAudioContext. Only `renderBackingWav` touches WebAudio — the event list
 * and buffer sizing are pure and unit-tested.
 */

import {encodeWav} from '@/lib/audio/wav-encoder';
import {
  loopDurationSeconds,
  renderEvent,
  scheduleLoopEvents,
  type BackingPattern,
  type MinimalAudioContext,
  type ScheduledEvent,
} from './backingTrack';

export const BACKING_SAMPLE_RATE = 44100;

/**
 * All backing events for exactly one loop pass, with times in seconds from the
 * chart's t=0. Because the practice chart is authored at the same bpm and bar
 * layout, these times equal the chart's note ms times / 1000.
 */
export function backingEventsForLoop(
  pattern: BackingPattern,
  bpm: number,
): ScheduledEvent[] {
  const loopSec = loopDurationSeconds(pattern, bpm);
  if (loopSec <= 0) return [];
  return scheduleLoopEvents(pattern, {
    bpm,
    startTime: 0,
    windowSeconds: loopSec,
    loopAnchorTime: 0,
  });
}

/** Sample count of the backing WAV: exactly one loop (groove + fill bars). */
export function backingWavSampleCount(
  pattern: BackingPattern,
  bpm: number,
  sampleRate: number = BACKING_SAMPLE_RATE,
): number {
  return Math.max(1, Math.ceil(loopDurationSeconds(pattern, bpm) * sampleRate));
}

/**
 * Render one loop of the backing pattern to a mono 16-bit WAV (browser only —
 * uses OfflineAudioContext).
 */
export async function renderBackingWav(
  pattern: BackingPattern,
  bpm: number,
  sampleRate: number = BACKING_SAMPLE_RATE,
): Promise<Uint8Array> {
  const length = backingWavSampleCount(pattern, bpm, sampleRate);
  const ctx = new OfflineAudioContext(1, length, sampleRate);
  for (const event of backingEventsForLoop(pattern, bpm)) {
    renderEvent(ctx as unknown as MinimalAudioContext, event);
  }
  const buffer = await ctx.startRendering();
  return new Uint8Array(encodeWav(buffer.getChannelData(0), sampleRate, 1));
}
