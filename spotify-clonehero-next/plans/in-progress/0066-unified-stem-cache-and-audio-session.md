# 0066 — Unify stem separation/caching; fix /tempo's missing drum-stem waveform; move /add-lyrics onto BS-Roformer

## Addendum (2026-07-20) — approved deviations during implementation

Two premises in the original investigation turned out to be false once the
code was traced during implementation. Both were surfaced and the repo owner
chose the correction; this addendum is the authoritative record. Phase 2's
design below is superseded where it conflicts with this.

1. **The two pages do NOT feed identical PCM to the separator.** `/tempo`
   resamples native→44.1k with **libsoxr** (`lib/tempo-map/resampler-soxr.ts`,
   used in `pipeline-worker.ts`); `/drum-transcription`'s `decodeAudio`
   decoded at the hardware `AudioContext` rate and resampled via **Web Audio
   `OfflineAudioContext`** (lossier, different). So the separated stems are
   not byte-identical across pages. **Decision: unify the resampler first
   (Phase 2a).** `/drum-transcription`'s decode now mirrors `/tempo`'s exact
   recipe — forced-native-rate decode (`decodeNativeRate`) + `resampleSoxr`
   per channel — via a shared `lib/audio-pipeline/decode-audio.ts`
   (`decodeAndResampleTo44k`). Required for cache-hit byte-exact
   reproducibility regardless of keying.

2. **The two pages fingerprint DIFFERENT byte streams.** `/tempo` hashes the
   original uploaded file; `/drum-transcription` hashes its *re-encoded*
   `song.opus` (`encodePcmToOpus`, opus-at-rest from 0063) — so a file-bytes
   key can never collide for realistic uploads (mp3/wav/sng, or any
   re-encoded opus). The original claim "same raw file bytes" held only for
   legacy `original.<ext>` projects. **Decision (owner): both pages store the
   original uploaded audio file verbatim and fingerprint THOSE bytes;
   conversion to Opus happens only at export, not at rest.** This reverts
   0063's opus-at-rest choice for `/drum-transcription` and **overrides the
   original non-goal "no change to `/drum-transcription`'s persisted project
   format."** Existing `song.opus` projects must keep working (back-compat
   read path); only new projects store the original. Tracked as Phase 2c.

Revised Phase 2 shape: **2a** resampler unification (shared decode module) →
**2b** unified cache module `lib/audio-pipeline/stem-cache.ts` keyed by
`computeStemFingerprint(originalUploadBytes, ROFORMER_SEPARATOR_ID)` →
**2c** `/drum-transcription` stores the original upload verbatim + fingerprints
it, Opus only at export, with back-compat for existing opus-at-rest projects.

## Context

`/tempo`'s piano-roll and highway waveforms currently show the full mix, not
the isolated drum stem the beat/tempo pipeline actually analyzed — visually
indistinguishable from `/drum-transcription`'s (correct) drum-stem waveform,
which is what surfaced this as a bug rather than an obviously-missing
feature. Investigating it turned up a real architectural question: three
pages (`/drum-transcription`, `/tempo`, `/add-lyrics`) each run an ML
pipeline before handing off to the shared `components/chart-editor/` shell,
and asked whether the pipeline/audio layer underneath them should be
re-architected for reuse the way the editor shell already has been.

This plan is scoped to the **audio pipeline / stem cache layer only**. The
editing/command layer has its own already-planned, already-scoped rework at
`plans/todo/0037-chart-editor-core-and-profile.md` (`lib/chart-editor-core`,
`ChartOperation`/`EntityAdapter`/`EditorProfile`) — that plan's "Out of
scope" section explicitly defers "audio service decoupling" to a phase-9
sub-task. This plan is that sub-task, scoped down to what's actually
justified today.

## Investigation summary

Full survey (file:line detail) is in the session transcript; the load-bearing
facts:

- **`/drum-transcription`** (`app/drum-transcription/components/EditorApp.tsx`)
  persists to OPFS: chart file, decoded onsets, audio anchor, and a
  fingerprint-keyed stem cache
  (`lib/drum-transcription/storage/stem-cache.ts`) at
  `drum-transcription/stem-cache/{fingerprint}/drums.pcm` — raw interleaved
  stereo Float32 @ 44.1kHz, uncompressed. `EditorApp` uses
  `usePaddedAudio({..., secondaryPcm: drumStemPcm, secondaryFileName:
  'drums.wav'})` and passes the padded stem to `ChartEditor` as
  `highwayAudioData`.
- **`/tempo`** (`app/tempo/TempoClient.tsx`) runs
  `lib/drum-transcription/pipeline/tempo-track.ts:runTempoTrack`, whose doc
  comment states it deliberately reuses drum-transcription's separation,
  Beat This!, CRNN, and KS-warp code ("the two features are structurally
  unable to install different grids for the same song" —
  `tempo-track-equivalence.test.ts`). That call chain goes through
  `lib/tempo-map/pipeline-client.ts` → `pipeline-worker.ts`, which separates
  the drum stem (BS-Roformer, same model) and holds it as
  `drumStemStereo` — but **never returns it** from
  `runTempoPipelineFromPcm`'s / `runTempoTrackFromPcm`'s result type. It's
  used internally for CRNN input and discarded. `TempoEditor` therefore
  calls `usePaddedAudio` with only `fullMixPcm`, no `secondaryPcm` — this is
  the whole bug, and `usePaddedAudio`'s existing `secondaryPcm`/
  `secondaryFileName` params are already generic enough to carry it; no hook
  change is needed, only plumbing the value through.
- **The two stem caches turn out to use the identical identity primitive**:
  drum-transcription's fingerprint is `SHA-256(rawFileBytes || 0x00 ||
  separatorId)` (`stem-cache.ts:computeStemFingerprint`); the tempo-map
  worker's `sourceHash` is `sha256Hex(sourceBytes)` on the exact same raw
  file bytes (`pipeline-client.ts:57-58`) — model/version identity is
  encoded separately in each (`DRUM_SEPARATOR_ID` vs
  `STEM_CACHE_VERSION`). Both caches store the **same model's** output
  losslessly — 0060 explicitly gzipped (not Opus-compressed) the tempo-map
  cache specifically to preserve byte-exact reproducibility for CRNN/Beat
  This! ("cache-hit runs must feed byte-identical audio to what a fresh run
  would"). So this isn't two different pieces of data with different
  correctness needs that happen to look similar — it's the **same
  separation output, computed and cached twice, under two different keys,
  in two different containers, in two different OPFS namespaces** —
  concrete, measurable duplication: run `/tempo` then `/drum-transcription`
  (or vice versa) on the same file today and it re-separates from scratch
  the second time, ~336MB model + full GPU pass, for data already sitting
  in OPFS under a different name.
- **`/add-lyrics`** (`app/add-lyrics/AddLyricsClient.tsx`) currently uses
  Demucs (`lib/lyrics-align/demucs-client.ts` → `demucs-worker.ts`,
  `htdemucs_fp32.onnx`, ~169MB), not BS-Roformer — plan 0063 explicitly
  decided at the time to keep it that way ("`[Eli]` `/add-lyrics` page
  unchanged (keeps Demucs). Only the editor flow uses the roformer vocals
  stem" — `plans/completed/0063-opus-storage-vocals-lyrics.md:26`). That
  decision is being revisited in this plan (see Phase 3) — Eli has now asked
  for `/add-lyrics` to move onto the same BS-Roformer pipeline so all three
  pages share one separator + one cache. `demucs-worker.ts` returns
  **vocals-only, mono, 16kHz** — it never surfaces the other Demucs stems it
  computes internally. `/add-lyrics` has no OPFS cache at all today: it
  re-separates on every run, or skips separation entirely if the loaded
  chart already ships a bundled `vocals` audio file (`AddLyricsClient.tsx`
  lines 186-188 detect it, lines 387-411 skip Demucs and just resample the
  bundled file). `AddLyricsDialog.tsx` (used from `EditorApp`, i.e. the
  *editor's* in-session "Add Lyrics" flow, a different code path from the
  standalone `/add-lyrics` page) already reuses the roformer vocals stem
  drum-transcription separated and cached — it hardcodes OPFS project calls
  inline and isn't reusable by another page as-is, but nothing today needs
  it to be; it has exactly one caller and Phase 3 doesn't change that.

## What this plan does NOT do, and why

A wider 6-layer "make everything generic" version of this plan was drafted
and then reviewed adversarially. The reviewer's objections held up against
the evidence and are adopted:

- **No pluggable `StemSeparator` interface.** With Phase 3, BS-Roformer
  becomes the *only* separator in production use (Demucs is fully retired,
  not run in parallel) — so there still isn't a call site that needs to pick
  between separators at runtime. An interface with one production
  implementer is a wrapper, not an abstraction. Revisit only if a genuinely
  different model needs runtime selection (e.g. a quality-fallback tier).
- **No generic N-stem bag on `usePaddedAudio`.** The proven needs — `/tempo`
  passing one drum stem, `/drum-transcription` passing one drum stem — are
  both already served by the hook's existing `secondaryPcm`/
  `secondaryFileName` shape. `/add-lyrics` (Phase 3) doesn't touch
  `usePaddedAudio` at all — its vocals PCM isn't a *playback* source, it's
  the aligner's input, same non-AudioManager role vocals PCM already plays
  in the editor's Add Lyrics flow today (`lyricsWaveData`, not a track).
  Widening to an arbitrary `Record<string, PCM>` still has no concrete
  driving requirement. If a future page needs 2+ AudioManager-registered
  stems simultaneously, generalize then.
- **No persistence-adapter injection for the stem cache.** `/tempo` and
  `/add-lyrics` don't persist a project today; both only need the
  *content-addressed* cache (Phase 2), which has no project/OPFS-project
  coupling to begin with — the whole point of fingerprint keys is that no
  caller-specific persistence adapter is needed. Revisit only if a
  non-OPFS-browser storage backend (e.g. server-side) is ever in scope.
- **No `AddLyricsDialog` decoupling.** Phase 3 gives `/add-lyrics` its own
  direct call into the shared separation+cache module (see below) rather
  than routing through `AddLyricsDialog.tsx`, which stays
  drum-transcription-editor-specific with its one caller. The existing
  `getChartFile`/`getAudioSources` callback pattern on `ChartEditor`'s
  `ExportDialog` remains the precedent to copy if a second *dialog* caller
  ever appears.

What's left — fixing the concrete bug, unifying the stem cache, and moving
`/add-lyrics` onto the shared separator — is kept in scope because all three
are backed by *already-measured* duplication/breakage or an explicit,
current ask, not projected future need.

## Goal

1. `/tempo`'s piano-roll and highway waveforms show the real separated drum
   stem, the same way `/drum-transcription`'s do.
2. There is one canonical stem cache all pipelines read and write, so
   separating the same file once (from any page) satisfies the others.
3. `/add-lyrics` separates vocals via BS-Roformer instead of Demucs, through
   the same cache — running `/add-lyrics` on a file already processed by
   `/tempo` or `/drum-transcription` cache-hits, and vice versa.
4. Neither existing pipeline regresses: no behavior change to what gets
   separated for drums/tempo, no loss of the byte-exact reproducibility
   guarantee 0059/0060 built for CRNN/Beat This!, no change to
   `/drum-transcription`'s persisted project format.

## Design

### Phase 1 — Return the drum stem from the shared pipeline stage

`lib/drum-transcription/pipeline/tempo-track.ts`: `TempoTrackResult` gains a
`drumStemStereo: StereoStem` field (not a generic bag — this pipeline
produces exactly one derived stem today; name it for what it is). Populate
it from the same `stereoStem` local variable the function already computes
at line ~116 for CRNN input — it's already in scope, just not returned.

`app/tempo/TempoClient.tsx`: retain `pipelineResult.drumStemStereo` on
`ResultState` (planar `{left, right}`, same shape used internally — convert
to the interleaved format `usePaddedAudio` expects, matching how
`EditorApp` converts its cached `drums.pcm`). Pass it to `usePaddedAudio` as
`secondaryPcm` (already-existing param) with `secondaryFileName: 'drums.wav'`
(already the default). Pass the padded result to `ChartEditor` as
`highwayAudioData`, exactly like `EditorApp` does today.

No hook changes. No new types beyond the one added field. This alone fixes
the reported bug.

### Phase 2 — One canonical stem cache

New module, `lib/audio-pipeline/stem-cache.ts` (new top-level namespace
under `lib/`, since it's no longer drum-transcription-specific):

- Reuses `computeStemFingerprint(audioBytes, separatorId)` verbatim (move,
  don't reimplement, from `lib/drum-transcription/storage/stem-cache.ts`) —
  the identity primitive both existing caches already independently landed
  on.
- Canonical on-disk format: gzip-compressed planar `[L‖R]` (the format 0060
  already validated as the right lossless choice) via the existing
  `packStereoStem`/`unpackStereoStem` + `encodeStemCacheBytes`/
  `decodeStemCacheBytes` (move from `lib/tempo-map/stem-cache-format.ts`,
  which has no other dependents).
- Canonical location: `audio-pipeline/stem-cache/{fingerprint}/{stemName}.f32.gz`.
- `separatorId` must fully capture inference-affecting parameters. Audit:
  today `DRUM_SEPARATOR_ID` (`${modelUrl}|drums|stereo|44100`) and
  `STEM_CACHE_VERSION` (`v3_drums_stereo_gz_44k1_overlap0.25_fp16_libsoxr`)
  encode overlapping but not identical facts (overlap/fp16/resampler only
  in the latter). Before unifying, confirm `roformer-separation.ts`'s
  actual inference call uses the same overlap/fp16/resampler config the
  tempo-map worker does; if so, extend `DRUM_SEPARATOR_ID` to include them
  explicitly (`|overlap0.25|fp16|libsoxr`) so the one canonical id is
  self-describing rather than relying on a human-maintained free-text
  version string to bump on drift.
- API: `storeStem(fingerprint, stemName, stem: StereoStem)`,
  `loadStem(fingerprint, stemName): Promise<StereoStem | null>` (null, not
  throw, on miss — matches the worker's existing call pattern more closely
  than drum-transcription's throw-on-miss; audit both call sites when
  migrating and adjust to the null-return contract, it's the safer default
  for a cache).
- Also keep an `Opus`-encoded variant for the vocals stem
  (`storeStemOpus`/`loadStemOpus`), moved verbatim from the existing
  drum-transcription module — same rationale as today (vocals aren't fed
  back into a byte-exact-required pipeline stage, so lossy Opus is fine and
  smaller).

**Migration is additive, not a flag day**: this is disposable, regenerable
derived data (re-running separation is slow but always correct — it can
never desync from a persisted chart the way, say, migrating `ChartDocument`
schemas could). No back-compat reads of the old locations are needed —
accept one cache miss per pre-existing cached song per pipeline on first
post-migration run, same cost as today's cross-page miss, just one-time
instead of permanent. Old cache directories (`drum-transcription/stem-cache/`,
`tempo-map-stem-cache/`) are simply abandoned; OPFS space isn't reclaimed
automatically, so add a one-line note or follow-up to clean them up (out of
scope for this plan — not urgent, OPFS quota isn't currently a monitored
constraint anywhere else in this codebase either).

Update both call sites to the new module:
- `lib/drum-transcription/ml/roformer-separation.ts`: `loadDrumStem`/
  `hasDrumStem`/`separateDrums`'s cache-store call switch to
  `lib/audio-pipeline/stem-cache.ts`. `loadVocalsStem`/`hasVocalsStem`
  switch to the moved Opus variant.
- `lib/tempo-map/pipeline-worker.ts`: `loadStemFromCache`/`saveStemToCache`
  switch to the new module's `loadStem`/`storeStem` (drop the worker-local
  gzip pack/unpack — it now lives in the shared module). Drop the
  worker-local stale-version prune (`STEM_CACHE_VERSION` sweep) since it
  become dead code once the version string folds into
  `DRUM_SEPARATOR_ID`/the fingerprint itself — a version bump now yields a
  *different* fingerprint that naturally never collides with the old one,
  same as the fingerprint cache already relies on.
- Delete `lib/drum-transcription/storage/stem-cache.ts` and
  `lib/tempo-map/stem-cache-format.ts` once both call sites are migrated
  and their existing tests (`lib/drum-transcription/__tests__/stem-cache.test.ts`,
  `lib/tempo-map/__tests__/stem-cache-format.test.ts`) are ported to
  `lib/audio-pipeline/__tests__/`.

### Phase 3 — `/add-lyrics` onto BS-Roformer, through the shared cache

**Why this is a clean swap, not a rewrite.** No test anywhere mocks
`demucs-client`/`demucs-worker`, and none of `lib/lyrics-align/__tests__/*`
(timing, chart-lyrics, frames, apply-lyrics, syllabify) reference the
separator — they operate downstream of whatever produced the vocals PCM.
`alignVocals` (`lib/lyrics-align/aligner.ts`) takes a bare `vocals16k:
Float32Array` — it has no opinion on where that came from. The two
non-Demucs-specific helpers `demucs-client.ts` exports —
`resampleTo16kMono`/`mixStemsToAudioBuffer` — are already separator-agnostic
and already used against roformer output today
(`components/chart-editor/AddLyricsDialog.tsx` calls `resampleTo16kMono` on
the roformer vocals stem for the *editor's* Add Lyrics flow). So the
resample step from "roformer's 44.1kHz stereo vocals" to "16kHz mono" is
proven, not new.

**What's missing today**: a project-agnostic entry point that returns
vocals PCM from raw audio bytes, with no OPFS-project coupling.
`roformer-separation.ts`'s public `separateDrums(projectId, ...)` is shaped
around drum-transcription's OPFS project (`ensureProjectStemFingerprint`,
`getProject`/`updateProject`) and only returns drums (vocals are separated
internally when `includeVocals: true` but stored straight to the fingerprint
cache and dropped from the return value — the same "computed but not
returned" shape as the Phase 1 bug, just on the vocals side this time).
`lib/tempo-map/stem-separation.ts:separateDrumStem` is already the
project-agnostic primitive underneath (raw PCM in, `{drums, vocals?}` PCM
out, no OPFS) — but nothing outside the two existing workers calls it
directly.

**New function**, in `lib/audio-pipeline/` (co-located with the Phase 2
cache): `separateStems(audioBytes: Uint8Array, opts: {vocals?: boolean;
drums?: boolean}): Promise<{drums?: StereoStem; vocals?: StereoStem}>`.
Behavior:
1. Compute the fingerprint (`computeStemFingerprint(audioBytes,
   ROFORMER_SEPARATOR_ID)`, the same function/id Phase 2 already
   canonicalized).
2. For each requested stem, check the unified cache first
   (`loadStem(fingerprint, stemName)`); only run the worker for stems that
   miss.
3. Runs the *same* `separation-worker.ts` (extend its return payload to
   include vocals PCM when `includeVocals` was requested — same fix shape as
   Phase 1: the data is already computed inside `separateDrumStem`, just not
   surfaced past the worker boundary today).
4. Stores whatever it freshly separated back into the unified cache before
   returning.

This is the ONE new function this plan adds beyond plumbing — everything
else is: point existing call sites at it, or at the Phase 2 cache directly.

**`roformer-separation.ts`'s `separateDrums(projectId, ...)` becomes a thin
wrapper**: resolve the project's original audio bytes, call
`separateStems(bytes, {drums: true, vocals: true})` (unchanged from today's
behavior — drum-transcription already separates both), then do its existing
OPFS-project bookkeeping (fingerprint persistence, project-scoped
`loadDrumStem`/`loadVocalsStem` helpers stay as-is, just backed by the
shared cache now instead of the drum-transcription-only one).

**`AddLyricsClient.tsx`** (the standalone `/add-lyrics` page): the
no-bundled-vocals branch (currently `runDemucsInWorker(audioBuffer, ...)`,
line 447) becomes: decode → get raw bytes → `separateStems(bytes, {vocals:
true})` → `resampleTo16kMono` on the returned 44.1kHz stereo vocals → same
`alignVocals` call as today. The **bundled-vocals-file skip path is
untouched** (lines 186-188 detection, 387-411 skip) — it never calls a
separator at all, so it's orthogonal to which model backs the "need to
actually separate" branch.

**Tier-2 fallback** (lines 491-555, triggers when pass 1 used a bundled
vocals stem and alignment confidence was low): keeps its existing structure
— reconstruct the full mix from the chart's other stems via
`mixStemsToAudioBuffer` (unchanged, separator-agnostic), then run real
separation on it. Only the separator call inside that step swaps from
`runDemucsInWorker` to `separateStems`.

Once this lands, `lib/lyrics-align/demucs-client.ts`'s `runDemucsInWorker`
and `demucs-worker.ts` have no remaining callers and can be deleted; the
`resampleTo16kMono`/`mixStemsToAudioBuffer` helpers move to a
separator-agnostic home (`lib/audio-pipeline/` or stay in
`lib/lyrics-align/` — they're about audio mixing/resampling, not about
either separator, so either is defensible; lean toward
`lib/audio-pipeline/` since Phase 3's new code already needs to import
them).

**Risk — quality is unverified, not just unmeasured.** Nothing in this repo
compares Demucs vs BS-Roformer vocal-separation quality or alignment
confidence; 0063's decision to keep `/add-lyrics` on Demucs was Eli's
explicit call at the time, not backed by a documented quality reason in that
plan. This plan doesn't have new evidence either — it's proceeding on
direct instruction to prioritize pipeline unification over the unmeasured
quality delta. Mitigate with a manual spot-check during validation (below),
not a blocking formal A/B: browser-validate `/add-lyrics` on 2-3 songs
already known to align well under Demucs (e.g. existing fixtures under
`lib/lyrics-align/__tests__/` or the reference examples in
`reference_example_charts.md`), and compare `lowConfidenceFrac`/eyeballed
sync quality before/after. If quality visibly regresses, that's a stop-ship
signal for Phase 3 specifically — Phases 1-2 don't depend on it and should
ship regardless.

### Non-goals confirmed again

- No change to `/drum-transcription`'s persisted project format, OPFS
  project layout, or `ProjectMetadata` shape.
- No change to `chart-editor-core`/`EditorProfile` work (0037) — orthogonal
  layer.
- No change to the editor's in-session Add Lyrics flow
  (`AddLyricsDialog.tsx`) — it already uses the roformer vocals stem; Phase
  3 only changes the standalone `/add-lyrics` page.
- No attempt to reduce roformer inference cost for vocals-only requests
  (e.g. adding an `includeDrums: false` option to `separateDrumStem`) —
  `/add-lyrics` requesting `{vocals: true}` alone already only pays for the
  vocals iSTFT, not drums (`stem-separation.ts` already only inverse-
  transforms requested stems); no evidence this needs further trimming.

## Tasks

1. Phase 1: add `drumStemStereo` to `TempoTrackResult`, thread it through
   `TempoClient.tsx` → `usePaddedAudio` → `ChartEditor.highwayAudioData`.
   Ship this alone first — it's the user-visible fix and has zero
   dependency on Phase 2 or 3.
2. Audit `roformer-separation.ts` vs `pipeline-worker.ts` inference
   parameters (overlap, fp16, resampler) for the `separatorId` unification
   in Phase 2's design.
3. Build `lib/audio-pipeline/stem-cache.ts` (fingerprint + gzip-planar
   PCM + Opus variant), with unit tests (fingerprint determinism,
   store/load round-trip, corrupt/short-buffer null-return, cache miss
   returns null not throw).
4. Migrate `roformer-separation.ts` call sites; run
   `lib/drum-transcription/__tests__/*` + browser-validate
   `/drum-transcription` end to end (upload → separate → cache hit on
   re-upload).
5. Migrate `pipeline-worker.ts` call sites; run
   `lib/tempo-map/__tests__/*` + `tempo-track-equivalence.test.ts` +
   browser-validate `/tempo` end to end, including the cross-page cache-hit
   case (separate via `/drum-transcription`, then run `/tempo` on the same
   file, confirm no re-separation).
6. Delete the two superseded cache modules (`lib/drum-transcription/storage/
   stem-cache.ts`, `lib/tempo-map/stem-cache-format.ts`) + port their tests.
7. Phase 3: extend `separation-worker.ts`'s return payload to surface vocals
   PCM; build `lib/audio-pipeline/separateStems`; make
   `roformer-separation.ts:separateDrums` a thin wrapper around it.
8. Wire `AddLyricsClient.tsx`'s no-bundled-vocals branch and tier-2 fallback
   to `separateStems`; run `lib/lyrics-align/__tests__/*`; browser-validate
   `/add-lyrics` (fresh separation, bundled-vocals skip path unaffected,
   tier-2 fallback still triggers correctly) plus the quality spot-check
   from Phase 3's design section.
9. Delete `lib/lyrics-align/demucs-client.ts`'s `runDemucsInWorker` +
   `demucs-worker.ts`; relocate `resampleTo16kMono`/`mixStemsToAudioBuffer`.

## Done when

- `/tempo` shows the real drum-stem waveform in the piano roll and highway.
- Separating a song via `/tempo`, `/drum-transcription`, or `/add-lyrics`
  produces a cache hit if any of the other two pages later processes the
  same file.
- `/add-lyrics` runs entirely on BS-Roformer; Demucs is fully removed from
  the codebase (no dead `demucs-worker.ts`/model download left behind).
- `pnpm typecheck`, `pnpm test`, `pnpm lint` pass.
- Browser-validated: `/tempo` and `/drum-transcription` both still transcribe
  correctly (no drift in tempo grid or note output — the
  `tempo-track-equivalence.test.ts` invariant this whole feature depends on
  must keep passing); the cross-page cache-hit scenario is confirmed with
  `list_network_requests`/OPFS inspection showing no second model download +
  separation pass across ALL THREE pages pairwise; `/add-lyrics` produces
  reasonable alignment on the quality spot-check songs, bundled-vocals skip
  path still works, and tier-2 fallback still triggers and improves
  low-confidence results.
