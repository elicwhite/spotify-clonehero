import {Measure} from './convertToVexflow';
import {generateClickSample, mixSamples} from '@/lib/preview/clickTrack';
import type {TrackPcm} from '@/lib/preview/audioManager';

export interface ClickOptions {
  clickDuration: number; // Duration (in seconds) of each click sound
  strongTone: number; // Frequency (Hz) for the downbeat (strong beat)
  subdivisionTone: number; // Frequency (Hz) for subdivision clicks
}

// Define an interface for our scheduled click events.
interface ClickEvent {
  timeMs: number; // when the click should occur (ms)
  voice: ClickVoice;
}

/**
 * The four independently levelled parts of the click, in the order their
 * buffers are laid out in the `click` track. The index of a voice in the
 * ACTIVE subset is its buffer index, which is what
 * `AudioManager.setBufferGain` addresses.
 */
export const CLICK_VOICES = [
  'wholeNote',
  'quarterNote',
  'eighthNote',
  'tripletNote',
] as const;

export type ClickVoice = (typeof CLICK_VOICES)[number];

export type ClickVolumes = Record<ClickVoice, number>;

// Click options: Here, we want 2 subdivisions per beat (i.e. a click on the beat and one in between)
const clickOptions: ClickOptions = {
  clickDuration: 0.05, // each click lasts 50ms
  strongTone: 1000, // strong beat frequency (Hz)
  subdivisionTone: 700, // subdivision frequency (Hz
};

const VOICE_TONE: Record<ClickVoice, number> = {
  wholeNote: clickOptions.strongTone,
  quarterNote: clickOptions.subdivisionTone,
  eighthNote: clickOptions.subdivisionTone,
  tripletNote: clickOptions.subdivisionTone,
};

/** 8 kHz is well above what a 1 kHz sine with a 5 ms attack needs. */
const SAMPLE_RATE = 8000;

/**
 * The voices the user can currently hear, in {@link CLICK_VOICES} order.
 *
 * A voice at zero is not rendered at all: it would be a full-song buffer of
 * silence, and one buffer per song-length voice is the entire memory cost of
 * levelling the click with gain nodes instead of re-rendering it.
 */
export function activeClickVoices(volumes: ClickVolumes): ClickVoice[] {
  return CLICK_VOICES.filter(voice => volumes[voice] > 0);
}

/**
 * Generates an array of click events based on the provided measures.
 * For each measure the beat times are computed by interpolating between
 * measure.startMs and measure.endMs using each beat's startTick.
 */
export function generateClickEventsFromMeasures(
  measures: Measure[],
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
      // between measure.startMs and measure.endMs.
      const measureDurationMs = measure.endMs - measure.startMs;
      const measureTickSpan = measure.endTick - measure.startTick;
      const beatFraction =
        (currentBeat.startTick - measure.startTick) / measureTickSpan;
      const beatTimeMs = measure.startMs + beatFraction * measureDurationMs;

      // Decide voice: downbeat if i===0, otherwise quarter
      events.push({
        timeMs: beatTimeMs,
        voice: i === 0 ? 'wholeNote' : 'quarterNote',
      });

      // Insert subdivisions between this beat and the next
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
        events.push({timeMs: subdivisionTimeMs, voice: 'eighthNote'});

        // Add triplet subdivisions - divide the interval into thirds
        const tripletInterval = nextBeatTimeMs - beatTimeMs;
        const firstTripletTimeMs = beatTimeMs + tripletInterval / 3;
        const secondTripletTimeMs = beatTimeMs + (2 * tripletInterval) / 3;
        events.push({timeMs: firstTripletTimeMs, voice: 'tripletNote'});
        events.push({timeMs: secondTripletTimeMs, voice: 'tripletNote'});
      }
    }
  }
  return events;
}

/**
 * Renders one mono 8 kHz buffer per requested voice, each at UNIT amplitude.
 *
 * Loudness is not baked in — the caller sets each voice's level with
 * `AudioManager.setBufferGain`, which is linear and so reproduces exactly the
 * amplitude `generateClickSample` used to bake in. That is what lets the four
 * subdivision faders move without re-rendering anything or rebuilding the
 * AudioManager.
 *
 * Buffers come back in `voices` order, so buffer index i levels voices[i].
 * With no voices at all the result is a single silent frame, so the `click`
 * track still exists for a later `setVolume`/`replaceTrack`.
 */
export async function generateClickVoicePcm(
  measures: Measure[],
  voices: readonly ClickVoice[],
  /** Chart delay in ms. Clicks are shifted forward so they align with audio. */
  chartDelayMs: number = 0,
): Promise<TrackPcm[]> {
  if (measures.length === 0) {
    throw new Error('No measures provided');
  }
  if (voices.length === 0) {
    return [{samples: new Float32Array(1), sampleRate: SAMPLE_RATE}];
  }

  // The overall duration is defined by the endMs of the last measure, shifted
  // by chartDelayMs so clicks align with audio playback.
  const totalDurationMs = measures[measures.length - 1].endMs + chartDelayMs;
  const totalSamples = Math.max(
    1,
    Math.ceil((SAMPLE_RATE * totalDurationMs) / 1000),
  );

  const samplesByVoice = new Map(
    await Promise.all(
      voices.map(
        async voice =>
          [
            voice,
            await generateClickSample(
              VOICE_TONE[voice],
              clickOptions.clickDuration,
              SAMPLE_RATE,
              1,
            ),
          ] as const,
      ),
    ),
  );

  const buffers = new Map(
    voices.map(voice => [voice, new Float32Array(totalSamples)] as const),
  );

  for (const event of generateClickEventsFromMeasures(measures)) {
    const target = buffers.get(event.voice);
    if (!target) continue;
    const index = Math.floor(
      ((event.timeMs + chartDelayMs) / 1000) * SAMPLE_RATE,
    );
    mixSamples(target, samplesByVoice.get(event.voice)!, index);
  }

  return voices.map(voice => ({
    samples: buffers.get(voice)!,
    sampleRate: SAMPLE_RATE,
  }));
}
