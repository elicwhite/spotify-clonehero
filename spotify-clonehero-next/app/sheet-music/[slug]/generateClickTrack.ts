import {ChartResponseEncore} from '@/lib/chartSelection';
import {ParsedChart} from '@/lib/preview/chorus-chart-processing';
import {tickToMs} from './chartUtils';
import {Measure} from './convertToVexflow';

export interface ClickOptions {
  clickDuration: number; // Duration (in seconds) of each click sound
  strongTone: number; // Frequency (Hz) for the downbeat (strong beat)
  subdivisionTone: number; // Frequency (Hz) for subdivision clicks
}

// Define an interface for our scheduled click events.
interface ClickEvent {
  timeMs: number; // when the click should occur (ms)
  type: 'downbeat' | 'quarter' | 'eighth' | 'triplet';
}

export interface ClickVolumes {
  wholeNote: number;
  quarterNote: number;
  eighthNote: number;
  tripletNote: number;
}

interface VolumeConfig {
  downbeat: number; // Volume for the "1" of each measure
  quarter: number; // Volume for other quarter beats (2, 3, 4 in 4/4)
  eighth: number; // Volume for eighth-note subdivisions
}

// Click options: Here, we want 2 subdivisions per beat (i.e. a click on the beat and one in between)
const clickOptions: ClickOptions = {
  clickDuration: 0.05, // each click lasts 50ms
  strongTone: 1000, // strong beat frequency (Hz)
  subdivisionTone: 700, // subdivision frequency (Hz
};

/**
 * Generates a click sample using an oscillator.
 * @param frequency Frequency in Hz for the click.
 * @param durationSec Duration of the click in seconds.
 * @param sampleRate Sample rate to use.
 * @param volume Volume (gain) for the click.
 * @returns A Promise that resolves to a Float32Array of the PCM data.
 */
async function generateClickSample(
  frequency: number,
  durationSec: number,
  sampleRate: number,
  volume: number,
): Promise<Float32Array> {
  const offlineCtx = new (window.OfflineAudioContext ||
    window.webkitOfflineAudioContext)(1, sampleRate * durationSec, sampleRate);

  // Create an oscillator and gain node to shape the click.
  const oscillator = offlineCtx.createOscillator();
  oscillator.frequency.value = frequency;

  const gainNode = offlineCtx.createGain();
  gainNode.gain.setValueAtTime(0, 0);
  // A quick attack:
  gainNode.gain.linearRampToValueAtTime(volume, 0.005);
  // And a quick release:
  gainNode.gain.setValueAtTime(volume, durationSec - 0.005);
  gainNode.gain.linearRampToValueAtTime(0, durationSec);

  oscillator.connect(gainNode);
  gainNode.connect(offlineCtx.destination);

  oscillator.start(0);
  oscillator.stop(durationSec);

  // Render and extract the PCM data.
  const audioBuffer = await offlineCtx.startRendering();
  return audioBuffer.getChannelData(0).slice();
}

/**
 * Mixes a source sample into a target buffer at the given offset.
 * @param target The target Float32Array (your main track).
 * @param source The click sample to mix in.
 * @param offset The starting sample index in the target.
 */
function mixSamples(
  target: Float32Array,
  source: Float32Array,
  offset: number,
): void {
  for (let i = 0; i < source.length; i++) {
    const targetIndex = offset + i;
    if (targetIndex < target.length) {
      target[targetIndex] += source[i];
    }
  }
}

/**
 * Generates an array of click events based on the provided measures.
 * For each measure the beat times are computed by interpolating between
 * measure.startMs and measure.endMs using each beat's startTick.
 *
 * If subdivisions > 1 in clickOptions, subdivision clicks are inserted between beats.
 */
function generateClickEventsFromMeasures(measures: Measure[]): ClickEvent[] {
  const events: ClickEvent[] = [];
  for (const measure of measures) {
    // If there's only 1 beat, it is effectively the downbeat
    if (measure.beats.length === 0) {
      continue;
    }

    for (let i = 0; i < measure.beats.length; i++) {
      const currentBeat = measure.beats[i];
      // Compute the start time (in ms) of this beat by interpolating
      // between measure.startMs and measure.endMs, if needed.
      // If your measure already provides an exact ms for each beat,
      // you can use that directly. Otherwise, approximate:
      const measureDurationMs = measure.endMs - measure.startMs;
      const measureTickSpan = measure.endTick - measure.startTick;
      const beatFraction =
        (currentBeat.startTick - measure.startTick) / measureTickSpan;
      const beatTimeMs = measure.startMs + beatFraction * measureDurationMs;

      // Decide volume: downbeat if i===0, otherwise quarter
      events.push({timeMs: beatTimeMs, type: i === 0 ? 'downbeat' : 'quarter'});

      // Insert an eighth‐note subdivision if enabled and not the last beat
      if (i < measure.beats.length - 1) {
        const nextBeat = measure.beats[i + 1];
        // Time for next beat
        const nextBeatFraction =
          (nextBeat.startTick - measure.startTick) / measureTickSpan;
        const nextBeatTimeMs =
          measure.startMs + nextBeatFraction * measureDurationMs;

        // Midpoint between this beat and the next (eighth note)
        const subdivisionTimeMs =
          beatTimeMs + (nextBeatTimeMs - beatTimeMs) / 2;
        events.push({timeMs: subdivisionTimeMs, type: 'eighth'});

        // Add triplet subdivisions - divide the interval into thirds
        const tripletInterval = nextBeatTimeMs - beatTimeMs;
        const firstTripletTimeMs = beatTimeMs + tripletInterval / 3;
        const secondTripletTimeMs = beatTimeMs + (2 * tripletInterval) / 3;
        events.push({timeMs: firstTripletTimeMs, type: 'triplet'});
        events.push({timeMs: secondTripletTimeMs, type: 'triplet'});
      }
    }
  }
  return events;
}

/**
 * Generates a click track WAV file (as a Uint8Array) based on an array of Measure.
 *
 * This function uses the measures’ precomputed start/end times.
 * It creates a click event for each beat (and subdivisions if requested) then
 * schedules click sounds using an OfflineAudioContext.
 */
export async function generateClickTrackFromMeasures(
  measures: Measure[],
  // clickOptions: ClickOptions,
  clickVolumes: ClickVolumes,
): Promise<Uint8Array> {
  if (measures.length === 0) {
    throw new Error('No measures provided');
  }
  const before = performance.now();
  // Assume the overall duration is defined by the endMs of the last measure.
  const totalDurationMs = measures[measures.length - 1].endMs;
  const totalDurationSeconds = totalDurationMs / 1000;
  // const sampleRate = 44100;
  const sampleRate = 8000;
  const totalSamples = sampleRate * totalDurationSeconds;

  const trackBuffer = new Float32Array(totalSamples);

  // const offlineCtx = new OfflineAudioContext(1, totalSamples, sampleRate);

  const [downbeatSample, quarterSample, eighthSample, tripletSample] =
    await Promise.all([
      generateClickSample(
        clickOptions.strongTone,
        clickOptions.clickDuration,
        sampleRate,
        clickVolumes.wholeNote,
      ),
      generateClickSample(
        clickOptions.subdivisionTone,
        clickOptions.clickDuration,
        sampleRate,
        clickVolumes.quarterNote,
      ),
      generateClickSample(
        clickOptions.subdivisionTone,
        clickOptions.clickDuration,
        sampleRate,
        clickVolumes.eighthNote,
      ),
      generateClickSample(
        clickOptions.subdivisionTone,
        clickOptions.clickDuration,
        sampleRate,
        clickVolumes.tripletNote,
      ),
    ]);

  // Generate our array of click events.
  const clickEvents = generateClickEventsFromMeasures(measures);

  // Schedule each click event into the offline context.
  clickEvents.forEach(event => {
    if (event.type === 'eighth' && clickVolumes.eighthNote === 0) {
      return;
    }

    if (event.type === 'triplet' && clickVolumes.tripletNote === 0) {
      return;
    }

    const timeSec = event.timeMs / 1000;
    const index = Math.floor(timeSec * sampleRate);
    if (event.type === 'downbeat') {
      mixSamples(trackBuffer, downbeatSample, index);
    } else if (event.type === 'quarter') {
      mixSamples(trackBuffer, quarterSample, index);
    } else if (event.type === 'eighth') {
      mixSamples(trackBuffer, eighthSample, index);
    } else if (event.type === 'triplet') {
      mixSamples(trackBuffer, tripletSample, index);
    }
  });

  // Render the audio and convert it to a WAV Uint8Array.

  const buffer = float32ToWav(trackBuffer, sampleRate);
  const after = performance.now();
  console.log('Took ' + (after - before) + 'ms to render');
  // return renderedBuffer;
  return buffer;
}

/**
 * Converts a mono Float32Array of PCM samples into a 16-bit PCM WAV file
 * stored in a Uint8Array.
 */
function float32ToWav(samples: Float32Array, sampleRate: number): Uint8Array {
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

  // RIFF header.
  writeString('RIFF');
  writeUint32(totalSize - 8);
  writeString('WAVE');

  // "fmt " subchunk.
  writeString('fmt ');
  writeUint32(16); // PCM chunk size
  writeUint16(1); // Audio format: PCM
  writeUint16(numChannels);
  writeUint32(sampleRate);
  writeUint32(byteRate);
  writeUint16(blockAlign);
  writeUint16(bitsPerSample);

  // "data" subchunk.
  writeString('data');
  writeUint32(dataSize);

  // Write PCM samples (convert from Float32 to Int16).
  for (let i = 0; i < samples.length; i++) {
    let s = samples[i];
    s = Math.max(-1, Math.min(1, s));
    const int16 = s < 0 ? s * 0x8000 : s * 0x7fff;
    view.setInt16(offset, int16, true);
    offset += 2;
  }

  return new Uint8Array(buffer);
}
