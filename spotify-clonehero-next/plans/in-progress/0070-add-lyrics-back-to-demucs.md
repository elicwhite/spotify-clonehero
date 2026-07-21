# 0070 — Move `/add-lyrics` back to Demucs

> Revised twice. The first draft claimed `/add-lyrics` re-separates on every
> align run and sold a new cache as the fix; that was false, and three rows of
> its cost table were wrong (contrarian review). Both corrected below. The
> second revision drops the cache entirely per the repo owner's call — this is
> now a straight revert of 0066 Phase 3.

## Context

Plan 0066 Phase 3 moved the standalone `/add-lyrics` page off Demucs onto the
shared BS-Roformer separator so all three ML pages would share one separator
and one fingerprint-keyed stem cache (`8bf4bd3`). Unification worked, but
`/add-lyrics` got materially slower. 0066 wrote its own escape hatch:

> If quality visibly regresses, that's a stop-ship signal for Phase 3
> specifically — Phases 1-2 don't depend on it and should ship regardless.
> — `plans/in-progress/0066-unified-stem-cache-and-audio-session.md`

That gate is firing, on latency rather than quality. **Phases 1, 2a, 2b, 2c
stay.** Only Phase 3's `/add-lyrics` separator swap is reverted.

### Where the added time goes

Structural costs read off the code, not benchmarks. They split into two very
different magnitudes, and only one can explain a "way slower" complaint:

**Minutes-scale — inherent to the model choice:**

| #   | Cost                                                                                                                                                                                                                                                                                                                                                                                         | Evidence                                                                         |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 1   | **2× model download.** BS-Roformer fp16 ~336 MB; htdemucs_fp32 ~169 MB. First run only (both OPFS-cached).                                                                                                                                                                                                                                                                                   | `separation-worker.ts:30-32`; deleted `demucs-worker.ts:82`                      |
| 2   | **~30% more inference steps, of much heavier work each.** Roformer: 176400-sample chunks at `overlapFrac 0.25` → 132300-sample step (3.0 s). Demucs: 343980-sample segments at 0.5 overlap → 171990-sample step (3.9 s). Steps are _not_ comparable units — a 4 s transformer window vs. a 7.8 s hybrid time+frequency window — so the real ratio is unknown and could be far more than 30%. | `stem-separation.ts:16,149,158-160`; deleted `demucs-worker.ts` `OVERLAP`/`STEP` |

**Seconds-scale — avoidable overhead this page pays for nothing:**

| #   | Cost                                                                                                                                                                                                                                                                                        | Evidence                                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| 3   | **Writes ~85 MB of drum PCM it never reads.** `separateStems` unconditionally gzips + stores the drums stem regardless of what was requested. (4-min song: 2 ch × 240 s × 44100 × 4 B.) The vocals Opus encode in the same block is cheap — WebCodecs `AudioEncoder`, faster than realtime. | `separate-stems.ts:159-176`; `lib/audio/opus-encoder.ts:1-10` |
| 4   | **Decodes the same file twice.** The page decodes via `AudioContext({sampleRate: 44100})`, then `separateStems` decodes the identical bytes again through `decodeAndResampleTo44k`.                                                                                                         | `AddLyricsClient.tsx:437-438`; `separate-stems.ts:151`        |
| 5   | **A main-thread `OfflineAudioContext` downmix+resample** to get 16 kHz mono out of the returned 44.1 kHz stereo. Demucs did this inside the worker.                                                                                                                                         | `lyrics-audio.ts:41-66`                                       |
| 6   | **Tier-2 encodes an ~85 MB WAV purely to have bytes to fingerprint**, which `separateStems` then decodes again.                                                                                                                                                                             | `AddLyricsClient.tsx:538-544`                                 |

Two costs an earlier draft listed were **wrong and are removed**: the four
Float32Arrays are _transferred_, not copied (`separation-worker.ts:123-128`),
so the boundary crossing is ~free; and the extra drum-stem iSTFT rides one
batched call pipelined behind GPU inference, so it's largely off the critical
path (`stem-separation.ts:3-6,204-234`).

**Consequence:** rows 3-6 cannot by themselves explain a minutes-scale
regression. If `/add-lyrics` is _much_ slower, it's rows 1-2 — the model.
Reverting the model is therefore the fix; rows 3-6 come along for free because
the Demucs path never had them.

### On caching — deliberately none

`/add-lyrics` today gets an accidental cache hit on repeat runs:
`separateStems` fingerprints the same `songFile.data` every time, stores
`vocals.opus`, and early-returns without spawning a worker
(`separate-stems.ts:119-147`); "Re-enter lyrics" preserves `chart` and `lyrics`
state (`AddLyricsClient.tsx:811-826`), so the second Align skips separation.

Dropping to an uncached Demucs path gives that up: **a repeat align re-separates
from scratch.** This is a known, accepted trade — the owner's call, taken after
the alternative (a 16 kHz mono cache tier keyed by a Demucs separator id) was
scoped. Revisit if repeat-run cost becomes annoying in practice; the shape of
that cache is described in this plan's git history.

## Goal

1. `/add-lyrics` separates vocals with Demucs again — same model, same worker,
   same 44.1 kHz→16 kHz mono output, no caching, i.e. exactly the pre-0066
   behavior.
2. Nothing else moves: `/tempo`, `/drum-transcription`, the roformer separator,
   `separateStems`, and the unified stem cache are untouched.

## Design

### Task 1 — Restore the Demucs worker and client

- `lib/lyrics-align/demucs-worker.ts`: restore verbatim from `8bf4bd3^`.
  Verified safe: `git diff 8bf4bd3^ HEAD` across `audio/stft.ts`,
  `lyrics-align/model-cache.ts`, and `lyrics-align/model-urls.ts` shows only
  `model-urls.ts` changed (the deletion of the demucs entry itself).
  `NFFT`/`HOP_LENGTH`/`SEGMENT_SAMPLES`/`computeSTFT`/`computeISTFT`/
  `createSTFTBuffers`/`createISTFTBuffers` all still exported
  (`stft.ts:27-37,103-277`); `getCachedModel`'s signature is unchanged
  (`model-cache.ts:69-75`); ORT is still pinned to 1.24.3 (`package.json:68`),
  matching the worker's CDN path. The model URL
  (`Ryan5453/demucs-next/htdemucs_fp32.onnx`) was confirmed live by the owner.
- `lib/lyrics-align/demucs-client.ts`: restore **only** `DemucsProgress` and
  `runDemucsInWorker`. The old file's other two exports (`resampleTo16kMono`,
  `mixStemsToAudioBuffer`) are separator-agnostic, already live in
  `lib/audio-pipeline/lyrics-audio.ts`, and are imported from there by
  `components/chart-editor/AddLyricsDialog.tsx`. They stay put; no re-export
  shim.
  One deliberate deviation from verbatim: an injectable
  `createWorker: () => Worker = defaultCreateDemucsWorker` last parameter,
  mirroring `runSeparationInWorker` (`separate-stems.ts:69-74`) — the test seam
  Task 3 needs. The two-phase `load`→`loaded`→`separate` handshake is unchanged.
- `lib/lyrics-align/model-urls.ts`: restore the `demucs` entry and its comment.

### Task 2 — Rewire `AddLyricsClient.tsx`

Both separation branches go back to `runDemucsInWorker`:

- **Pass 1** (`AddLyricsClient.tsx:418-474`): hand it the already-decoded
  `AudioBuffer` (killing cost #4 — no second decode of the same bytes).
- **Tier-2** (`AddLyricsClient.tsx:515-561`): hand it `mixedBuffer` directly;
  delete the `interleaveAudioBuffer`/`encodeWavBlob` WAV round-trip (cost #6).
- Progress detail returns to `p.message` (`Separating segment 12/61`) from the
  current `p.step`, which surfaces raw `'loading-model'`/`'processing'` enum
  values in the UI.

Ordering stays **separate → copy-for-waveform → `alignVocals`**. `alignVocals`
transfers `vocals16k` into the aligner worker (`aligner.ts:129`), detaching it,
which is why the waveform gets `new Float32Array(vocals16k)` (existing comment,
`AddLyricsClient.tsx:481-487`). Same hazard class as `5be949a` ("fix detached
ArrayBuffer crash"); handing `runDemucsInWorker` a live `AudioBuffer` rather
than reconstructing bytes from a detached one keeps it clear.

The bundled-vocals skip path (`AddLyricsClient.tsx:393-417`) is untouched — it
never runs a separator, so it's orthogonal to which model backs the branch that
does.

### Task 3 — Tests

New `lib/lyrics-align/__tests__/demucs-worker-client.test.ts`, modeled on
`lib/drum-transcription/ml/__tests__/roformer-separation-worker-client.test.ts`,
using the Task 1 `createWorker` seam: the `load`→`loaded`→`separate` handshake,
progress forwarding (message/percent/etaSeconds), result resolve +
`terminate()`, and error → reject + `terminate()`. The deleted code had no
tests; this closes that gap rather than reopening it.

No existing test references Demucs, so nothing breaks.

### Task 4 — Cleanup and bookkeeping

- Delete `resampleStereoTo16kMono` (`lyrics-audio.ts:41-66`) — `AddLyricsClient`
  is its only caller. `resampleTo16kMono`/`mixStemsToAudioBuffer` keep theirs.
  `separateStems`/`runSeparationInWorker` keep their `roformer-separation.ts`
  callers; nothing is removed from `separate-stems.ts`.
- Delete `InferenceResult`/`runInference` (`onnx-runtime.ts:139-186`) — the
  htdemucs-graph forward pass, dead since `8bf4bd3` and still dead after this
  plan (the restored worker calls `session.run` itself). `webgpu-check/page.tsx`
  defines its own local `runInference`.
- Fix stale copy: `DrumTranscriptionClient.tsx:827` credits Demucs for a page
  that runs BS-Roformer — wrong today, wrong after this plan. Same for the
  comments at `pipelineToSteps.ts:11,116`.
- Amend `plans/in-progress/0066-*.md`: record that Phase 3's `/add-lyrics` swap
  was reverted here by 0066's own stop-ship gate (fired on latency), that
  Phases 1/2a/2b/2c stand, and rewrite the "Done when" bullets asserting
  `/add-lyrics` runs BS-Roformer and Demucs is fully removed — so 0066 can be
  closed honestly instead of sitting in-progress against goals that no longer
  hold.

## Non-goals

- **No cache for `/add-lyrics`.** See "On caching" above.
- **The in-editor `AddLyricsDialog` stays on the roformer vocals stem.** It
  reads a stem the drum pipeline already separated and cached, at zero marginal
  cost; switching it to Demucs would _add_ a 169 MB download and a full
  separation pass to a flow that pays for neither. The two lyrics entry points
  using different separators follows from that asymmetry.
- **No `StemSeparator` interface.** Two separators exist, but no call site
  chooses between them at runtime.
- **Restore the Demucs worker's 44.1→16 kHz resample verbatim** — naive linear
  interpolation, no anti-aliasing. Not because the aligner is fragile:
  `AddLyricsDialog` already feeds it `OfflineAudioContext`-resampled roformer
  vocals against the same `lowConfidenceFrac >= 0.75` threshold
  (`AddLyricsDialog.tsx:167-171`, `aligner-worker.ts:674-676`) and ships that
  way. The reason is narrower — don't bundle an unmeasured signal-path change
  into a latency fix.
- No changes to `/tempo`, `/drum-transcription`, `roformer-separation.ts`,
  `separate-stems.ts`, or `stem-cache.ts`.

## Risks

- **Two models on disk again** for a user of both pages: 169 MB + 336 MB.
  Accepted — the pre-0066 state, and each is OPFS-cached after first download.
- **Repeat align runs re-separate** where today they cache-hit. Accepted; see
  "On caching."
- **Demucs may not be faster.** The plan rests on it. Validation measures the
  separate step both ways and records the numbers; if Demucs isn't clearly
  faster, the alternative is to keep one separator and give `separateStems` a
  vocals-only fast path (`includeDrums: false` mirroring the existing
  `includeVocals` flag at `stem-separation.ts:114,171-173`, skip the drums cache
  write, downmix in the worker) — that recovers rows 3-6 and nothing more.
- **Alignment quality should be _unchanged_, not merely similar** — this
  restores the exact separator, worker, and resample. Spot-check
  `lowConfidenceFrac` anyway; a shift in either direction means something else
  moved.

## Follow-ups (not this plan)

- `graphOptimizationLevel: 'disabled'` is set for the roformer graph in both
  workers with no comment (`separation-worker.ts:92`, `pipeline-worker.ts:164`)
  while a sibling session in the same file uses `'all'`
  (`pipeline-worker.ts:208`). If `'all'` works on that graph it's a free
  speedup for `/tempo` and `/drum-transcription`; if it's a known ORT/WebGPU
  workaround, it deserves a comment. Cheap to test, unrelated to this revert.
- OPFS reclamation of roformer entries `/add-lyrics` already wrote — 0066
  already deferred cache cleanup generally.

## Tasks

1. Restore `demucs-worker.ts`, `demucs-client.ts` (+ `createWorker` seam),
   `MODEL_URLS.demucs`.
2. Rewire both `AddLyricsClient` branches to `runDemucsInWorker`; drop the WAV
   round-trip.
3. Write `demucs-worker-client.test.ts`; run `pnpm test`, `pnpm typecheck`,
   `pnpm lint`.
4. Cleanup + plan 0066 bookkeeping.
5. Browser-validate, recording the separate-step measurement.

## Done when

- `/add-lyrics` runs Demucs for both pass 1 and tier-2; no `separateStems` or
  `resampleStereoTo16kMono` reference remains in `AddLyricsClient.tsx`.
- The separate step is clearly faster than the roformer baseline, with both
  numbers recorded here.
- The bundled-vocals skip path still works; tier-2 still triggers on a
  low-confidence bundled-stem chart and still improves the result.
- `/drum-transcription` and `/tempo` separate and cache exactly as before.
- `pnpm typecheck`, `pnpm test`, `pnpm lint` pass.
