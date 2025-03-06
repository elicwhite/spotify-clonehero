import {ChartResponseEncore} from '@/lib/chartSelection';
import {ParsedChart} from '@/lib/preview/chorus-chart-processing';
import {tickToMs} from './chartUtils';
import {Measure} from './convertToVexflow';

export interface ClickOptions {
  clickDuration: number; // Duration (in seconds) of each click sound
  strongTone: number; // Frequency (Hz) for the downbeat (strong beat)
  subdivisionTone: number; // Frequency (Hz) for subdivision clicks
  strongVolume: number; // Gain value for strong beats
  subdivisionVolume: number; // Gain value for subdivisions
  subdivisions?: number; // Number of subdivisions per beat (if 1 or undefined, only the beat is clicked)
}

// Define an interface for our scheduled click events.
interface ClickEvent {
  timeMs: number; // when the click should occur (ms)
  volume: number;
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
  subdivisionTone: 500, // subdivision frequency (Hz)
  strongVolume: 1.0,
  subdivisionVolume: Math.pow(0.6, 2),
  subdivisions: 2, // click on beat and one subdivision between beats
};

/**
 * Generates an array of click events based on the provided measures.
 * For each measure the beat times are computed by interpolating between
 * measure.startMs and measure.endMs using each beat's startTick.
 *
 * If subdivisions > 1 in clickOptions, subdivision clicks are inserted between beats.
 */
function generateClickEventsFromMeasures(
  measures: Measure[],
  volumeConfig: VolumeConfig,
): ClickEvent[] {
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
      const volume = i === 0 ? volumeConfig.downbeat : volumeConfig.quarter;
      events.push({timeMs: beatTimeMs, volume});

      // Insert an eighth‐note subdivision if enabled and not the last beat
      if (volumeConfig.eighth > 0 && i < measure.beats.length - 1) {
        const nextBeat = measure.beats[i + 1];
        // Time for next beat
        const nextBeatFraction =
          (nextBeat.startTick - measure.startTick) / measureTickSpan;
        const nextBeatTimeMs =
          measure.startMs + nextBeatFraction * measureDurationMs;
        // Midpoint between this beat and the next
        const subdivisionTimeMs =
          beatTimeMs + (nextBeatTimeMs - beatTimeMs) / 2;
        events.push({timeMs: subdivisionTimeMs, volume: volumeConfig.eighth});
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
): Promise<Uint8Array> {
  if (measures.length === 0) {
    throw new Error('No measures provided');
  }
  // Assume the overall duration is defined by the endMs of the last measure.
  const totalDurationMs = measures[measures.length - 1].endMs;
  const totalDurationSeconds = totalDurationMs / 1000;
  // const sampleRate = 44100;
  const sampleRate = 8000;
  const offlineCtx = new OfflineAudioContext(
    1,
    sampleRate * totalDurationSeconds,
    sampleRate,
  );

  // Generate our array of click events.
  const clickEvents = generateClickEventsFromMeasures(measures, {
    downbeat: 0.7,
    quarter: 0.5,
    eighth: 0.0,
  });
  console.log('clickEvents', clickEvents);

  // Schedule each click event into the offline context.
  clickEvents.forEach(event => {
    const timeSec = event.timeMs / 1000;
    const osc = offlineCtx.createOscillator();

    // For simplicity, let's assume if volume >= 0.9 we use strongTone, else subdivisionTone
    // Or you can pass the frequency in the event, etc.
    const freq =
      event.volume >= 0.9
        ? clickOptions.strongTone
        : clickOptions.subdivisionTone;
    osc.frequency.value = freq;

    // Create a gain node
    const gain = offlineCtx.createGain();
    gain.gain.value = event.volume; // use the event's volume

    osc.connect(gain);
    gain.connect(offlineCtx.destination);

    osc.start(timeSec);
    osc.stop(timeSec + clickOptions.clickDuration);
  });

  // Render the audio and convert it to a WAV Uint8Array.
  const before = performance.now();
  const renderedBuffer = await offlineCtx.startRendering();
  const buffer = audioBufferToWav(renderedBuffer);
  const after = performance.now();
  console.log('Took ' + (after - before) + 'ms to render');
  // return renderedBuffer;
  return buffer;
}

/**
 * Converts an AudioBuffer into a 16-bit PCM WAV file represented as a Uint8Array.
 * This is dumb because we convert it right back to AudioBuffer
 */
function audioBufferToWav(
  audioBuffer: AudioBuffer,
): Uint8Array<ArrayBufferLike> {
  const numChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const numSamples = audioBuffer.length;
  const bitsPerSample = 16;
  const blockAlign = numChannels * (bitsPerSample / 8);
  const byteRate = sampleRate * blockAlign;
  const dataSize = numSamples * blockAlign;
  const headerSize = 44;
  const buffer = new ArrayBuffer(headerSize + dataSize);
  const view = new DataView(buffer);

  // Write WAV header.
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

  // "RIFF" chunk descriptor.
  writeString('RIFF');
  writeUint32(headerSize + dataSize - 8); // File size minus first 8 bytes.
  writeString('WAVE');

  // "fmt " sub-chunk.
  writeString('fmt ');
  writeUint32(16); // Subchunk1Size for PCM.
  writeUint16(1); // Audio format (1 is PCM)
  writeUint16(numChannels);
  writeUint32(sampleRate);
  writeUint32(byteRate);
  writeUint16(blockAlign);
  writeUint16(bitsPerSample);

  // "data" sub-chunk.
  writeString('data');
  writeUint32(dataSize);

  // Write interleaved PCM samples.
  const channelData: Float32Array[] = [];
  for (let i = 0; i < numChannels; i++) {
    channelData.push(audioBuffer.getChannelData(i));
  }

  // Interleave and convert samples.
  for (let i = 0; i < numSamples; i++) {
    for (let channel = 0; channel < numChannels; channel++) {
      // Scale the float sample ([-1,1]) to 16-bit PCM.
      let sample = channelData[channel][i];
      sample = Math.max(-1, Math.min(1, sample));
      const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      view.setInt16(offset, intSample, true);
      offset += 2;
    }
  }

  return new Uint8Array(buffer);
}
