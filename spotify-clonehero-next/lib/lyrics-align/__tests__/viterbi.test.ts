/**
 * The reference implementation below is the straightforward dense-matrix
 * Viterbi. `forcedAlign` must agree with it frame for frame while it keeps
 * only sqrt(T)-sized buffers, because a dense T x L matrix is unallocatable
 * for a long song: 48 minutes of vocals (144 000 frames) against 359 lines
 * of lyrics is about 3.5e9 cells, and asking for that throws
 * "invalid array length" before any alignment happens.
 */

import {describe, test, expect} from '@jest/globals';
import {forcedAlign, type AlignedToken} from '../viterbi';

const NEG_INF = -1e30;

/** Dense O(T*L) forced alignment, used only as the expected answer. */
function referenceAlign(
  logProbs: Float32Array,
  T: number,
  C: number,
  tokens: number[],
  blankIdx = 0,
): AlignedToken[] {
  const S = tokens.length;
  if (S === 0) return [];

  const ctcTokens: number[] = [blankIdx];
  for (const t of tokens) {
    ctcTokens.push(t);
    ctcTokens.push(blankIdx);
  }
  const L = ctcTokens.length;

  const emit = new Float64Array(T * L);
  for (let t = 0; t < T; t++) {
    for (let s = 0; s < L; s++) {
      emit[t * L + s] = logProbs[t * C + ctcTokens[s]];
    }
  }

  const canSkip = new Uint8Array(L);
  for (let s = 2; s < L; s++) {
    if (ctcTokens[s] !== blankIdx && ctcTokens[s] !== ctcTokens[s - 2]) {
      canSkip[s] = 1;
    }
  }

  const dp = new Float64Array(T * L).fill(NEG_INF);
  const backptr = new Int32Array(T * L);
  dp[0] = emit[0];
  if (L > 1) dp[1] = emit[1];

  for (let t = 1; t < T; t++) {
    for (let s = 0; s < L; s++) {
      let best = dp[(t - 1) * L + s];
      let src = s;
      if (s > 0 && dp[(t - 1) * L + (s - 1)] > best) {
        best = dp[(t - 1) * L + (s - 1)];
        src = s - 1;
      }
      if (canSkip[s] && s > 1 && dp[(t - 1) * L + (s - 2)] > best) {
        best = dp[(t - 1) * L + (s - 2)];
        src = s - 2;
      }
      dp[t * L + s] = best + emit[t * L + s];
      backptr[t * L + s] = src;
    }
  }

  let s =
    dp[(T - 1) * L + (L - 1)] >= dp[(T - 1) * L + (L - 2)] ? L - 1 : L - 2;
  const pathS = new Int32Array(T);
  for (let t = T - 1; t >= 0; t--) {
    pathS[t] = s;
    s = backptr[t * L + s];
  }

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

/** Deterministic pseudo-random emissions, log-softmax normalized. */
function makeLogProbs(T: number, C: number, seed: number): Float32Array {
  let state = seed >>> 0;
  const next = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const out = new Float32Array(T * C);
  for (let t = 0; t < T; t++) {
    let sum = 0;
    for (let c = 0; c < C; c++) {
      const v = next() * 6;
      out[t * C + c] = v;
      sum += Math.exp(v);
    }
    const logSum = Math.log(sum);
    for (let c = 0; c < C; c++) out[t * C + c] -= logSum;
  }
  return out;
}

/** Emissions that spell `tokens` out, one token per `hold` frames. */
function makeSpelledLogProbs(
  T: number,
  C: number,
  tokens: number[],
  hold: number,
): Float32Array {
  const out = new Float32Array(T * C).fill(-20);
  for (let t = 0; t < T; t++) out[t * C] = -0.1; // blank elsewhere
  for (let i = 0; i < tokens.length; i++) {
    for (let h = 0; h < hold; h++) {
      const t = i * hold + h;
      if (t >= T) break;
      out[t * C] = -20;
      out[t * C + tokens[i]] = -0.1;
    }
  }
  return out;
}

describe('forcedAlign', () => {
  test('returns nothing for an empty token sequence or empty audio', () => {
    expect(forcedAlign(makeLogProbs(10, 8, 1), 10, 8, [])).toEqual([]);
    expect(forcedAlign(new Float32Array(0), 0, 8, [3, 4])).toEqual([]);
  });

  test('puts each token on the frames that spell it', () => {
    const tokens = [5, 6, 7, 8];
    const C = 12;
    const T = tokens.length * 3;
    const aligned = forcedAlign(
      makeSpelledLogProbs(T, C, tokens, 3),
      T,
      C,
      tokens,
    );
    expect(aligned.map(a => [a.tokenPos, a.startFrame, a.endFrame])).toEqual([
      [0, 0, 2],
      [1, 3, 5],
      [2, 6, 8],
      [3, 9, 11],
    ]);
  });

  // Frame counts chosen to land either side of the checkpoint interval, so
  // single-segment, exactly-segmented and ragged-tail backtraces all run.
  test.each([
    [1, 1],
    [2, 3],
    [7, 2],
    [64, 5],
    [128, 9],
    [200, 17],
    [513, 23],
  ])('matches the dense reference for T=%i, %i tokens', (T, nTokens) => {
    const C = 16;
    const logProbs = makeLogProbs(T, C, T * 31 + nTokens);
    const tokens: number[] = [];
    for (let i = 0; i < nTokens; i++) tokens.push(1 + ((i * 7) % (C - 1)));

    const expected = referenceAlign(logProbs.slice(), T, C, tokens);
    const actual = forcedAlign(logProbs.slice(), T, C, tokens);

    expect(
      actual.map(a => ({...a, score: Number(a.score.toFixed(9))})),
    ).toEqual(expected.map(a => ({...a, score: Number(a.score.toFixed(9))})));
  });

  test('matches the dense reference when a token repeats back to back', () => {
    const C = 10;
    const T = 40;
    const tokens = [3, 3, 4, 4, 4, 5];
    const logProbs = makeLogProbs(T, C, 99);
    expect(forcedAlign(logProbs.slice(), T, C, tokens)).toEqual(
      referenceAlign(logProbs.slice(), T, C, tokens),
    );
  });

  test('rejects a token index the vocabulary has no class for', () => {
    expect(() => forcedAlign(makeLogProbs(8, 6, 3), 8, 6, [2, 9])).toThrow(
      /outside the 6-class vocabulary/,
    );
  });

  test('reports progress from 0 up to 1 as it steps the frames', () => {
    const C = 12;
    const T = 600;
    const tokens: number[] = [];
    for (let i = 0; i < 40; i++) tokens.push(1 + (i % (C - 1)));

    const seen: number[] = [];
    forcedAlign(makeLogProbs(T, C, 5), T, C, tokens, 0, f => seen.push(f));

    expect(seen.length).toBeGreaterThan(10);
    expect(seen[0]).toBeLessThan(0.05);
    expect(seen[seen.length - 1]).toBe(1);
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]).toBeGreaterThan(seen[i - 1]);
      expect(seen[i]).toBeLessThanOrEqual(1);
    }
  });

  test('never allocates a buffer the size of the frames-by-states matrix', () => {
    const C = 16;
    const T = 4096;
    const tokens: number[] = [];
    for (let i = 0; i < 600; i++) tokens.push(1 + (i % (C - 1)));
    const L = 2 * tokens.length + 1;

    const lengths: number[] = [];
    type TypedArrayCtor = new (...args: never[]) => object;
    const spy = <T extends TypedArrayCtor>(ctor: T): T =>
      new Proxy(ctor, {
        construct(target, args) {
          if (typeof args[0] === 'number') lengths.push(args[0]);
          return Reflect.construct(target, args) as object;
        },
      });

    const real = {f64: Float64Array, i32: Int32Array, u8: Uint8Array};
    Object.assign(globalThis, {
      Float64Array: spy(Float64Array),
      Int32Array: spy(Int32Array),
      Uint8Array: spy(Uint8Array),
    });
    try {
      forcedAlign(makeLogProbs(T, C, 7), T, C, tokens);
    } finally {
      Object.assign(globalThis, {
        Float64Array: real.f64,
        Int32Array: real.i32,
        Uint8Array: real.u8,
      });
    }

    // sqrt(8*T) = 181 frames per segment, so the biggest buffers hold about
    // 181 * L cells; a dense matrix would hold T * L.
    expect(Math.max(...lengths)).toBeLessThan(T * L * 0.2);
  });
});
