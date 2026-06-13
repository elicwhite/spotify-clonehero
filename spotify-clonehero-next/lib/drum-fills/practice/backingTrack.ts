/**
 * WebAudio-synthesized backing track for the isolated / roulette practice modes.
 *
 * Plays a synthesized kit (kick / snare / hat) plus a click for a groove pattern
 * over N bars, then leaves the fill bar(s) empty (space for the player to play
 * the fill), looping at an arbitrary BPM.
 *
 * The scheduling logic — turning a groove pattern + tempo + bar layout into a
 * flat list of timed events with a lookahead window — is a pure function
 * ({@link scheduleLoopEvents}) so it can be unit-tested without WebAudio. The
 * thin WebAudio layer ({@link BackingTrackPlayer}) only turns those events into
 * oscillator/noise voices on a provided AudioContext.
 */

/** Voices the synthesized kit can produce. */
export type BackingVoice = 'kick' | 'snare' | 'hat' | 'click';

/**
 * One groove hit, positioned within a bar.
 * `beatOffset` is in beats from the start of the bar (e.g. 0, 0.5, 1, 1.5…).
 */
export type GrooveHit = {
  beatOffset: number;
  lane: BackingVoice;
};

/** A scheduled, absolute-time event (seconds, in AudioContext time domain). */
export type ScheduledEvent = {
  time: number;
  voice: BackingVoice;
};

export type BackingPattern = {
  /** Hits making up one bar of the looping groove. */
  groove: GrooveHit[];
  /** Beats per bar (time-signature numerator over a quarter-note pulse). */
  beatsPerBar: number;
  /** Number of groove bars before the empty fill space. */
  grooveBars: number;
  /** Number of empty bars left for the fill. */
  fillBars: number;
  /** Whether to layer a click on every beat. */
  click: boolean;
};

export type ScheduleParams = {
  /** Tempo in quarter-note BPM. */
  bpm: number;
  /** AudioContext time (seconds) at which the window starts. */
  startTime: number;
  /** Length of the window to schedule, in seconds. */
  windowSeconds: number;
  /**
   * AudioContext time (seconds) of loop bar-0, beat-0. Events strictly before
   * `startTime` (already past) are not emitted; this anchor keeps the loop phase
   * stable across successive scheduling windows.
   */
  loopAnchorTime: number;
};

/** Duration of one full loop (groove bars + fill bars) in seconds. */
export function loopDurationSeconds(
  pattern: BackingPattern,
  bpm: number,
): number {
  const totalBars = pattern.grooveBars + pattern.fillBars;
  const secondsPerBeat = 60 / bpm;
  return totalBars * pattern.beatsPerBar * secondsPerBeat;
}

/**
 * The fill window within one loop, in loop-relative seconds: it opens at the
 * end of the groove bars and closes at the end of the loop (the empty fill
 * bars are the space the player fills).
 */
export function fillWindowSeconds(
  pattern: BackingPattern,
  bpm: number,
): {start: number; end: number} {
  const secondsPerBeat = 60 / bpm;
  return {
    start: pattern.grooveBars * pattern.beatsPerBar * secondsPerBeat,
    end: loopDurationSeconds(pattern, bpm),
  };
}

/**
 * Build the events for one full loop starting at `loopStart`.
 * Click hits land on every integer beat across the groove bars only; groove
 * hits land at their `beatOffset` within each groove bar. Fill bars are empty.
 */
function eventsForLoop(
  pattern: BackingPattern,
  bpm: number,
  loopStart: number,
): ScheduledEvent[] {
  const secondsPerBeat = 60 / bpm;
  const events: ScheduledEvent[] = [];

  for (let bar = 0; bar < pattern.grooveBars; bar++) {
    const barStartBeat = bar * pattern.beatsPerBar;

    if (pattern.click) {
      for (let beat = 0; beat < pattern.beatsPerBar; beat++) {
        events.push({
          time: loopStart + (barStartBeat + beat) * secondsPerBeat,
          voice: 'click',
        });
      }
    }

    for (const hit of pattern.groove) {
      events.push({
        time: loopStart + (barStartBeat + hit.beatOffset) * secondsPerBeat,
        voice: hit.lane,
      });
    }
  }

  // Fill bars: intentionally no events (silence/space for the player).
  return events;
}

/**
 * Schedule all backing events whose time falls within
 * `[startTime, startTime + windowSeconds)`, accounting for looping.
 *
 * Pure: depends only on its arguments. Events are returned sorted by time.
 */
export function scheduleLoopEvents(
  pattern: BackingPattern,
  params: ScheduleParams,
): ScheduledEvent[] {
  const {bpm, startTime, windowSeconds, loopAnchorTime} = params;
  const windowEnd = startTime + windowSeconds;
  const loopDur = loopDurationSeconds(pattern, bpm);

  if (loopDur <= 0) return [];

  // Find the loop iteration that contains (or precedes) the window start, so we
  // also catch events earlier in that loop that still fall inside the window.
  const firstLoopIndex = Math.floor((startTime - loopAnchorTime) / loopDur);

  const events: ScheduledEvent[] = [];
  for (let loop = firstLoopIndex; ; loop++) {
    const loopStart = loopAnchorTime + loop * loopDur;
    if (loopStart >= windowEnd) break;

    for (const ev of eventsForLoop(pattern, bpm, loopStart)) {
      if (ev.time >= startTime && ev.time < windowEnd) {
        events.push(ev);
      }
    }
  }

  events.sort((a, b) => a.time - b.time);
  return events;
}

// ---------------------------------------------------------------------------
// Thin WebAudio layer
// ---------------------------------------------------------------------------

/** Minimal AudioContext surface used by the player (eases testing/mocking). */
export type MinimalAudioContext = Pick<
  AudioContext,
  | 'createOscillator'
  | 'createGain'
  | 'createBufferSource'
  | 'createBiquadFilter'
> & {
  readonly currentTime: number;
  readonly sampleRate: number;
  readonly destination: AudioNode;
  createBuffer(
    numberOfChannels: number,
    length: number,
    sampleRate: number,
  ): AudioBuffer;
};

function playKick(ctx: MinimalAudioContext, time: number, gain: number): void {
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(150, time);
  osc.frequency.exponentialRampToValueAtTime(50, time + 0.12);
  env.gain.setValueAtTime(gain, time);
  env.gain.exponentialRampToValueAtTime(0.001, time + 0.18);
  osc.connect(env).connect(ctx.destination);
  osc.start(time);
  osc.stop(time + 0.2);
}

function makeNoiseBuffer(
  ctx: MinimalAudioContext,
  seconds: number,
): AudioBuffer {
  const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  return buffer;
}

function playSnare(ctx: MinimalAudioContext, time: number, gain: number): void {
  const src = ctx.createBufferSource();
  src.buffer = makeNoiseBuffer(ctx, 0.2);
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 1800;
  const env = ctx.createGain();
  env.gain.setValueAtTime(gain, time);
  env.gain.exponentialRampToValueAtTime(0.001, time + 0.15);
  src.connect(filter).connect(env).connect(ctx.destination);
  src.start(time);
  src.stop(time + 0.2);
}

function playHat(ctx: MinimalAudioContext, time: number, gain: number): void {
  const src = ctx.createBufferSource();
  src.buffer = makeNoiseBuffer(ctx, 0.05);
  const filter = ctx.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.value = 7000;
  const env = ctx.createGain();
  env.gain.setValueAtTime(gain, time);
  env.gain.exponentialRampToValueAtTime(0.001, time + 0.04);
  src.connect(filter).connect(env).connect(ctx.destination);
  src.start(time);
  src.stop(time + 0.06);
}

function playClick(ctx: MinimalAudioContext, time: number, gain: number): void {
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.type = 'square';
  osc.frequency.setValueAtTime(1000, time);
  env.gain.setValueAtTime(gain, time);
  env.gain.exponentialRampToValueAtTime(0.001, time + 0.03);
  osc.connect(env).connect(ctx.destination);
  osc.start(time);
  osc.stop(time + 0.04);
}

const VOICE_GAIN: Record<BackingVoice, number> = {
  kick: 0.9,
  snare: 0.6,
  hat: 0.3,
  click: 0.25,
};

/** Render a single scheduled event onto the AudioContext. */
export function renderEvent(
  ctx: MinimalAudioContext,
  event: ScheduledEvent,
): void {
  const gain = VOICE_GAIN[event.voice];
  switch (event.voice) {
    case 'kick':
      playKick(ctx, event.time, gain);
      break;
    case 'snare':
      playSnare(ctx, event.time, gain);
      break;
    case 'hat':
      playHat(ctx, event.time, gain);
      break;
    case 'click':
      playClick(ctx, event.time, gain);
      break;
  }
}

export type BackingTrackPlayerOptions = {
  /** How far ahead (seconds) to schedule on each tick. */
  lookaheadSeconds: number;
  /** How often (ms) to run the scheduling tick. */
  tickIntervalMs: number;
};

export const DEFAULT_PLAYER_OPTIONS: BackingTrackPlayerOptions = {
  lookaheadSeconds: 0.25,
  tickIntervalMs: 50,
};

/**
 * Thin driver that repeatedly calls {@link scheduleLoopEvents} over a lookahead
 * window and renders the resulting events via WebAudio. All musical decisions
 * live in the pure scheduler; this class only manages the timer and audio nodes.
 */
export class BackingTrackPlayer {
  private readonly ctx: MinimalAudioContext;
  private readonly pattern: BackingPattern;
  private readonly bpm: number;
  private readonly opts: BackingTrackPlayerOptions;

  private anchorTime = 0;
  private scheduledUntil = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    ctx: MinimalAudioContext,
    pattern: BackingPattern,
    bpm: number,
    options: Partial<BackingTrackPlayerOptions> = {},
  ) {
    this.ctx = ctx;
    this.pattern = pattern;
    this.bpm = bpm;
    this.opts = {...DEFAULT_PLAYER_OPTIONS, ...options};
  }

  start(): void {
    if (this.timer !== null) return;
    this.anchorTime = this.ctx.currentTime;
    this.scheduledUntil = this.anchorTime;
    this.tick();
    this.timer = setInterval(() => this.tick(), this.opts.tickIntervalMs);
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Position within the current loop, in seconds from bar-0 beat-0, or null
   * when the player is stopped. Lets callers (e.g. live scoring) track where
   * the playhead sits relative to the groove/fill window.
   */
  loopPositionSeconds(): number | null {
    if (this.timer === null) return null;
    const loopDur = loopDurationSeconds(this.pattern, this.bpm);
    if (loopDur <= 0) return null;
    const elapsed = this.ctx.currentTime - this.anchorTime;
    if (elapsed < 0) return 0;
    return elapsed % loopDur;
  }

  private tick(): void {
    const windowStart = Math.max(this.ctx.currentTime, this.scheduledUntil);
    const windowEnd = this.ctx.currentTime + this.opts.lookaheadSeconds;
    const windowSeconds = windowEnd - windowStart;
    if (windowSeconds <= 0) return;

    const events = scheduleLoopEvents(this.pattern, {
      bpm: this.bpm,
      startTime: windowStart,
      windowSeconds,
      loopAnchorTime: this.anchorTime,
    });

    for (const event of events) {
      renderEvent(this.ctx, event);
    }
    this.scheduledUntil = windowEnd;
  }
}
