/**
 * Minimal .npz/.npy reader for test fixtures (uncompressed savez, float32
 * arrays only — the dtype browser-pipeline's dump_reference.py writes).
 */

export interface NpyArray {
  dtype: string;
  shape: number[];
  data: Float32Array;
}

export function parseNpz(arrayBuffer: ArrayBuffer): Record<string, NpyArray> {
  const view = new DataView(arrayBuffer);
  // Scan from the end for the EOCD signature 0x06054b50.
  let eocd = -1;
  for (
    let i = arrayBuffer.byteLength - 22;
    i >= 0 && i >= arrayBuffer.byteLength - 65557;
    i--
  ) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('npz: EOCD not found');
  const cdOffset = view.getUint32(eocd + 16, true);
  const cdEntries = view.getUint16(eocd + 10, true);

  const out: Record<string, NpyArray> = {};
  let p = cdOffset;
  for (let e = 0; e < cdEntries; e++) {
    if (view.getUint32(p, true) !== 0x02014b50) throw new Error('npz: bad CD sig');
    const compMethod = view.getUint16(p + 10, true);
    const compSize = view.getUint32(p + 20, true);
    const fnLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localOffset = view.getUint32(p + 42, true);
    const fname = new TextDecoder().decode(new Uint8Array(arrayBuffer, p + 46, fnLen));
    if (compMethod !== 0) {
      throw new Error(`npz: ${fname} compressed; savez (not savez_compressed) required`);
    }
    const lhFnLen = view.getUint16(localOffset + 26, true);
    const lhExtraLen = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + lhFnLen + lhExtraLen;
    out[fname.replace(/\.npy$/, '')] = parseNpy(arrayBuffer, dataStart, compSize);
    p += 46 + fnLen + extraLen + commentLen;
  }
  return out;
}

function parseNpy(arrayBuffer: ArrayBuffer, offset: number, _length: number): NpyArray {
  const v = new DataView(arrayBuffer);
  if (v.getUint8(offset) !== 0x93) throw new Error('npy: bad magic');
  const major = v.getUint8(offset + 6);
  let headerLen: number;
  if (major >= 2) {
    headerLen = v.getUint32(offset + 8, true);
    offset += 12;
  } else {
    headerLen = v.getUint16(offset + 8, true);
    offset += 10;
  }
  const headerStr = new TextDecoder().decode(
    new Uint8Array(arrayBuffer, offset, headerLen),
  );
  const descrMatch = headerStr.match(/'descr':\s*'([^']+)'/);
  const shapeMatch = headerStr.match(/'shape':\s*\(([^)]*)\)/);
  if (!descrMatch || !shapeMatch) throw new Error('npy: header parse failed');
  const dtype = descrMatch[1];
  const shape = shapeMatch[1]
    .split(',')
    .map(s => s.trim())
    .filter(s => s.length)
    .map(Number);
  const dataOff = offset + headerLen;
  if (dtype !== '<f4' && dtype !== '|f4') {
    throw new Error(`npy: unsupported dtype ${dtype}`);
  }
  const numEls = shape.reduce((a, b) => a * b, 1);
  const byteLen = numEls * 4;
  const owned = new ArrayBuffer(byteLen);
  new Uint8Array(owned).set(new Uint8Array(arrayBuffer, dataOff, byteLen));
  return {dtype, shape, data: new Float32Array(owned)};
}
