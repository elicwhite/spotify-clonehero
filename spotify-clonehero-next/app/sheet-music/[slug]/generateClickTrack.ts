import {Measure} from './convertToVexflow';
import {
  generateClickSample,
  mixSamples,
  float32ToWav,
} from '@/lib/preview/clickTrack';

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

// Click options: Here, we want 2 subdivisions per beat (i.e. a click on the beat and one in between)
const clickOptions: ClickOptions = {
  clickDuration: 0.05, // each click lasts 50ms
  strongTone: 1000, // strong beat frequency (Hz)
  subdivisionTone: 700, // subdivision frequency (Hz
};

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
  /** Chart delay in ms. Clicks are shifted forward so they align with audio. */
  chartDelayMs: number = 0,
): Promise<Uint8Array> {
  if (measures.length === 0) {
    throw new Error('No measures provided');
  }
  const before = performance.now();
  // Assume the overall duration is defined by the endMs of the last measure,
  // shifted by chartDelayMs so clicks align with audio playback.
  const totalDurationMs = measures[measures.length - 1].endMs + chartDelayMs;
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

    const timeSec = (event.timeMs + chartDelayMs) / 1000;
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
