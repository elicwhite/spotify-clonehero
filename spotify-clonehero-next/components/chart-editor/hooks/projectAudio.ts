/**
 * A chart package's own audio files, decoded into the ORIGINAL (unpadded)
 * PCM `usePaddedAudio` plays from — and padded back out again for export.
 *
 * This is the pure half of an OPFS-project-backed editor's audio: no React,
 * no page state. `usePaddedAudio` (beside this file) owns the live
 * AudioManager built from it, and `useSeparatedStems` owns the extra stems an
 * assist run produced.
 */

import type {Files} from '@/lib/preview/chorus-chart-processing';
import {
  decodeAtRate,
  nativeDecodeRate,
} from '@/lib/audio-pipeline/decode-audio';
import {interleaveAudioBuffer} from '@/lib/drum-transcription/audio/decoder';
import {padPcmStart} from '@/lib/drum-transcription/audio/pad-pcm';
import {encodePcmToOpus} from '@/lib/audio/opus-encoder';
import {encodeWavBlob} from '@/lib/audio/wav-encoder';
import {DRUMS_STEM} from '@/lib/audio-pipeline/separate-stems';
import {rememberDecodedBuffer} from '@/lib/preview/decodedPcm';
import {getBasename} from '@/lib/src-shared/utils';
import type {AudioSource} from '../ExportDialog';
import {anchorPadSamples} from './usePaddedAudio';
import type {AudioStemInput, PaddedAudioMeta} from './usePaddedAudio';

/** `interleaveAudioBuffer` produces stereo for every file, whatever the
 *  package shipped (a mono source has its one channel duplicated), so the
 *  channel count is fixed even though the sample rate is not. */
export const PACKAGE_AUDIO_CHANNELS = 2;

/** Rate assumed for a package with no files at all to sniff. Nothing decodes
 *  in that case — the load fails right after — but the meta still has to say
 *  something. */
const PACKAGE_FALLBACK_SAMPLE_RATE = 44100;

/** The project's audio as `usePaddedAudio` takes it. */
export interface DecodedPackageAudio {
  /** Base name of the file the full mix came from (`song` for `song.ogg`),
   *  so a padded export can name it what the package named it. */
  fullMixName: string;
  fullMixPcm: Float32Array;
  stems: AudioStemInput[];
  /** The format every buffer above is in. The rate is the package's own (see
   *  {@link decodeChartPackageAudio}), so it has to travel with the PCM
   *  rather than being assumed: the padding, the transport's duration and the
   *  padded export all measure against it. */
  meta: PaddedAudioMeta;
}

/**
 * Decodes every audio file in the project into the ORIGINAL (unpadded) PCM
 * `usePaddedAudio` pads and plays.
 *
 * A chart package is not one mixed file plus separated stems: it is several
 * stems (song/guitar/rhythm/drums/...) that are ALL meant to play together,
 * and that is what `AudioManager` has always done with them. So the hook's
 * "full mix" here is the package's `song` file (its first file when it has
 * no `song`), and every remaining file is a `chart-file` stem beside it —
 * a summed mixdown PLUS those same stems would play the whole package
 * twice. Single-file packages are the same rule with an empty stem list.
 *
 * Undecodable files are skipped with a warning rather than failing the load:
 * one bad stem never takes the editor down.
 *
 * Everything decodes at ONE rate, the native rate of the file that will
 * become the full mix — this audio is only ever played, drawn as a waveform
 * and padded back out, none of which cares what the rate is, and a decoder
 * asked for a rate the source isn't in resamples every sample on the way
 * out. On an album-length opus that implicit resample is several seconds of
 * load. The rate travels back in `meta` so the rest of the editor measures
 * against the audio it actually got. A package whose files disagree (an
 * opus full mix beside an mp3 stem) still lands on one rate, since the whole
 * package has to pad and mix as one set.
 */
export async function decodeChartPackageAudio(
  files: Files,
): Promise<DecodedPackageAudio> {
  // Chosen before anything decodes, so every file lands at the same rate.
  // Which file leads is decided by name here and re-derived from the decoded
  // set below; they only disagree when the `song` file fails to decode, and
  // the fallback is then a correct-but-resampled decode, not a wrong one.
  const primary =
    files.find(file => getBasename(file.fileName) === 'song') ?? files[0];
  const sampleRate = primary
    ? nativeDecodeRate(primary.data)
    : PACKAGE_FALLBACK_SAMPLE_RATE;

  const decoded: {name: string; pcm: Float32Array}[] = [];
  const usedNames = new Set<string>();
  for (const file of files) {
    try {
      const audioBuffer = await decodeAtRate(file.data, sampleRate);
      // AudioManager keys tracks by file basename, so two files that share
      // one (song.ogg + song.mp3) would collapse into a single track and
      // lose audio. Uniquify instead, with a suffix that is still a clean
      // audio filename: a padded export writes `${name}.opus`/`${name}.wav`,
      // so a space here would ship `song 2.opus`.
      const base = getBasename(file.fileName);
      let name = base;
      for (let n = 2; usedNames.has(name); n++) name = `${base}-${n}`;
      usedNames.add(name);
      const pcm = interleaveAudioBuffer(audioBuffer);
      // Playback wants these samples back in exactly the buffer they just
      // came out of, so hand `AudioManager` the buffer instead of making it
      // de-interleave the whole song again.
      rememberDecodedBuffer(pcm, audioBuffer);
      decoded.push({name, pcm});
    } catch (err) {
      console.warn(`Could not decode ${file.fileName}:`, err);
    }
  }
  if (decoded.length === 0) {
    throw new Error('Could not decode any of this project’s audio files');
  }

  const songIndex = decoded.findIndex(entry => entry.name === 'song');
  const [fullMix] = decoded.splice(songIndex === -1 ? 0 : songIndex, 1);
  return {
    fullMixName: fullMix.name,
    fullMixPcm: fullMix.pcm,
    stems: decoded.map(entry => ({
      name: entry.name,
      pcm: entry.pcm,
      origin: 'chart-file' as const,
    })),
    meta: {sampleRate, channels: PACKAGE_AUDIO_CHANNELS},
  };
}

/** `AudioManager` folds every file whose name contains `drums` into one
 *  `drums` track, so a package that ships its own drums audio has no room
 *  for a separated `drums` stem: adding one would silently play under the
 *  package's fader and double the kit. */
export function packageHasDrumsAudio(pkg: DecodedPackageAudio): boolean {
  return (
    pkg.fullMixName.includes(DRUMS_STEM) ||
    pkg.stems.some(stem => stem.name.includes(DRUMS_STEM))
  );
}

/**
 * What an export can do about the chart's leading silence, given the audio
 * that is actually in memory.
 *
 * `raw` — no silence to account for, so the package's files ship verbatim.
 * `padded` — the chart has moved and the decoded PCM is here to move the
 * audio with it.
 * `blocked` — the chart has moved and the PCM is NOT here, because the editor
 * opens before the song finishes decoding and a decode can fail outright.
 * There is no honest export in that state: shipping the files unpadded pairs
 * a chart shifted by whole bars with audio that never moved, and nothing
 * downstream can tell that happened.
 */
export type ExportAudioPlan =
  | {kind: 'raw'}
  | {kind: 'padded'; padSamples: number}
  | {kind: 'blocked'};

export function planExportAudio(
  pkg: DecodedPackageAudio | null,
  anchor: {ms: number} | null,
): ExportAudioPlan {
  const shifted = anchor != null && anchor.ms > 0;
  if (!pkg) return shifted ? {kind: 'blocked'} : {kind: 'raw'};
  const padSamples = anchorPadSamples(anchor, pkg.meta.sampleRate);
  return padSamples > 0 ? {kind: 'padded', padSamples} : {kind: 'raw'};
}

/**
 * The package's own audio files, each padded by `padSamples` and re-encoded,
 * for an export of a chart that had leading silence added: every note moved
 * by that much, so the audio has to move with it. Opus when the browser has
 * a WebCodecs encoder for it, WAV otherwise — bigger, but a padded export
 * must never silently fall back to unpadded audio.
 *
 * Only the package's own audio is produced; a separated stem is a mixing
 * aid, not part of the chart. The stored audio at rest is never modified —
 * padding happens on the decoded copy.
 */
export async function padPackageAudio(
  pkg: DecodedPackageAudio,
  padSamples: number,
): Promise<AudioSource[]> {
  const {sampleRate, channels} = pkg.meta;
  const sources: AudioSource[] = [];
  for (const {name, pcm} of [
    {name: pkg.fullMixName, pcm: pkg.fullMixPcm},
    ...pkg.stems,
  ]) {
    const padded = padPcmStart(pcm, padSamples, channels);
    try {
      const opus = await encodePcmToOpus(padded, sampleRate, channels);
      sources.push({
        fileName: `${name}.opus`,
        data: opus.buffer as ArrayBuffer,
      });
    } catch {
      const wav = encodeWavBlob(padded, sampleRate, channels);
      sources.push({fileName: `${name}.wav`, data: await wav.arrayBuffer()});
    }
  }
  return sources;
}
