// Port of LinkSeg post_processing.py (peak-pick boundaries + majority-vote labels).
// Byte-faithful to the reference: same window logic, same empty-window fallbacks (max_left=0,
// max_right=10), same argmax-first / mode-smallest-on-tie behavior, same midpoint beat averaging.

export const LINKSEG_LABELS: Record<number, string> = {
  0: 'silence',
  1: 'verse',
  2: 'chorus',
  3: 'intro',
  4: 'outro',
  5: 'inst',
  6: 'bridge',
};

function getIndices(
  beatTimes: number[],
  index: number,
  avgFuture: number,
  avgPast: number,
): [number, number] {
  let limitLeft = 0;
  let limitRight = beatTimes.length - 1;
  for (let i = index; i > 0; i--) {
    if (beatTimes[index] - beatTimes[i] > avgFuture) {
      limitLeft = i - 1;
      break;
    }
  }
  for (let i = index; i < beatTimes.length; i++) {
    if (beatTimes[i] - beatTimes[index] > avgPast) {
      limitRight = i - 1;
      break;
    }
  }
  return [limitLeft, limitRight];
}

function pickPeaksTimes(
  nc: Float32Array | number[],
  beatTimes: number[],
  maxFuture: number,
  maxPast: number,
  tau: number,
): number[] {
  const peaks: number[] = [];
  for (let i = 1; i < nc.length - 1; i++) {
    const [limitLeftMax, limitRightMax] = getIndices(beatTimes, i, maxFuture, maxPast);
    // max over j in (i-1 .. limitLeftMax], stepping down; empty -> 0
    let maxLeft = -Infinity;
    for (let j = i - 1; j > limitLeftMax; j--) maxLeft = Math.max(maxLeft, nc[j]);
    if (maxLeft === -Infinity) maxLeft = 0;
    // max over j in [i+1 .. limitRightMax); empty -> 10
    let maxRight = -Infinity;
    for (let j = i + 1; j < limitRightMax; j++) maxRight = Math.max(maxRight, nc[j]);
    if (maxRight === -Infinity) maxRight = 10;

    if (maxLeft < nc[i] && nc[i] > maxRight && nc[i] > tau) {
      peaks.push(i);
    }
  }
  return peaks;
}

function argmaxRow(label: Float32Array, row: number, nClasses: number): number {
  let best = 0;
  let bestVal = label[row * nClasses];
  for (let c = 1; c < nClasses; c++) {
    const v = label[row * nClasses + c];
    if (v > bestVal) {
      bestVal = v;
      best = c;
    }
  }
  return best; // first-max on ties, matching numpy argmax
}

function modeSmallest(values: number[]): number {
  // scipy.stats.mode: most frequent, smallest value on ties
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let bestVal = Infinity;
  let bestCount = -1;
  for (const [v, cnt] of counts) {
    if (cnt > bestCount || (cnt === bestCount && v < bestVal)) {
      bestCount = cnt;
      bestVal = v;
    }
  }
  return bestVal;
}

export type LinkSegDecode = {times: number[]; labels: string[]};

/**
 * @param bound  boundary activations, length N-1 (per mid-beat)
 * @param label  class activations, flat row-major (N x 7)
 * @param beatTimes processed beat times (s), length N (the ones the model saw)
 * @param duration song duration (s)
 */
export function linksegDecode(
  bound: Float32Array | number[],
  label: Float32Array,
  beatTimes: number[],
  duration: number,
  nClasses = 7,
  maxPast = 8,
  maxFuture = 8,
  tau = 0,
): LinkSegDecode {
  // midpoint-average adjacent beat times (matches post_process)
  const mid: number[] = [];
  for (let i = 0; i < beatTimes.length - 1; i++) mid.push((beatTimes[i] + beatTimes[i + 1]) / 2);

  const estIdxs = pickPeaksTimes(bound, mid, maxFuture, maxPast, tau);
  // est peaks never contain 0 (loop starts at i=1), so reference always prepends 0 when non-empty
  const idxsPadded: number[] = estIdxs.length > 0 ? [0, ...estIdxs] : [0];
  idxsPadded.push(mid.length - 1);

  const estLabels: string[] = [];
  for (let i = 0; i < idxsPadded.length - 1; i++) {
    const left = idxsPadded[i];
    const right = idxsPadded[i + 1];
    const preds: number[] = [];
    for (let r = left; r < right; r++) preds.push(argmaxRow(label, r, nClasses));
    const cls = preds.length > 0 ? modeSmallest(preds) : 0;
    estLabels.push(LINKSEG_LABELS[cls]);
  }

  const times = [0, ...estIdxs.map(i => mid[i]), duration];
  return {times, labels: estLabels};
}
