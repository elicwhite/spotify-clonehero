import {readFileSync} from 'fs';
import {join} from 'path';
import {buildLinkSegWindows} from '../linkseg-windows';
import {LINKSEG_WIN_SAMPLES} from '../linkseg-mel';

// Golden: librosa-faithful beat-frame math on song0's raw Beat This! beats (processed beat times
// `bt` + per-window sample offsets `bf1`). Locks time_to_frames / fix_frames / downsample_frames /
// frames_to_time / edge-pad window extraction. Uses a ramp waveform (wave[i]=i) so each window's
// first sample reveals its extraction offset, verifying bf1 without shipping real audio.
const golden = JSON.parse(
  readFileSync(
    join(__dirname, 'fixtures', 'linkseg-windows-golden.json'),
    'utf8',
  ),
) as {
  rawBeats: number[];
  waveLen: number;
  pad: number;
  expectedBeatTimes: number[];
  expectedBf1: number[];
};

describe('buildLinkSegWindows beat-frame math', () => {
  it('reproduces processed beat times and window extraction offsets', () => {
    const {waveLen, pad} = golden;
    const ramp = new Float32Array(waveLen);
    for (let i = 0; i < waveLen; i++) ramp[i] = i;

    const {beatTimes, windows} = buildLinkSegWindows(golden.rawBeats, ramp);

    // processed beat times (bt)
    expect(beatTimes).toHaveLength(golden.expectedBeatTimes.length);
    for (let i = 0; i < beatTimes.length; i++) {
      expect(beatTimes[i]).toBeCloseTo(golden.expectedBeatTimes[i], 9);
    }

    // one window per beat, each exactly the window length
    expect(windows).toHaveLength(golden.expectedBf1.length);
    for (const w of windows) expect(w.length).toBe(LINKSEG_WIN_SAMPLES);

    // first sample of window k == edge-padded ramp at offset bf1[k]
    const paddedAt = (j: number) =>
      j < pad ? 0 : j < pad + waveLen ? j - pad : waveLen - 1;
    for (let k = 0; k < windows.length; k++) {
      expect(windows[k][0]).toBe(paddedAt(golden.expectedBf1[k]));
    }
  });
});
