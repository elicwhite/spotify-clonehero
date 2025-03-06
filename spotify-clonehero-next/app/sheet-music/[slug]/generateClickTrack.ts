import {ChartResponseEncore} from '@/lib/chartSelection';
import {ParsedChart} from '@/lib/preview/chorus-chart-processing';
import {tickToMs} from './chartUtils';

// Define our interfaces for tempo and time signature events.
interface TempoEvent {
  tick: number;
  bpm: number;
}

interface TimeSignatureEvent {
  tick: number;
  numerator: number;
  denominator: number;
}

interface ClickOptions {
  clickDuration: number; // Duration (in seconds) of each click sound
  strongTone: number; // Frequency (Hz) for the downbeat (strong beat)
  subdivisionTone: number; // Frequency (Hz) for subdivision clicks
  strongVolume: number; // Gain value for strong beats
  subdivisionVolume: number; // Gain value for subdivisions
  subdivisions?: number; // Number of subdivisions per beat (if 1 or undefined, only the beat is clicked)
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
export async function generateClickTrack(
  metadata: ChartResponseEncore,
  chart: ParsedChart,
  // audioCtx: AudioContext,
  // tempoEvents: TempoEvent[],
  // timeSignatures: TimeSignatureEvent[],
  // resolution: number,
  // totalTicks: number,
  // clickOptions: ClickOptions,
): Promise<Uint8Array<ArrayBufferLike>> {
  const songLengthSeconds = (metadata?.song_length || 5 * 60 * 1000) / 1000;
  const sampleRate = 44100;
  const offlineCtx = new OfflineAudioContext(
    2,
    sampleRate * songLengthSeconds,
    sampleRate,
  );

  // Calculate the total duration of the track in seconds
  // const totalDuration = tickToMs(chart, totalTicks, tempoEvents, resolution);

  // Helper: schedule a click sound at a given tick time.
  function scheduleClick(tick: number, isStrong: boolean) {
    const time = tickToMs(chart, tick) / 1000;
    const osc = offlineCtx.createOscillator();
    // Choose frequency based on whether this is a strong (downbeat) or subdivision click.
    osc.frequency.value = isStrong
      ? clickOptions.strongTone
      : clickOptions.subdivisionTone;

    const gainNode = offlineCtx.createGain();
    gainNode.gain.value = isStrong
      ? clickOptions.strongVolume
      : clickOptions.subdivisionVolume;

    osc.connect(gainNode);
    gainNode.connect(offlineCtx.destination);

    osc.start(time);
    osc.stop(time + clickOptions.clickDuration);
  }

  // Loop through time signature segments.
  // Assume timeSignatures is sorted by tick.
  // For simplicity, we assume the first time signature starts at tick 0.
  for (let tsIndex = 0; tsIndex < timeSignatures.length; tsIndex++) {
    const ts = timeSignatures[tsIndex];
    const startTick = ts.tick;
    // Determine the end tick of this time signature segment.
    // Either the next time signature change or the end of the file.
    const endTick =
      tsIndex + 1 < timeSignatures.length
        ? timeSignatures[tsIndex + 1].tick
        : totalTicks;

    // Calculate beat and measure lengths (in ticks)
    const beatTicks = resolution * (4 / ts.denominator); // one beat in ticks
    const measureTicks = beatTicks * ts.numerator;

    // We'll iterate measure by measure.
    // Ensure we start at a measure boundary.
    let measureStartTick = startTick;

    while (measureStartTick < endTick && measureStartTick < totalTicks) {
      // For each beat in the measure:
      for (let beatIndex = 0; beatIndex < ts.numerator; beatIndex++) {
        const beatTick = measureStartTick + beatIndex * beatTicks;
        if (beatTick >= totalTicks) break;
        // Schedule the strong click (downbeat)
        scheduleClick(beatTick, true);

        // If subdivisions are defined (and more than 1 subdivision per beat)
        if (clickOptions.subdivisions && clickOptions.subdivisions > 1) {
          // For each subdivision that is not the strong beat (index 0)
          for (
            let subIndex = 1;
            subIndex < clickOptions.subdivisions;
            subIndex++
          ) {
            const subTick =
              beatTick + (beatTicks * subIndex) / clickOptions.subdivisions;
            // Only schedule if within the current measure and track length
            if (
              subTick < measureStartTick + measureTicks &&
              subTick < totalTicks
            ) {
              scheduleClick(subTick, false);
            }
          }
        }
      }
      measureStartTick += measureTicks;
    }
  }

  // Render the click track as an AudioBuffer.
  return audioBufferToWav(await offlineCtx.startRendering());
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

/* ----- Example usage ----- */

// Example tempo events (sorted by tick)
const tempoEvents: TempoEvent[] = [
  {tick: 0, bpm: 120},
  {tick: 1920, bpm: 140}, // Tempo change at tick 1920
];

// Example time signature events (sorted by tick)
// Assuming the first time signature starts at tick 0.
const timeSignatures: TimeSignatureEvent[] = [
  {tick: 0, numerator: 4, denominator: 4},
  {tick: 960, numerator: 3, denominator: 4}, // Change at tick 960
];

const resolution = 480; // ticks per quarter note
const totalTicks = 3840; // total ticks for the track

// Click options: Here, we want 2 subdivisions per beat (i.e. a click on the beat and one in between)
const clickOptions: ClickOptions = {
  clickDuration: 0.05, // each click lasts 50ms
  strongTone: 1000, // strong beat frequency (Hz)
  subdivisionTone: 800, // subdivision frequency (Hz)
  strongVolume: 1.0,
  subdivisionVolume: 0.6,
  subdivisions: 2, // click on beat and one subdivision between beats
};

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
