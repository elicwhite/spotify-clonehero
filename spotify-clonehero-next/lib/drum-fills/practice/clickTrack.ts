/**
 * Render a metronome click track into a WAV for latency calibration.
 *
 * Calibration must measure the *same* latency that scoring sees. Scoring anchors
 * hits to {@link AudioManager.chartTime} — the audio sample position, which leads
 * the audible sound by the output latency — so a hit played in time lands late
 * by that latency. To measure exactly that, the calibration click plays through
 * a real AudioManager (same audio path, same `chartTime` clock) rather than a
 * standalone AudioContext. This module renders the click track offline; the
 * click voice reuses {@link renderEvent}, matching the synth backing track.
 *
 * Click i sounds at `leadInSec + i * intervalSec` in chart time. The buffer adds
 * a tail so the final tap has time to land before playback ends.
 */

import {encodeWav} from '@/lib/audio/wav-encoder';
import {renderEvent, type MinimalAudioContext} from './backingTrack';

export const CLICK_SAMPLE_RATE = 44100;

/** Chart-time (seconds) of each click. */
export function clickTrackTimesSec(
  count: number,
  intervalSec: number,
  leadInSec: number,
): number[] {
  const times: number[] = [];
  for (let i = 0; i < count; i++) {
    times.push(leadInSec + i * intervalSec);
  }
  return times;
}

/** Total sample count: lead-in + all clicks + tail. */
export function clickTrackSampleCount(
  count: number,
  intervalSec: number,
  leadInSec: number,
  tailSec: number,
  sampleRate: number = CLICK_SAMPLE_RATE,
): number {
  const lastClick = count > 0 ? leadInSec + (count - 1) * intervalSec : 0;
  return Math.max(1, Math.ceil((lastClick + tailSec) * sampleRate));
}

export interface ClickTrack {
  /** Mono 16-bit WAV bytes. */
  wav: Uint8Array;
  /** Chart-time (seconds) of each click, for pairing against hits. */
  clickTimesSec: number[];
}

/**
 * Render the click track to a mono 16-bit WAV (browser only — uses
 * OfflineAudioContext).
 */
export async function renderClickTrackWav(
  count: number,
  intervalSec: number,
  leadInSec: number,
  tailSec: number,
  sampleRate: number = CLICK_SAMPLE_RATE,
): Promise<ClickTrack> {
  const clickTimesSec = clickTrackTimesSec(count, intervalSec, leadInSec);
  const length = clickTrackSampleCount(
    count,
    intervalSec,
    leadInSec,
    tailSec,
    sampleRate,
  );
  const ctx = new OfflineAudioContext(1, length, sampleRate);
  for (const time of clickTimesSec) {
    renderEvent(ctx as unknown as MinimalAudioContext, {time, voice: 'click'});
  }
  const buffer = await ctx.startRendering();
  const wav = new Uint8Array(encodeWav(buffer.getChannelData(0), sampleRate, 1));
  return {wav, clickTimesSec};
}
