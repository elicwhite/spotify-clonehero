/**
 * Turning an arbitrarily-chunked audio stream into fixed-size overlapping
 * frames.
 *
 * Both live analyses need this and neither controls its own block size: the
 * microphone hands over whatever the audio thread chooses, which has nothing to
 * do with either hop. Carrying the remainder between calls is small but fiddly,
 * and getting it wrong shifts every frame by a sample or two forever, so it
 * lives in one place and owns its own buffer — a helper that handed the leftover
 * back would let a caller forget to keep it.
 */

const windowCache = new Map<number, Float32Array>();

/** Periodic Hann window of `size` samples, cached. Recomputing it per frame is
 *  a cosine per sample: at a 5 ms hop that is over two hundred thousand of them
 *  a second, on the thread doing the live analysis. */
export function hannWindow(size: number): Float32Array {
  const cached = windowCache.get(size);
  if (cached) return cached;
  const w = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / size));
  }
  windowCache.set(size, w);
  return w;
}

/** Slices a stream into overlapping frames of `frameSize`, advancing `hop`. */
export class FrameSlicer {
  #frameSize: number;
  #hop: number;
  #carry = new Float32Array(0);
  /** Samples consumed since the stream began, so callers can date frames. */
  #consumed = 0;

  constructor(frameSize: number, hop: number) {
    this.#frameSize = frameSize;
    this.#hop = hop;
  }

  /**
   * Calls `onFrame` for each whole frame the block completes.
   *
   * `endSampleIndex` counts from the start of the stream to the frame's last
   * sample, which is the moment a live estimate belongs to — the most recent
   * audio, not the middle of the window. The frame is a view, not a copy; do not
   * retain it.
   */
  push(
    block: Float32Array,
    onFrame: (frame: Float32Array, endSampleIndex: number) => void,
  ) {
    const merged = new Float32Array(this.#carry.length + block.length);
    merged.set(this.#carry, 0);
    merged.set(block, this.#carry.length);

    let offset = 0;
    while (merged.length - offset >= this.#frameSize) {
      onFrame(
        merged.subarray(offset, offset + this.#frameSize),
        this.#consumed + offset + this.#frameSize,
      );
      offset += this.#hop;
    }

    this.#consumed += offset;
    const carry = new Float32Array(merged.length - offset);
    carry.set(merged.subarray(offset));
    this.#carry = carry;
  }

  reset() {
    this.#carry = new Float32Array(0);
    this.#consumed = 0;
  }
}
