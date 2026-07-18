# 0060 — Gzip the tempo-map stem cache (lossless size reduction)

## Problem

`tempo-map-stem-cache` stores raw float32 PCM: ~85 MB per 4-minute song.
Opus was considered and rejected — it's inherently lossy, and cache-hit
runs must feed CRNN/Beat This! byte-identical audio to what a fresh run
would (the no-drift guarantee). Gzip is the free, fully lossless win:
drum stems have long near-silent stretches that compress well.

## Approach

- `lib/tempo-map/stem-cache-format.ts`: add async
  `encodeStemCacheBytes(stem)` / `decodeStemCacheBytes(bytes, sampleCount)`
  wrapping pack/unpack with native `CompressionStream('gzip')` /
  `DecompressionStream('gzip')`. Implemented against the stream classes
  directly (writer + reader pumped concurrently), so the helpers work in
  workers and in Jest's node environment without Blob/Response.
- Decode returns null on any corruption: gunzip failure, byte length not
  divisible by 4, sample-count mismatch (delegated to `unpackStereoStem`).
- `pipeline-worker.ts`: cache files become gzip bytes; key suffix
  `.f32.gz` and `STEM_CACHE_VERSION` bumped to `v3_…_gz_…` so v2 raw
  entries miss once and get pruned by the existing stale-version sweep.

## Validation

- Jest: round-trip equality, corrupt-input null, wrong-length null, and
  compressed-smaller-than-raw on a realistic (part-silent) stem.
- `pnpm typecheck` / lint clean; existing suites green.
- Browser double-run check on /tempo still pending browser access (same
  as plans 0058/0059).
