/**
 * Serialization for the OPFS drum-stem cache (`tempo-map-stem-cache`):
 * a planar stereo stem packed into one Float32Array — the full left
 * channel (N samples) followed by the full right channel (N samples),
 * 2N total — then gzipped for storage. Gzip is lossless, so cache-hit
 * runs feed CRNN/Beat This! byte-identical audio to a fresh separation
 * (a lossy codec like Opus would break that guarantee); drum stems'
 * long near-silent stretches make it worthwhile anyway. Stereo is
 * required because the CRNN transcriber is a stereo model; a mono-only
 * cache would leave cache-hit runs with nothing to transcribe.
 */

export interface StereoStem {
  left: Float32Array;
  right: Float32Array;
}

/** Pack a planar stereo stem into a single [L‖R] buffer for storage.
 * Channels are truncated to the shorter of the two lengths. */
export function packStereoStem(stem: StereoStem): Float32Array<ArrayBuffer> {
  const n = Math.min(stem.left.length, stem.right.length);
  const packed = new Float32Array(n * 2);
  packed.set(stem.left.subarray(0, n), 0);
  packed.set(stem.right.subarray(0, n), n);
  return packed;
}

/**
 * Unpack a stored [L‖R] buffer back into planar stereo. Returns null when
 * the buffer isn't exactly 2×`sampleCount` floats (wrong song length or a
 * corrupt/legacy cache entry).
 */
export function unpackStereoStem(
  packed: Float32Array,
  sampleCount: number,
): StereoStem | null {
  if (packed.length !== sampleCount * 2) return null;
  return {
    left: packed.subarray(0, sampleCount),
    right: packed.subarray(sampleCount),
  };
}

/** Pump bytes through a gzip (de)compression transform. Written against
 * the stream classes directly — no Blob/Response — so it runs in web
 * workers and in Jest's node environment alike. The write side is not
 * awaited before reading: awaiting it first would deadlock once the
 * transform's internal queue fills. */
async function pumpThrough(
  bytes: Uint8Array<ArrayBuffer>,
  transform: {
    readable: ReadableStream<Uint8Array>;
    writable: WritableStream<BufferSource>;
  },
): Promise<Uint8Array<ArrayBuffer>> {
  const writer = transform.writable.getWriter();
  const writeDone = writer.write(bytes).then(() => writer.close());
  // If the transform errors, the reader loop below throws first and this
  // rejection would otherwise be unhandled.
  writeDone.catch(() => {});
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = transform.readable.getReader();
  for (;;) {
    const {done, value} = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  await writeDone;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** Pack and gzip a stereo stem into the bytes stored in OPFS. */
export async function encodeStemCacheBytes(
  stem: StereoStem,
): Promise<Uint8Array<ArrayBuffer>> {
  const packed = packStereoStem(stem);
  return pumpThrough(
    new Uint8Array(packed.buffer, 0, packed.byteLength),
    new CompressionStream('gzip'),
  );
}

/**
 * Gunzip and unpack stored cache bytes back into planar stereo. Returns
 * null for anything unusable: gunzip failure (corrupt or legacy raw-f32
 * entry), a byte count that isn't whole float32s, or a sample count that
 * doesn't match the expected song length.
 */
export async function decodeStemCacheBytes(
  bytes: Uint8Array<ArrayBuffer>,
  sampleCount: number,
): Promise<StereoStem | null> {
  let raw: Uint8Array<ArrayBuffer>;
  try {
    raw = await pumpThrough(bytes, new DecompressionStream('gzip'));
  } catch {
    return null;
  }
  if (raw.byteLength % 4 !== 0) return null;
  const packed = new Float32Array(raw.buffer, 0, raw.byteLength / 4);
  return unpackStereoStem(packed, sampleCount);
}

/** Mean-of-channels mono mixdown — the signal Beat This! and the
 * drum-onset stage consume. */
export function stereoStemToMono(stem: StereoStem): Float32Array {
  const n = Math.min(stem.left.length, stem.right.length);
  const mono = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    mono[i] = (stem.left[i] + stem.right[i]) * 0.5;
  }
  return mono;
}
