/**
 * `nativeDecodeRate` — which rate a file decodes at without Web Audio
 * resampling it on the way out.
 *
 * Getting this wrong is never a correctness bug: the decode still produces
 * the right samples, it just runs the implicit resample the caller was trying
 * to avoid, which on an album-length song is seconds. So these pin the
 * containers that actually carry Opus, and the fallback for everything else.
 */

import {nativeDecodeRate} from '../decode-audio';

function bytes(...values: number[]): Uint8Array {
  return new Uint8Array(values);
}

describe('nativeDecodeRate', () => {
  it('reads Ogg as 48k', () => {
    // 'OggS'
    expect(nativeDecodeRate(bytes(0x4f, 0x67, 0x67, 0x53, 0, 0))).toBe(48000);
  });

  it('reads WebM/Matroska as 48k', () => {
    expect(nativeDecodeRate(bytes(0x1a, 0x45, 0xdf, 0xa3, 0, 0))).toBe(48000);
  });

  it('reads an ISO base media file as 48k', () => {
    // A leading box size, then 'ftyp' at offset 4 — .mp4 / .m4a.
    expect(nativeDecodeRate(bytes(0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70))).toBe(
      48000,
    );
  });

  it('falls back to 44.1k for everything else', () => {
    // 'ID3' (mp3), 'RIFF' (wav), 'fLaC'.
    expect(nativeDecodeRate(bytes(0x49, 0x44, 0x33, 0x04))).toBe(44100);
    expect(nativeDecodeRate(bytes(0x52, 0x49, 0x46, 0x46))).toBe(44100);
    expect(nativeDecodeRate(bytes(0x66, 0x4c, 0x61, 0x43))).toBe(44100);
  });

  it('does not read past the end of a short buffer', () => {
    expect(nativeDecodeRate(bytes())).toBe(44100);
    expect(nativeDecodeRate(bytes(0x4f, 0x67))).toBe(44100);
    expect(nativeDecodeRate(bytes(0, 0, 0, 0x20, 0x66))).toBe(44100);
  });
});
