import {runPostprocessor, deduplicatePeaks} from '../beat-this-pp';

function logitsWithPeaks(
  length: number,
  peaks: number[],
  value = 5,
): Float32Array {
  const arr = new Float32Array(length).fill(-5);
  for (const p of peaks) arr[p] = value;
  return arr;
}

describe('runPostprocessor', () => {
  test('converts isolated positive peaks to seconds at fps', () => {
    const beatLogits = logitsWithPeaks(500, [50, 100, 150, 200]);
    const downbeatLogits = logitsWithPeaks(500, [50, 200]);
    const {beats, downbeats} = runPostprocessor({
      beatLogits,
      downbeatLogits,
      fps: 50,
    });
    expect(beats).toEqual([1, 2, 3, 4]);
    expect(downbeats).toEqual([1, 4]);
  });

  test('ignores sub-threshold (logit <= 0) frames', () => {
    const beatLogits = new Float32Array(100).fill(-1);
    beatLogits[10] = -0.5; // local max but not > 0
    const {beats} = runPostprocessor({
      beatLogits,
      downbeatLogits: new Float32Array(100).fill(-5),
      fps: 50,
    });
    expect(beats).toEqual([]);
  });

  test('snaps downbeats to the nearest beat', () => {
    const beatLogits = logitsWithPeaks(500, [100, 200, 300]);
    // Downbeat peak at frame 205 → nearest beat frame 200 → 4.0s
    const downbeatLogits = logitsWithPeaks(500, [205]);
    const {downbeats} = runPostprocessor({beatLogits, downbeatLogits, fps: 50});
    expect(downbeats).toEqual([4]);
  });

  test('adjacent peaks within the max-pool window collapse', () => {
    // Two adjacent frames with the same value: max-pool keeps both, dedupe
    // collapses them to the running mean.
    const beatLogits = logitsWithPeaks(100, [40, 41]);
    const {beats} = runPostprocessor({
      beatLogits,
      downbeatLogits: new Float32Array(100).fill(-5),
      fps: 50,
    });
    expect(beats).toEqual([40.5 / 50]);
  });
});

describe('deduplicatePeaks', () => {
  test('collapses runs of adjacent peaks to a running mean', () => {
    // 10 and 11 merge to 10.5; 12 is then 1.5 frames away (> width) and
    // starts a new group — matches beat_this's running-mean semantics.
    expect(deduplicatePeaks([10, 11, 12, 50])).toEqual([10.5, 12, 50]);
  });
  test('keeps separated peaks', () => {
    expect(deduplicatePeaks([10, 20, 30])).toEqual([10, 20, 30]);
  });
  test('empty input', () => {
    expect(deduplicatePeaks([])).toEqual([]);
  });
});
