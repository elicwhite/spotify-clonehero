# 0059 — Stereo tempo-map stem cache (fix /tempo reload crash)

## Problem

Reloading /tempo and selecting the same song crashes with "Drum-stem
separation did not produce audio for CRNN transcription."

Root cause: the tempo worker's OPFS stem cache (`tempo-map-stem-cache`)
stores only a MONO mixdown of the separated drum stem. On a cache hit the
worker deliberately leaves `PipelineResult.drumStemStereo` null
(`lib/tempo-map/pipeline-worker.ts`), but the CRNN transcriber is a stereo
model (`crnn-audio-prep.ts`), so `runTempoTrackFromPcm`
(`lib/drum-transcription/pipeline/tempo-track.ts`) has nothing to
transcribe and throws. The cache "successfully" skips separation while
producing an unusable result.

Duplicating cached mono into both CRNN channels is rejected: cached runs
would transcribe different audio than fresh runs, breaking the equivalence
guarantee tempo-track.ts documents.

## Approach

Make the drum-stem plumbing stereo end-to-end; the worker always surfaces
the stereo stem regardless of where it came from.

- **Cache format** (`pipeline-worker.ts`): store planar stereo in one
  `.f32` file — left channel (N floats) then right (N floats), 2N total.
  Bump `STEM_CACHE_VERSION` to a `v2_drums_stereo_…` id so old mono
  entries simply miss (one re-separation per song, then cached stereo).
  Best-effort prune of stale other-version cache files on save.
- **Pack/unpack helpers** in a new `lib/tempo-map/stem-cache-format.ts`
  (pure, unit-testable): pack stereo → Float32Array, unpack with length
  validation, mono mixdown derivation.
- **Request/options** (`types.ts`, `pipeline-client.ts`): replace the
  mono `drumStem` request field and `drumStemMono` option with
  `drumStemStereo: {left, right}` (planar 44.1 kHz). Worker derives the
  mono mixdown itself and seeds the cache in stereo, so a
  drum-transcription run seeds /tempo's cache usefully again.
- **Result** (`types.ts`): `drumStemStereo` is now present whenever a
  stem exists — own separation, OPFS cache hit, or caller-supplied
  (echoed back, buffers transferred). Update the doc comment.
- **tempo-track.ts**: pass caller stereo through; always consume
  `tempoResult.drumStemStereo` for CRNN (the input copy is detached by
  the transfer). Throw only if the result genuinely has no stem.
- **runner.ts** (`ensureSynctrack`): deinterleave the OPFS drum stem to
  planar stereo instead of mixing to mono.

## Validation

- New Jest tests for `stem-cache-format.ts`: round-trip, odd-length
  rejection, mixdown math.
- Existing suites (`tempo-track-equivalence.test.ts` etc.) stay green.
- `pnpm typecheck`, `pnpm lint` clean.
- Browser: run /tempo on the demo audio twice (second run after reload)
  — second run must cache-hit separation ("Reused drums from a previous
  run") AND complete CRNN + produce a tempo map without the error. Still
  pending: no debug-port Chrome / extension bridge was reachable from
  this session (same as plan 0058). Note the version bump means the
  FIRST run after this change re-separates even for previously cached
  songs; the fix shows on the run after that.
