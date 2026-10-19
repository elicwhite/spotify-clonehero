/**
 * Beat This! minimal Postprocessor port.
 *
 * From beat_this.model.postprocessor.Postprocessor (type="minimal", fps=50):
 *   1. max-pool over ±3 frames (kernel=7, stride=1, padding=3); keep frames
 *      where logit == max-pool value AND logit > 0
 *   2. dedupe adjacent peaks (width=1): groups of frames each ≤ width apart
 *      collapse to a single mean position
 *   3. frame → seconds via /fps
 *   4. for each downbeat, snap to nearest beat
 *   5. unique the downbeats
 */

const PAD = 3; // kernel 7 → kernel/2
const DEDUP_WIDTH = 1;

/** PyTorch F.max_pool1d(x, kernel=7, stride=1, padding=3) for a 1-D array.
 * Padding values are -1000 (matches the Postprocessor's masked_fill). */
function maxPool1d(x: Float32Array): Float32Array {
  const N = x.length;
  const out = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    let mx = -1000;
    for (let k = i - PAD; k <= i + PAD; k++) {
      const v = k < 0 || k >= N ? -1000 : x[k];
      if (v > mx) mx = v;
    }
    out[i] = mx;
  }
  return out;
}

function pickPeaks(logits: Float32Array): number[] {
  const N = logits.length;
  const pooled = maxPool1d(logits);
  const peaks: number[] = [];
  for (let i = 0; i < N; i++) {
    if (logits[i] > 0 && logits[i] === pooled[i]) peaks.push(i);
  }
  return peaks;
}

/** Mirror of beat_this.postprocessor.deduplicate_peaks(width=1): groups of
 * adjacent peaks (each ≤ width frames apart) collapse to a running mean. */
export function deduplicatePeaks(
  peaks: number[],
  width = DEDUP_WIDTH,
): number[] {
  if (peaks.length === 0) return [];
  const out: number[] = [];
  let p = peaks[0];
  let c = 1;
  for (let i = 1; i < peaks.length; i++) {
    const p2 = peaks[i];
    if (p2 - p <= width) {
      c += 1;
      p += (p2 - p) / c; // running mean
    } else {
      out.push(p);
      p = p2;
      c = 1;
    }
  }
  out.push(p);
  return out;
}

/**
 * Take raw frame-wise logits, return PP beats + downbeats in seconds.
 */
export function runPostprocessor({
  beatLogits,
  downbeatLogits,
  fps,
}: {
  beatLogits: Float32Array;
  downbeatLogits: Float32Array;
  fps: number;
}): {beats: number[]; downbeats: number[]} {
  const beatFrames = deduplicatePeaks(pickPeaks(beatLogits));
  const downbeatFrames = deduplicatePeaks(pickPeaks(downbeatLogits));

  const beats = beatFrames.map(f => f / fps);

  // snap each downbeat to the nearest beat (by time, not frame)
  let downbeats = downbeatFrames.map(f => f / fps);
  if (beats.length > 0) {
    downbeats = downbeats.map(d => {
      let lo = 0,
        hi = beats.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (beats[mid] < d) lo = mid + 1;
        else hi = mid;
      }
      // lo is the first beat >= d; check lo-1 too
      let best = beats[lo];
      if (lo > 0 && Math.abs(beats[lo - 1] - d) <= Math.abs(beats[lo] - d)) {
        best = beats[lo - 1];
      }
      return best;
    });
    downbeats = Array.from(new Set(downbeats));
    downbeats.sort((a, b) => a - b);
  }

  return {beats, downbeats};
}
