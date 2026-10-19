import {readFileSync} from 'fs';
import {join} from 'path';
import {linksegDecode, LINKSEG_LABELS} from '../linkseg-decode';

// Golden: Python post_process() output on song0's cached DGL activations. Locks the byte-exact
// decode (peak-pick + majority-vote) so a future JS refactor can't silently drift it.
const golden = JSON.parse(
  readFileSync(
    join(__dirname, 'fixtures', 'linkseg-decode-golden.json'),
    'utf8',
  ),
) as {
  bound: number[];
  label: number[];
  beatTimes: number[];
  duration: number;
  expected: {times: number[]; labels: string[]};
};

describe('linksegDecode byte-exact vs Python post_process', () => {
  it('reproduces the golden section times and labels', () => {
    const {times, labels} = linksegDecode(
      new Float32Array(golden.bound),
      new Float32Array(golden.label),
      golden.beatTimes,
      golden.duration,
      Object.keys(LINKSEG_LABELS).length,
      8,
      8,
      0,
    );
    expect(labels).toEqual(golden.expected.labels);
    expect(times).toHaveLength(golden.expected.times.length);
    for (let i = 0; i < times.length; i++) {
      expect(times[i]).toBeCloseTo(golden.expected.times[i], 6);
    }
  });
});
