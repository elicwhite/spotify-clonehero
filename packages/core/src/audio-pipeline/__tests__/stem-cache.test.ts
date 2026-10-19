import {
  computeStemFingerprint,
  packStereoStem,
  unpackStereoStem,
  stereoStemToMono,
  encodeStemCacheBytes,
  decodeStemCacheBytes,
  decodeStemCacheBytesAuto,
  storeStem,
  loadStem,
  hasStem,
  storeStemOpus,
  loadStemOpus,
  hasStemOpus,
} from '../stem-cache';
import {installFakeOPFS} from '../../drum-transcription/storage/__tests__/fake-opfs';

describe('computeStemFingerprint', () => {
  const audio = new Uint8Array([1, 2, 3, 4, 5]);
  const separatorId = 'model-a.onnx|drums|stereo|44100';

  it('is deterministic for the same audio + separator id', async () => {
    const a = await computeStemFingerprint(audio, separatorId);
    const b = await computeStemFingerprint(
      new Uint8Array([1, 2, 3, 4, 5]),
      separatorId,
    );
    expect(a).toBe(b);
  });

  it('accepts an ArrayBuffer and matches the Uint8Array result', async () => {
    const buf = audio.slice().buffer;
    expect(await computeStemFingerprint(buf, separatorId)).toBe(
      await computeStemFingerprint(audio, separatorId),
    );
  });

  it('changes when the audio bytes change', async () => {
    const a = await computeStemFingerprint(audio, separatorId);
    const b = await computeStemFingerprint(
      new Uint8Array([1, 2, 3, 4, 6]),
      separatorId,
    );
    expect(a).not.toBe(b);
  });

  it('changes when the separator id changes (e.g. model bump)', async () => {
    const a = await computeStemFingerprint(audio, separatorId);
    const b = await computeStemFingerprint(
      audio,
      'model-b.onnx|drums|stereo|44100',
    );
    expect(a).not.toBe(b);
  });

  it('is not fooled by moving bytes across the audio/id boundary', async () => {
    // audio="ab" id="c" vs audio="a" id="bc" — the NUL separator between
    // audio and id must keep these distinct.
    const a = await computeStemFingerprint(new TextEncoder().encode('ab'), 'c');
    const b = await computeStemFingerprint(new TextEncoder().encode('a'), 'bc');
    expect(a).not.toBe(b);
  });

  it('produces a 64-char lowercase hex SHA-256 digest', async () => {
    const fp = await computeStemFingerprint(audio, separatorId);
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('stem-cache format', () => {
  const left = Float32Array.from([0.1, 0.2, 0.3, 0.4]);
  const right = Float32Array.from([-0.1, -0.2, -0.3, -0.4]);

  it('round-trips a planar stereo stem through pack/unpack', () => {
    const packed = packStereoStem({left, right});
    expect(packed.length).toBe(8);

    const unpacked = unpackStereoStem(packed, 4);
    expect(unpacked).not.toBeNull();
    expect(Array.from(unpacked!.left)).toEqual(Array.from(left));
    expect(Array.from(unpacked!.right)).toEqual(Array.from(right));
  });

  it('packs [L‖R] planar, not interleaved', () => {
    const packed = packStereoStem({left, right});
    expect(Array.from(packed.subarray(0, 4))).toEqual(Array.from(left));
    expect(Array.from(packed.subarray(4))).toEqual(Array.from(right));
  });

  it('truncates to the shorter channel when lengths differ', () => {
    const packed = packStereoStem({left, right: right.subarray(0, 3)});
    expect(packed.length).toBe(6);
    const unpacked = unpackStereoStem(packed, 3);
    expect(Array.from(unpacked!.left)).toEqual([left[0], left[1], left[2]]);
  });

  it('rejects a buffer whose length does not match the expected sample count', () => {
    const packed = packStereoStem({left, right});
    // Wrong song length (different N) and legacy v1 mono entries (N floats
    // instead of 2N) both fail this check.
    expect(unpackStereoStem(packed, 3)).toBeNull();
    expect(unpackStereoStem(new Float32Array(4), 4)).toBeNull();
  });

  it('derives the mean-of-channels mono mixdown', () => {
    const mono = stereoStemToMono({
      left: Float32Array.from([1, 0.5, -1]),
      right: Float32Array.from([0, 0.5, 1]),
    });
    expect(Array.from(mono)).toEqual([0.5, 0.5, 0]);
  });

  it('gzip round-trips a stem bit-exactly', async () => {
    // Noise-like values (not exactly representable floats) so any lossy
    // storage path would show up as inequality.
    const n = 4096;
    const noisyLeft = new Float32Array(n);
    const noisyRight = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      noisyLeft[i] = Math.sin(i * 12.9898) * 0.7;
      noisyRight[i] = Math.sin(i * 78.233) * 0.7;
    }

    const bytes = await encodeStemCacheBytes({
      left: noisyLeft,
      right: noisyRight,
    });
    const decoded = await decodeStemCacheBytes(bytes, n);
    expect(decoded).not.toBeNull();
    expect(Array.from(decoded!.left)).toEqual(Array.from(noisyLeft));
    expect(Array.from(decoded!.right)).toEqual(Array.from(noisyRight));
  });

  it('compresses a part-silent stem below raw f32 size', async () => {
    // Realistic drum-stem shape: sparse hits separated by silence.
    const n = 44100;
    const stemLeft = new Float32Array(n);
    for (let i = 0; i < n; i += 8000) stemLeft[i] = 0.9;
    const bytes = await encodeStemCacheBytes({left: stemLeft, right: stemLeft});
    expect(bytes.length).toBeLessThan(n * 2 * 4);
  });

  it('decode returns null for corrupt (non-gzip) bytes', async () => {
    expect(
      await decodeStemCacheBytes(new Uint8Array([1, 2, 3, 4]), 1),
    ).toBeNull();
  });

  it('decode returns null when the sample count does not match', async () => {
    const bytes = await encodeStemCacheBytes({left, right});
    expect(await decodeStemCacheBytes(bytes, 5)).toBeNull();
  });

  it('unpacked channels view the packed buffer without copying', () => {
    const packed = packStereoStem({left, right});
    const unpacked = unpackStereoStem(packed, 4)!;
    expect(unpacked.left.buffer).toBe(packed.buffer);
    expect(unpacked.right.buffer).toBe(packed.buffer);
  });
});

describe('decodeStemCacheBytesAuto', () => {
  const left = Float32Array.from([0.1, 0.2, 0.3, 0.4, 0.5]);
  const right = Float32Array.from([-0.1, -0.2, -0.3, -0.4, -0.5]);

  it('round-trips encodeStemCacheBytes output without a known sample count', async () => {
    const bytes = await encodeStemCacheBytes({left, right});
    const decoded = await decodeStemCacheBytesAuto(bytes);
    expect(decoded).not.toBeNull();
    expect(Array.from(decoded!.left)).toEqual(Array.from(left));
    expect(Array.from(decoded!.right)).toEqual(Array.from(right));
  });

  it('returns null for corrupt (non-gzip) bytes', async () => {
    expect(
      await decodeStemCacheBytesAuto(new Uint8Array([1, 2, 3, 4])),
    ).toBeNull();
  });

  it('returns null for a gzip of an odd byte length', async () => {
    const bytes = await pumpThroughGzip(new Uint8Array([1, 2, 3]));
    expect(await decodeStemCacheBytesAuto(bytes)).toBeNull();
  });
});

/** Local gzip helper for constructing a malformed (odd-length) payload —
 * mirrors the module's internal pumpThrough, which isn't exported. */
async function pumpThroughGzip(
  bytes: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
  const cs = new CompressionStream('gzip');
  const writer = cs.writable.getWriter();
  const writeDone = writer.write(bytes).then(() => writer.close());
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = cs.readable.getReader();
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
  return out as Uint8Array<ArrayBuffer>;
}

describe('OPFS stem cache (fake OPFS)', () => {
  let fakeOpfs: {store: Map<string, ArrayBuffer>; reset: () => void};

  beforeEach(() => {
    fakeOpfs = installFakeOPFS();
  });

  it('storeStem then loadStem round-trips', async () => {
    const stem = {
      left: Float32Array.from([0.1, 0.2, 0.3]),
      right: Float32Array.from([-0.1, -0.2, -0.3]),
    };
    await storeStem('fp1', 'drums', stem);
    const loaded = await loadStem('fp1', 'drums');
    expect(loaded).not.toBeNull();
    expect(Array.from(loaded!.left)).toEqual(Array.from(stem.left));
    expect(Array.from(loaded!.right)).toEqual(Array.from(stem.right));
  });

  it('loadStem returns null on a cache miss', async () => {
    expect(await loadStem('does-not-exist', 'drums')).toBeNull();
  });

  it('storeStemOpus then loadStemOpus round-trips', async () => {
    const opusBytes = new Uint8Array([9, 8, 7, 6, 5]);
    await storeStemOpus('fp2', 'vocals', opusBytes);
    const loaded = await loadStemOpus('fp2', 'vocals');
    expect(loaded).not.toBeNull();
    expect(Array.from(loaded!)).toEqual(Array.from(opusBytes));
  });

  it('loadStemOpus returns null on a cache miss', async () => {
    expect(await loadStemOpus('does-not-exist', 'vocals')).toBeNull();
  });

  describe('hasStem / hasStemOpus existence probes', () => {
    it('hasStem is true after a successful store and false for a miss', async () => {
      const stem = {
        left: Float32Array.from([0.1, 0.2]),
        right: Float32Array.from([-0.1, -0.2]),
      };
      expect(await hasStem('fp-probe', 'drums')).toBe(false);
      await storeStem('fp-probe', 'drums', stem);
      expect(await hasStem('fp-probe', 'drums')).toBe(true);
      // A different stem name under the same fingerprint is still a miss.
      expect(await hasStem('fp-probe', 'bass')).toBe(false);
    });

    it('hasStemOpus is true after a successful store and false for a miss', async () => {
      expect(await hasStemOpus('fp-probe-opus', 'vocals')).toBe(false);
      await storeStemOpus('fp-probe-opus', 'vocals', new Uint8Array([1, 2, 3]));
      expect(await hasStemOpus('fp-probe-opus', 'vocals')).toBe(true);
    });
  });

  describe('atomic writes: interrupted stores are invisible', () => {
    /**
     * Simulates a first store() cut off before its writable closed. The
     * payload write itself is atomic (swap-on-close), so the only trace is
     * the zero-length file `getFileHandle(…, {create: true})` materialized,
     * and no completion marker. Written straight into the fake OPFS backing
     * store, bypassing the real write path.
     */
    function simulateInterruptedFirstStore(
      fingerprint: string,
      payloadName: string,
    ): void {
      const base = `/audio-pipeline/stem-cache/${fingerprint}/${payloadName}`;
      fakeOpfs.store.set(base, new ArrayBuffer(0));
      fakeOpfs.store.delete(`${base}.ok`);
    }

    it('an interrupted first store is invisible to loadStem and hasStem', async () => {
      simulateInterruptedFirstStore('fp-interrupted', 'drums.f32.gz');

      expect(await hasStem('fp-interrupted', 'drums')).toBe(false);
      expect(await loadStem('fp-interrupted', 'drums')).toBeNull();
    });

    it('an interrupted first store is invisible to loadStemOpus and hasStemOpus', async () => {
      simulateInterruptedFirstStore('fp-interrupted-opus', 'vocals.opus');

      expect(await hasStemOpus('fp-interrupted-opus', 'vocals')).toBe(false);
      expect(await loadStemOpus('fp-interrupted-opus', 'vocals')).toBeNull();
    });

    it('an interrupted re-store leaves the existing entry intact and readable', async () => {
      const stem = {
        left: Float32Array.from([0.1, 0.2]),
        right: Float32Array.from([-0.1, -0.2]),
      };
      await storeStem('fp-recompute', 'drums', stem);

      // A second storeStem() whose writable never closed: swap-on-close
      // means the previous payload — and its marker — are untouched, so a
      // valid entry stays valid rather than becoming a permanent miss.
      const dir = await navigator.storage.getDirectory();
      const entryDir = await (
        await (
          await dir.getDirectoryHandle('audio-pipeline')
        ).getDirectoryHandle('stem-cache')
      ).getDirectoryHandle('fp-recompute');
      const handle = await entryDir.getFileHandle('drums.f32.gz', {
        create: true,
      });
      const writable = await handle.createWritable();
      await writable.write(new Uint8Array([9, 9, 9]));
      // No close(): the store is interrupted here.

      expect(await hasStem('fp-recompute', 'drums')).toBe(true);
      const loaded = await loadStem('fp-recompute', 'drums');
      expect(loaded).not.toBeNull();
      expect(Array.from(loaded!.left)).toEqual(Array.from(stem.left));
    });

    it('storeStem after an interrupted first store succeeds normally and becomes visible', async () => {
      simulateInterruptedFirstStore('fp-heal', 'drums.f32.gz');
      expect(await hasStem('fp-heal', 'drums')).toBe(false);

      const stem = {
        left: Float32Array.from([0.25]),
        right: Float32Array.from([-0.25]),
      };
      await storeStem('fp-heal', 'drums', stem);

      expect(await hasStem('fp-heal', 'drums')).toBe(true);
      const loaded = await loadStem('fp-heal', 'drums');
      expect(loaded).not.toBeNull();
      expect(Array.from(loaded!.left)).toEqual(Array.from(stem.left));
    });

    it('a successful store marks the entry complete', async () => {
      await storeStem('fp-flag', 'drums', {
        left: Float32Array.from([0.5]),
        right: Float32Array.from([0.5]),
      });
      expect(
        fakeOpfs.store.has(
          '/audio-pipeline/stem-cache/fp-flag/drums.f32.gz.ok',
        ),
      ).toBe(true);
    });
  });

  describe('entries written before the completion marker existed', () => {
    /** A pre-marker entry: payload bytes only, no marker file. */
    function writeLegacyEntry(
      fingerprint: string,
      payloadName: string,
      payloadBytes: ArrayBuffer,
    ): void {
      fakeOpfs.store.set(
        `/audio-pipeline/stem-cache/${fingerprint}/${payloadName}`,
        payloadBytes,
      );
    }

    it('a valid unmarked stem loads and is marked complete on the way out', async () => {
      const stem = {
        left: Float32Array.from([0.1, 0.2, 0.3]),
        right: Float32Array.from([-0.1, -0.2, -0.3]),
      };
      const bytes = await encodeStemCacheBytes(stem);
      writeLegacyEntry(
        'fp-legacy',
        'drums.f32.gz',
        bytes.buffer as ArrayBuffer,
      );

      expect(await hasStem('fp-legacy', 'drums')).toBe(true);
      const loaded = await loadStem('fp-legacy', 'drums');
      expect(loaded).not.toBeNull();
      expect(Array.from(loaded!.left)).toEqual(Array.from(stem.left));
      expect(Array.from(loaded!.right)).toEqual(Array.from(stem.right));

      // Healed: the marker now exists, so later probes hit it directly.
      expect(
        fakeOpfs.store.has(
          '/audio-pipeline/stem-cache/fp-legacy/drums.f32.gz.ok',
        ),
      ).toBe(true);
      expect(await hasStem('fp-legacy', 'drums')).toBe(true);
    });

    it('a corrupt unmarked stem stays a miss and is not marked', async () => {
      writeLegacyEntry(
        'fp-legacy-corrupt',
        'drums.f32.gz',
        new Uint8Array([1, 2, 3, 4]).buffer,
      );

      expect(await loadStem('fp-legacy-corrupt', 'drums')).toBeNull();
      expect(
        fakeOpfs.store.has(
          '/audio-pipeline/stem-cache/fp-legacy-corrupt/drums.f32.gz.ok',
        ),
      ).toBe(false);
    });

    it('a valid unmarked opus stem loads and is marked complete on the way out', async () => {
      const opusBytes = new Uint8Array([9, 8, 7, 6, 5]);
      writeLegacyEntry(
        'fp-legacy-opus',
        'vocals.opus',
        opusBytes.buffer as ArrayBuffer,
      );

      expect(await hasStemOpus('fp-legacy-opus', 'vocals')).toBe(true);
      const loaded = await loadStemOpus('fp-legacy-opus', 'vocals');
      expect(loaded).not.toBeNull();
      expect(Array.from(loaded!)).toEqual(Array.from(opusBytes));
      expect(
        fakeOpfs.store.has(
          '/audio-pipeline/stem-cache/fp-legacy-opus/vocals.opus.ok',
        ),
      ).toBe(true);
    });

    it('an empty unmarked opus payload stays a miss and is not marked', async () => {
      writeLegacyEntry('fp-legacy-empty', 'vocals.opus', new ArrayBuffer(0));

      expect(await loadStemOpus('fp-legacy-empty', 'vocals')).toBeNull();
      expect(
        fakeOpfs.store.has(
          '/audio-pipeline/stem-cache/fp-legacy-empty/vocals.opus.ok',
        ),
      ).toBe(false);
    });
  });

  describe('corrupt entries', () => {
    it('loadStem returns null for a marker-gated but corrupt (non-gzip) payload', async () => {
      const stem = {
        left: Float32Array.from([0.1]),
        right: Float32Array.from([-0.1]),
      };
      await storeStem('fp-corrupt', 'drums', stem);
      // Overwrite the payload after the fact, keeping the marker file (and
      // hence hasStem's answer) intact - a corrupt-on-disk entry, not an
      // interrupted write.
      fakeOpfs.store.set(
        '/audio-pipeline/stem-cache/fp-corrupt/drums.f32.gz',
        new Uint8Array([1, 2, 3, 4]).buffer,
      );

      expect(await hasStem('fp-corrupt', 'drums')).toBe(true);
      expect(await loadStem('fp-corrupt', 'drums')).toBeNull();
    });

    it('loadStemOpus returns null when the marker exists but the payload file is missing', async () => {
      await storeStemOpus('fp-corrupt-opus', 'vocals', new Uint8Array([1]));
      fakeOpfs.store.delete(
        '/audio-pipeline/stem-cache/fp-corrupt-opus/vocals.opus',
      );

      expect(await loadStemOpus('fp-corrupt-opus', 'vocals')).toBeNull();
    });
  });
});
