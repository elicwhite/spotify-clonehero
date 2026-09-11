/**
 * CTC Viterbi forced alignment.
 *
 * Given log probabilities (T frames x C classes) and a token sequence,
 * finds the optimal CTC alignment path using the Viterbi algorithm.
 *
 * Ported from ~/projects/vocal-alignment/browser-aligner/src/viterbi.ts
 */

export interface AlignedToken {
  tokenPos: number;
  startFrame: number;
  endFrame: number;
  score: number;
}

const NEG_INF = -1e30;

/** Backpointer codes: the state the best path came from at the frame before. */
const FROM_SAME = 0;
const FROM_PREV = 1;
const FROM_SKIP = 2;

/**
 * Frames between saved dp rows.
 *
 * The forward pass keeps one dp row every K frames, and the backtrace
 * recomputes the backpointers of one segment at a time from the row saved
 * at its start. Peak bytes are 8*T*L/K for the saved rows plus K*L for the
 * one segment of backpointers, which is smallest at K = sqrt(8*T).
 */
function checkpointInterval(T: number): number {
  return Math.min(T, Math.max(1, Math.round(Math.sqrt(8 * T))));
}

/**
 * CTC forced alignment using Viterbi algorithm.
 *
 * Memory is O((T/K + K) * L) for K = sqrt(8*T), not O(T * L): a full T x L
 * dynamic-programming matrix is far past what a browser can allocate for a
 * long song. A 48 minute song with 24 000 CTC states needs about 50 MB here,
 * where dense matrices would ask for about 60 GB.
 *
 * @param logProbs Float32Array of shape [T, C] (row-major)
 * @param T number of frames
 * @param C number of classes (vocabulary size)
 * @param tokens array of token indices to align
 * @param blankIdx index of the blank/pad token (usually 0)
 * @param onProgress called with a 0..1 fraction as the frames are stepped
 * @returns list of aligned tokens with frame positions
 */
export function forcedAlign(
  logProbs: Float32Array,
  T: number,
  C: number,
  tokens: number[],
  blankIdx: number = 0,
  onProgress?: (fraction: number) => void,
): AlignedToken[] {
  const S = tokens.length;
  if (S === 0 || T <= 0) return [];

  // Build CTC token sequence with blanks: b t1 b t2 b ... tS b
  const L = 2 * S + 1;
  const ctcTokens = new Int32Array(L);
  ctcTokens[0] = blankIdx;
  for (let i = 0; i < S; i++) {
    ctcTokens[2 * i + 1] = tokens[i];
    ctcTokens[2 * i + 2] = blankIdx;
  }
  for (let s = 0; s < L; s++) {
    if (ctcTokens[s] < 0 || ctcTokens[s] >= C) {
      throw new Error(
        `Token index ${ctcTokens[s]} is outside the ${C}-class vocabulary`,
      );
    }
  }

  // Precompute skip mask
  const canSkip = new Uint8Array(L);
  for (let s = 2; s < L; s++) {
    if (ctcTokens[s] !== blankIdx && ctcTokens[s] !== ctcTokens[s - 2]) {
      canSkip[s] = 1;
    }
  }

  // Emission scores are read one frame at a time. A frame is C values wide,
  // so it stays in cache for the whole sweep over the L states.
  const frameLogProbs = new Float64Array(C);
  const loadFrame = (t: number) => {
    const off = t * C;
    for (let c = 0; c < C; c++) frameLogProbs[c] = logProbs[off + c];
  };

  /** One Viterbi frame: cur[s] from prev[], backpointers into back[off..]. */
  const step = (
    t: number,
    prevRow: Float64Array,
    curRow: Float64Array,
    back: Uint8Array,
    off: number,
  ) => {
    loadFrame(t);
    for (let s = 0; s < L; s++) {
      // Option 1: stay
      let best = prevRow[s];
      let src = FROM_SAME;

      // Option 2: from s-1
      if (s > 0) {
        const fromPrev = prevRow[s - 1];
        if (fromPrev > best) {
          best = fromPrev;
          src = FROM_PREV;
        }
      }

      // Option 3: skip blank from s-2
      if (s > 1 && canSkip[s]) {
        const fromSkip = prevRow[s - 2];
        if (fromSkip > best) {
          best = fromSkip;
          src = FROM_SKIP;
        }
      }

      curRow[s] = best + frameLogProbs[ctcTokens[s]];
      back[off + s] = src;
    }
  };

  // The forward pass and the backtrace each step every frame once, so a long
  // song grinds for a minute or more. Report every 1% of that.
  const totalSteps = 2 * Math.max(1, T - 1);
  let stepsDone = 0;
  let nextReport = 0;
  const tick = () => {
    stepsDone++;
    if (onProgress && stepsDone >= nextReport) {
      nextReport = stepsDone + Math.ceil(totalSteps / 100);
      onProgress(stepsDone / totalSteps);
    }
  };

  // Viterbi forward pass, keeping every K-th dp row
  const K = checkpointInterval(T);
  const nSegments = Math.ceil((T - 1) / K);
  const checkpoints = new Float64Array(nSegments * L);

  let prev = new Float64Array(L).fill(NEG_INF);
  loadFrame(0);
  prev[0] = frameLogProbs[ctcTokens[0]];
  if (L > 1) prev[1] = frameLogProbs[ctcTokens[1]];
  if (nSegments > 0) checkpoints.set(prev, 0);

  let cur = new Float64Array(L);
  const rowBack = new Uint8Array(L);
  for (let t = 1; t < T; t++) {
    step(t, prev, cur, rowBack, 0);
    const spare = prev;
    prev = cur;
    cur = spare;
    if (t % K === 0 && t / K < nSegments) {
      checkpoints.set(prev, (t / K) * L);
    }
    tick();
  }

  // Backtrace, one segment of recomputed backpointers at a time
  let s = prev[L - 1] >= prev[L - 2] ? L - 1 : L - 2;

  const pathS = new Int32Array(T);
  const segBack = new Uint8Array(nSegments > 0 ? K * L : 0);
  let t = T - 1;
  for (let j = nSegments - 1; j >= 0; j--) {
    const segStart = j * K;
    const segEnd = Math.min(segStart + K, T - 1);

    let p = prev;
    p.set(checkpoints.subarray(j * L, j * L + L));
    let q = cur;
    for (let f = segStart + 1; f <= segEnd; f++) {
      step(f, p, q, segBack, (f - segStart - 1) * L);
      const spare = p;
      p = q;
      q = spare;
      tick();
    }

    while (t > segStart) {
      pathS[t] = s;
      const code = segBack[(t - segStart - 1) * L + s];
      if (code === FROM_PREV) s -= 1;
      else if (code === FROM_SKIP) s -= 2;
      t--;
    }
  }
  pathS[0] = s;
  onProgress?.(1);

  // Extract token spans (skip blanks)
  const aligned: AlignedToken[] = [];
  let tokenPos = 0;
  let i = 0;

  while (i < T) {
    const ctcIdx = pathS[i];
    const tok = ctcTokens[ctcIdx];

    if (tok === blankIdx) {
      i++;
      continue;
    }

    const startFrame = i;
    let scoreSum = logProbs[i * C + tok];
    let count = 1;
    let j = i + 1;

    while (j < T && ctcTokens[pathS[j]] === tok && pathS[j] === ctcIdx) {
      scoreSum += logProbs[j * C + tok];
      count++;
      j++;
    }

    if (tokenPos < tokens.length) {
      aligned.push({
        tokenPos,
        startFrame,
        endFrame: j - 1,
        score: scoreSum / count,
      });
    }
    tokenPos++;
    i = j;
  }

  return aligned;
}
