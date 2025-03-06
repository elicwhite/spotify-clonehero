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
  isStrong: boolean;
}

// Click options: Here, we want 2 subdivisions per beat (i.e. a click on the beat and one in between)
const clickOptions: ClickOptions = {
  clickDuration: 0.05, // each click lasts 50ms
  strongTone: 1000, // strong beat frequency (Hz)
  subdivisionTone: 800, // subdivision frequency (Hz)
  strongVolume: 1.0,
  subdivisionVolume: 0.6,
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
  clickOptions: ClickOptions,
): ClickEvent[] {
  const events: ClickEvent[] = [];
  // Iterate over each measure.
  for (const measure of measures) {
    // Calculate the measure duration and tick span.
    const measureDurationMs = measure.endMs - measure.startMs;
    const measureTickSpan = measure.endTick - measure.startTick;
    const beats = measure.beats;
    // Process each beat in the measure.
    for (let i = 0; i < beats.length; i++) {
      const beat = beats[i];
      // Compute the beat's time by interpolating its startTick between the measure boundaries.
      const beatFraction =
        (beat.startTick - measure.startTick) / measureTickSpan;
      const beatTimeMs = measure.startMs + beatFraction * measureDurationMs;
      // Schedule the strong (downbeat) click.
      events.push({timeMs: beatTimeMs, isStrong: true});
      // If subdivisions are requested and this is not the last beat in the measure,
      // insert subdivision clicks between the current beat and the next beat.
      if (
        clickOptions.subdivisions &&
        clickOptions.subdivisions > 1 &&
        i < beats.length - 1
      ) {
        const nextBeat = beats[i + 1];
        const nextBeatFraction =
          (nextBeat.startTick - measure.startTick) / measureTickSpan;
        const nextBeatTimeMs =
          measure.startMs + nextBeatFraction * measureDurationMs;
        const intervalMs = nextBeatTimeMs - beatTimeMs;
        // For example, if subdivisions === 2, one subdivision click is inserted halfway.
        for (
          let subIndex = 1;
          subIndex < clickOptions.subdivisions;
          subIndex++
        ) {
          const subTimeMs =
            beatTimeMs + (intervalMs * subIndex) / clickOptions.subdivisions;
          events.push({timeMs: subTimeMs, isStrong: false});
        }
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
  const sampleRate = 44100;
  const offlineCtx = new OfflineAudioContext(
    2,
    sampleRate * totalDurationSeconds,
    sampleRate,
  );

  // Generate our array of click events.
  const clickEvents = generateClickEventsFromMeasures(measures, clickOptions);
  console.log('clickEvents', clickEvents);

  // Schedule each click event into the offline context.
  clickEvents.forEach(event => {
    const time = event.timeMs / 1000; // convert ms to seconds
    const osc = offlineCtx.createOscillator();
    osc.frequency.value = event.isStrong
      ? clickOptions.strongTone
      : clickOptions.subdivisionTone;
    const gainNode = offlineCtx.createGain();
    gainNode.gain.value = event.isStrong
      ? clickOptions.strongVolume
      : clickOptions.subdivisionVolume;

    osc.connect(gainNode);
    gainNode.connect(offlineCtx.destination);

    osc.start(time);
    osc.stop(time + clickOptions.clickDuration);
  });

  // Render the audio and convert it to a WAV Uint8Array.
  const renderedBuffer = await offlineCtx.startRendering();
  return audioBufferToWav(renderedBuffer);
}

/**
 * Generate a click track AudioBuffer given tempo events, time signature events,
 * resolution, and click options.
 *
 * @param audioCtx An existing AudioContext (for sample rate reference).
 * @param tempoEvents Sorted array of tempo events.
 * @param timeSignatures Sorted array of time signature events.
 * @param resolution Ticks per quarter note.
 * @param totalTicks Total ticks for the track.
 * @param clickOptions Options for click sound properties.
 * @returns A Promise that resolves to an AudioBuffer containing the rendered click track.
 */
// export async function generateClickTrack(
//   metadata: ChartResponseEncore,
//   chart: ParsedChart,
//   measures: Measure[],
//   // audioCtx: AudioContext,
//   // tempoEvents: TempoEvent[],
//   // timeSignatures: TimeSignatureEvent[],
//   // resolution: number,
//   // totalTicks: number,
//   // clickOptions: ClickOptions,
// ): Promise<Uint8Array<ArrayBufferLike>> {
//   const songLengthSeconds = (metadata?.song_length || 5 * 60 * 1000) / 1000;
//   const sampleRate = 44100;
//   const offlineCtx = new OfflineAudioContext(
//     2,
//     sampleRate * songLengthSeconds,
//     sampleRate,
//   );

//   // Calculate the total duration of the track in seconds
//   // const totalDuration = tickToMs(chart, totalTicks, tempoEvents, resolution);

//   // Helper: schedule a click sound at a given tick time.
//   function scheduleClick(tick: number, isStrong: boolean) {
//     console.log('scheduling click', tickToMs(chart, tick), isStrong);
//     const time = tickToMs(chart, tick) / 1000;
//     const osc = offlineCtx.createOscillator();
//     // Choose frequency based on whether this is a strong (downbeat) or subdivision click.
//     osc.frequency.value = isStrong
//       ? clickOptions.strongTone
//       : clickOptions.subdivisionTone;

//     const gainNode = offlineCtx.createGain();
//     gainNode.gain.value = isStrong
//       ? clickOptions.strongVolume
//       : clickOptions.subdivisionVolume;

//     osc.connect(gainNode);
//     gainNode.connect(offlineCtx.destination);

//     osc.start(time);
//     osc.stop(time + clickOptions.clickDuration);
//   }

//   // const endOfTrackTicks =
//   //     drumPart.noteEventGroups[drumPart.noteEventGroups.length - 1][0].tick ||
//   //     0;

//   // chart.timeSignatures.forEach((timeSig, index) => {
//   //   const pulsesPerDivision = this.chart.resolution / (timeSig.denominator / 4);
//   //   const totalTimeSigTicks =
//   //     (chart.timeSignatures[index + 1]?.tick ?? endOfTrackTicks) -
//   //     timeSig.tick;

//   //   const numberOfMeasures = Math.ceil(
//   //     totalTimeSigTicks / pulsesPerDivision / timeSig.numerator,
//   //   );

//   //   for (let measure = 0; measure < numberOfMeasures; measure += 1) {
//   //     const endTick = startTick + timeSig.numerator * pulsesPerDivision;

//   //     this.measures.push({
//   //       timeSig: timeSig,
//   //       hasClef: index === 0 && measure === 0,
//   //       sigChange: measure === 0,
//   //       notes: [],
//   //       beats: this.getBeats(timeSig, startTick, endTick),
//   //       startTick,
//   //       endTick,
//   //       startMs: tickToMs(chart, startTick),
//   //       endMs: tickToMs(chart, endTick),
//   //     });

//   //     startTick += timeSig.numerator * pulsesPerDivision;
//   //   }
//   // });

//   for (let tsIndex = 0; tsIndex < timeSignatures.length; tsIndex++) {
//     const ts = timeSignatures[tsIndex];
//     const startTick = ts.tick;
//     const endTick =
//       tsIndex + 1 < timeSignatures.length
//         ? timeSignatures[tsIndex + 1].tick
//         : totalTicks;
//     const beatTicks = resolution * (4 / ts.denominator);
//     const measureTicks = beatTicks * ts.numerator;

//     let measureStartTick = startTick;
//     while (measureStartTick < endTick && measureStartTick < totalTicks) {
//       // Schedule each beat in the measure.
//       for (let beatIndex = 0; beatIndex < ts.numerator; beatIndex++) {
//         const beatTick = measureStartTick + beatIndex * beatTicks;
//         if (beatTick >= totalTicks) break;
//         scheduleClick(beatTick, true); // strong (downbeat) click
//         // Schedule subdivisions if required.
//         if (clickOptions.subdivisions && clickOptions.subdivisions > 1) {
//           for (
//             let subIndex = 1;
//             subIndex < clickOptions.subdivisions;
//             subIndex++
//           ) {
//             const subTick =
//               beatTick + (beatTicks * subIndex) / clickOptions.subdivisions;
//             if (
//               subTick < measureStartTick + measureTicks &&
//               subTick < totalTicks
//             ) {
//               scheduleClick(subTick, false);
//             }
//           }
//         }
//       }
//       measureStartTick += measureTicks;
//     }
//   }

//   // Render the click track as an AudioBuffer.
//   return audioBufferToWav(await offlineCtx.startRendering());
// }

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

/* ----- Example usage ----- */

// // Example tempo events (sorted by tick)
// const tempoEvents: TempoEvent[] = [
//   {tick: 0, bpm: 120},
//   {tick: 1920, bpm: 140}, // Tempo change at tick 1920
// ];

// // Example time signature events (sorted by tick)
// // Assuming the first time signature starts at tick 0.
// const timeSignatures: TimeSignatureEvent[] = [
//   {tick: 0, numerator: 4, denominator: 4},
//   {tick: 960, numerator: 3, denominator: 4}, // Change at tick 960
// ];

// const resolution = 480; // ticks per quarter note
// const totalTicks = 3840; // total ticks for the track

// Assume we already have an AudioContext (for example, created on user interaction)
// const audioCtx = new AudioContext();

// generateClickTrack(
//   audioCtx,
//   tempoEvents,
//   timeSignatures,
//   resolution,
//   totalTicks,
//   clickOptions,
// )
//   .then((clickBuffer: AudioBuffer) => {
//     // Now play the click track using a BufferSourceNode.
//     const bufferSource = audioCtx.createBufferSource();
//     bufferSource.buffer = clickBuffer;
//     bufferSource.connect(audioCtx.destination);
//     bufferSource.start();
//   })
//   .catch(error => {
//     console.error('Error generating click track:', error);
//   });
