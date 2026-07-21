/**
 * Metronome click track generation, shared by every page that plays a
 * synthesized click alongside chart audio (sheet-music's configurable click
 * track, the chart-editor's single-volume click stem).
 *
 * Two layers:
 * - Low-level primitives (`generateClickSample`, `mixSamples`, `float32ToWav`)
 *   — oscillator-based click synthesis and PCM→WAV encoding, independent of
 *   how click times are computed.
 * - `buildBeatClickEvents` / `generateBeatClickTrackWav` — a tempo-map +
 *   time-signature-driven click schedule (one event per beat, accented on
 *   the first beat of each measure), for callers that only have the chart's
 *   tempo map (no VexFlow measure layout).
 */

export interface TempoMapEntry {
  tick: number;
  beatsPerMinute: number;
  msTime: number;
}

export interface TimeSignatureEntry {
  tick: number;
  numerator: number;
  denominator: number;
}

export interface BeatClickEvent {
  /** When the click should occur, in ms, relative to the audio track
   *  (i.e. already shifted by chartDelayMs). */
  timeMs: number;
  /** True for the first beat of a measure (downbeat). */
  accent: boolean;
}

/**
 * Generates a click sample using an oscillator with a quick attack/release
 * envelope.
 */
export async function generateClickSample(
  frequency: number,
  durationSec: number,
  sampleRate: number,
  volume: number,
): Promise<Float32Array> {
  const offlineCtx = new (window.OfflineAudioContext ||
    window['webkitOfflineAudioContext'])(
    1,
    sampleRate * durationSec,
    sampleRate,
  );

  const oscillator = offlineCtx.createOscillator();
  oscillator.frequency.value = frequency;

  const gainNode = offlineCtx.createGain();
  gainNode.gain.setValueAtTime(0, 0);
  gainNode.gain.linearRampToValueAtTime(volume, 0.005);
  gainNode.gain.setValueAtTime(volume, durationSec - 0.005);
  gainNode.gain.linearRampToValueAtTime(0, durationSec);

  oscillator.connect(gainNode);
  gainNode.connect(offlineCtx.destination);

  oscillator.start(0);
  oscillator.stop(durationSec);

  const audioBuffer = await offlineCtx.startRendering();
  return audioBuffer.getChannelData(0).slice();
}

/**
 * Mixes a source sample into a target buffer at the given sample offset.
 */
export function mixSamples(
  target: Float32Array,
  source: Float32Array,
  offset: number,
): void {
  for (let i = 0; i < source.length; i++) {
    const targetIndex = offset + i;
    if (targetIndex >= 0 && targetIndex < target.length) {
      target[targetIndex] += source[i];
    }
  }
}

/**
 * Converts a mono Float32Array of PCM samples into a 16-bit PCM WAV file
 * stored in a Uint8Array.
 */
export function float32ToWav(
  samples: Float32Array,
  sampleRate: number,
): Uint8Array {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = samples.length * blockAlign;
  const headerSize = 44;
  const totalSize = headerSize + dataSize;

  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);
  let offset = 0;

  function writeString(s: string) {
    for (let i = 0; i < s.length; i++) {
      view.setUint8(offset++, s.charCodeAt(i));
    }
  }

  function writeUint32(value: number) {
    view.setUint32(offset, value, true);
    offset += 4;
  }

  function writeUint16(value: number) {
    view.setUint16(offset, value, true);
    offset += 2;
  }

  writeString('RIFF');
  writeUint32(totalSize - 8);
  writeString('WAVE');

  writeString('fmt ');
  writeUint32(16);
  writeUint16(1);
  writeUint16(numChannels);
  writeUint32(sampleRate);
  writeUint32(byteRate);
  writeUint16(blockAlign);
  writeUint16(bitsPerSample);

  writeString('data');
  writeUint32(dataSize);

  for (let i = 0; i < samples.length; i++) {
    let s = samples[i];
    s = Math.max(-1, Math.min(1, s));
    const int16 = s < 0 ? s * 0x8000 : s * 0x7fff;
    view.setInt16(offset, int16, true);
    offset += 2;
  }

  return new Uint8Array(buffer);
}

/** Converts a tick position to ms using a sorted tempo map. */
function tickToMsFromTempos(
  tempos: TempoMapEntry[],
  resolution: number,
  tick: number,
): number {
  let currentTempo = tempos[0];
  for (let i = 0; i < tempos.length; i++) {
    if (tempos[i].tick <= tick) {
      currentTempo = tempos[i];
    } else {
      break;
    }
  }
  const ticksSinceTempo = tick - currentTempo.tick;
  const msPerTick = 60000 / currentTempo.beatsPerMinute / resolution;
  return currentTempo.msTime + ticksSinceTempo * msPerTick;
}

/**
 * Builds one click event per beat (per the active time signature's
 * denominator), accenting the first beat of each measure, from tick 0 up to
 * `durationMs` (audio-track-relative — i.e. `chartDelayMs` has already been
 * applied to each event's `timeMs`).
 *
 * Pure function of the tempo map + time-signature list — no audio APIs, so
 * it's directly unit-testable.
 */
export function buildBeatClickEvents({
  tempos,
  timeSignatures,
  resolution,
  durationMs,
  chartDelayMs = 0,
}: {
  tempos: TempoMapEntry[];
  timeSignatures: TimeSignatureEntry[];
  resolution: number;
  durationMs: number;
  chartDelayMs?: number;
}): BeatClickEvent[] {
  if (tempos.length === 0 || durationMs <= 0) return [];

  const sortedTimeSignatures =
    timeSignatures.length > 0
      ? [...timeSignatures].sort((a, b) => a.tick - b.tick)
      : [{tick: 0, numerator: 4, denominator: 4}];

  const events: BeatClickEvent[] = [];

  outer: for (let i = 0; i < sortedTimeSignatures.length; i++) {
    const sig = sortedTimeSignatures[i];
    const segmentEndTick =
      i + 1 < sortedTimeSignatures.length
        ? sortedTimeSignatures[i + 1].tick
        : Infinity;
    const beatTicks = (resolution * 4) / sig.denominator;
    if (beatTicks <= 0) continue;

    let tick = sig.tick;
    let beatIndex = 0;
    while (tick < segmentEndTick) {
      const timeMs =
        tickToMsFromTempos(tempos, resolution, tick) + chartDelayMs;
      if (timeMs > durationMs) break outer;
      if (timeMs >= 0) {
        events.push({timeMs, accent: beatIndex % sig.numerator === 0});
      }
      tick += beatTicks;
      beatIndex++;
    }
  }

  return events;
}

/**
 * Generates a click track WAV (mono, 8kHz) covering `durationMs` of
 * audio-track-relative time, with one click per beat (accented downbeats),
 * derived from the chart's tempo map and time signatures. Loudness is not
 * baked in — the caller controls volume in real time via
 * `AudioManager.setVolume('click', ...)`, matching every other stem.
 */
export async function generateBeatClickTrackWav(
  chart: {
    tempos: TempoMapEntry[];
    timeSignatures: TimeSignatureEntry[];
    resolution: number;
  },
  durationMs: number,
  chartDelayMs: number = 0,
): Promise<Uint8Array> {
  const sampleRate = 8000;
  const clickDurationSec = 0.05;
  const totalSamples = Math.max(1, Math.ceil((sampleRate * durationMs) / 1000));
  const trackBuffer = new Float32Array(totalSamples);

  const [accentSample, normalSample] = await Promise.all([
    generateClickSample(1000, clickDurationSec, sampleRate, 1.0),
    generateClickSample(700, clickDurationSec, sampleRate, 0.6),
  ]);

  const events = buildBeatClickEvents({
    tempos: chart.tempos,
    timeSignatures: chart.timeSignatures,
    resolution: chart.resolution,
    durationMs,
    chartDelayMs,
  });

  for (const event of events) {
    const index = Math.floor((event.timeMs / 1000) * sampleRate);
    mixSamples(trackBuffer, event.accent ? accentSample : normalSample, index);
  }

  return float32ToWav(trackBuffer, sampleRate);
}
