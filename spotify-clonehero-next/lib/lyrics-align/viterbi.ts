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

/**
 * CTC forced alignment using Viterbi algorithm.
 *
 * @param logProbs Float32Array of shape [T, C] (row-major)
 * @param T number of frames
 * @param C number of classes (vocabulary size)
 * @param tokens array of token indices to align
 * @param blankIdx index of the blank/pad token (usually 0)
 * @returns list of aligned tokens with frame positions
 */
export function forcedAlign(
  logProbs: Float32Array,
  T: number,
  C: number,
  tokens: number[],
  blankIdx: number = 0,
): AlignedToken[] {
  const S = tokens.length;
  if (S === 0) return [];

  // Build CTC token sequence with blanks: b t1 b t2 b ... tS b
  const ctcTokens: number[] = [blankIdx];
  for (const t of tokens) {
    ctcTokens.push(t);
    ctcTokens.push(blankIdx);
  }
  const L = ctcTokens.length;

  // Precompute emission scores: emit[t][s] = logProbs[t, ctcTokens[s]]
  const emit = new Float64Array(T * L);
  for (let t = 0; t < T; t++) {
    for (let s = 0; s < L; s++) {
      emit[t * L + s] = logProbs[t * C + ctcTokens[s]];
    }
  }

  // Precompute skip mask
  const canSkip = new Uint8Array(L);
  for (let s = 2; s < L; s++) {
    if (ctcTokens[s] !== blankIdx && ctcTokens[s] !== ctcTokens[s - 2]) {
      canSkip[s] = 1;
    }
  }

  // Viterbi forward pass
  const dp = new Float64Array(T * L).fill(NEG_INF);
  const backptr = new Int32Array(T * L);

  dp[0 * L + 0] = emit[0 * L + 0];
  if (L > 1) dp[0 * L + 1] = emit[0 * L + 1];

  for (let t = 1; t < T; t++) {
    for (let s = 0; s < L; s++) {
      // Option 1: stay
      let best = dp[(t - 1) * L + s];
      let src = s;

      // Option 2: from s-1
      if (s > 0) {
        const fromPrev = dp[(t - 1) * L + (s - 1)];
        if (fromPrev > best) {
          best = fromPrev;
          src = s - 1;
        }
      }

      // Option 3: skip blank from s-2
      if (canSkip[s] && s > 1) {
        const fromSkip = dp[(t - 1) * L + (s - 2)];
        if (fromSkip > best) {
          best = fromSkip;
          src = s - 2;
        }
      }

      dp[t * L + s] = best + emit[t * L + s];
      backptr[t * L + s] = src;
    }
  }

  // Backtrace
  let s =
    dp[(T - 1) * L + (L - 1)] >= dp[(T - 1) * L + (L - 2)] ? L - 1 : L - 2;

  const pathS = new Int32Array(T);
  for (let t = T - 1; t >= 0; t--) {
    pathS[t] = s;
    s = backptr[t * L + s];
  }

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
