/**
 * The one loudness normaliser for the mixes the SFX and loop-bed tools build:
 * the kit's mastering (./master.ts) puts the mix on the loudness target with
 * one static gain, so a build-to-drop contrast survives, and a look-ahead
 * true-peak limiter only where the peaks need it. ffmpeg's ebur128 then
 * reads the written file back as an independent check.
 */
import {integratedLoudness, truePeakDb} from './dsp';
import {applyMaster, master, type MasterResult} from './master';
import {writeWav, type Stereo} from './pcm';
import {ffmpegLoudness} from './verify';

export interface LoudnessTarget {
  /** Integrated loudness, LUFS. */
  lufs: number;
  /** True-peak ceiling, dBTP. */
  truePeakDb: number;
}

export interface LoudnessReport {
  /** The mix as it came in (in-house BS.1770). */
  input: {lufs: number; truePeakDb: number};
  /** The static gain, dB. */
  gainDb: number;
  /** The limiter's deepest gain reduction, dB (0 when no limiting was needed). */
  limiterMaxReductionDb: number;
  /** ebur128 on the written file. */
  output: {lufs: number; truePeakDb: number};
}

/**
 * Masters `mix` to `target` in place and writes it to `output` (24-bit,
 * atomically). Returns the report and the master (gain and limiter curve),
 * so a stem of the same mix can be given exactly the same treatment.
 */
export function normalizeLinear(
  mix: Stereo,
  output: string,
  target: LoudnessTarget,
): {report: LoudnessReport; master: MasterResult} {
  const input = {lufs: integratedLoudness(mix), truePeakDb: truePeakDb(mix)};
  const m = master([mix], target.lufs, target.truePeakDb);
  applyMaster([mix], m);
  writeWav(output, mix);
  return {
    report: {
      input,
      gainDb: m.gainDb,
      limiterMaxReductionDb: m.maxReductionDb,
      output: ffmpegLoudness(output),
    },
    master: m,
  };
}

/** Problems with a normalised file's reading against its target (empty when it is on target). */
export function loudnessProblems(
  out: {lufs: number; truePeakDb: number},
  target: LoudnessTarget,
): string[] {
  const problems: string[] = [];
  if (!(Math.abs(out.lufs - target.lufs) <= 0.5)) {
    problems.push(`loudness ${out.lufs} LUFS, target ${target.lufs}`);
  }
  if (!(out.truePeakDb <= target.truePeakDb)) {
    problems.push(
      `true peak ${out.truePeakDb} dBTP, ceiling ${target.truePeakDb}`,
    );
  }
  return problems;
}
