/**
 * In-place Cooley-Tukey radix-2 complex FFT with pre-computed twiddle table.
 *
 * Buffer is interleaved [re0, im0, re1, im1, ...] of length 2*n where n is a
 * power of 2. Forward transform only — iFFT is computed via FFT(conj(X)) / N.
 *
 * Twiddles are cached per FFT size: recomputing Math.cos/sin per butterfly
 * costs ~90M trig calls per bs-roformer chunk; the table drops that to one
 * log2(N) x N/2 prepare amortized over every FFT of that size.
 */

const twiddleCache = new Map<number, {wr: Float64Array; wi: Float64Array}>();

function getTwiddles(n: number) {
  let entry = twiddleCache.get(n);
  if (entry) return entry;
  // Flat arrays per stage, stored end-to-end. For butterfly span `size` we
  // need wr[k], wi[k] = cos/sin of -2πk/size. Concatenated across stages so
  // the inner loop reads sequentially.
  const wr = new Float64Array(n);
  const wi = new Float64Array(n);
  let off = 0;
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const step = (-2 * Math.PI) / size;
    for (let k = 0; k < half; k++) {
      wr[off + k] = Math.cos(step * k);
      wi[off + k] = Math.sin(step * k);
    }
    off += half;
  }
  entry = {wr, wi};
  twiddleCache.set(n, entry);
  return entry;
}

export function fftRadix2InPlace(buf: Float32Array, n: number): void {
  // Bit reversal
  let j = 0;
  for (let i = 0; i < n; i++) {
    if (i < j) {
      const a = i << 1,
        b = j << 1;
      let tr = buf[a];
      buf[a] = buf[b];
      buf[b] = tr;
      tr = buf[a + 1];
      buf[a + 1] = buf[b + 1];
      buf[b + 1] = tr;
    }
    let m = n >> 1;
    while (m >= 1 && j >= m) {
      j -= m;
      m >>= 1;
    }
    j += m;
  }
  // Butterflies — twiddles read from the precomputed table.
  const {wr, wi} = getTwiddles(n);
  let off = 0;
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    for (let i = 0; i < n; i += size) {
      for (let k = 0; k < half; k++) {
        const wrk = wr[off + k],
          wik = wi[off + k];
        const aIdx = (i + k) << 1;
        const bIdx = (i + k + half) << 1;
        const tr = buf[bIdx] * wrk - buf[bIdx + 1] * wik;
        const ti = buf[bIdx] * wik + buf[bIdx + 1] * wrk;
        buf[bIdx] = buf[aIdx] - tr;
        buf[bIdx + 1] = buf[aIdx + 1] - ti;
        buf[aIdx] = buf[aIdx] + tr;
        buf[aIdx + 1] = buf[aIdx + 1] + ti;
      }
    }
    off += half;
  }
}
