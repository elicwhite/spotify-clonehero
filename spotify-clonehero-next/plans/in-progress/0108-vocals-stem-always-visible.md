# 0108 — A generated vocals stem always reaches the editor

Status: in-progress

In `/chart-editor` a separated **drums** stem shows up on the Stems mixer with
its AI badge, but a **vocals** stem usually does not — even after a run that
separated vocals. The piano roll's lyrics row draws no vocals waveform there
either, and the waveform source picker has no Vocals entry to choose.

All three symptoms are one shape: the editor reads the fingerprint-keyed stem
cache (`useSeparatedStems`) and only ever finds `vocals.opus` when a
BS-Roformer run stored it, which the two runs a charter actually starts from
`/chart-editor` do not do.

## What is broken

**1. The tempo-map run separates drums only.** `obtainDrumStem`
(`lib/tempo-map/pipeline-worker.ts:119`) calls `separateDrumStem` without
`includeVocals`, so the model's vocals output is never inverted, and only
`storeStem(fingerprint, 'drums', …)` runs (`:141`, `:195`). Worse, that drums
entry then makes `separateStems` (`lib/audio-pipeline/separate-stems.ts:161`)
cache-hit on a later drum-transcription run and return before the pass that
*would* have stored vocals. Tempo map first ⇒ vocals never exist for that song.

**2. The lyrics tool throws its vocals away.** `add-lyrics` runs Demucs
(`lib/assist/tasks/add-lyrics.ts:174`), aligns against the result, returns it as
`vocals16k`, and stores nothing. Every later run re-separates, and the editor
never sees the stem.

**3. `TrackEditPage` never passes the lyrics waveform.** `PianoRollTimeline`
draws the lyrics-row waveform from `lyricsWaveData` /`lyricsWaveChannels`
(`components/chart-editor/piano-roll/draw.ts:546`, wired at
`PianoRollTimeline.tsx:986`). Only `app/drum-transcription/components/EditorApp.tsx:798`
supplies them; `TrackEditPage.tsx:1117` does not, so the row is empty on
`/chart-editor` no matter what the cache holds.

The bottom waveform-source picker needs no fix of its own:
`buildWaveformSources` (`components/chart-editor/piano-roll/waveformSources.ts:49`)
drops only the click track and `labelForSource` already knows `'vocals'`. It
lists whatever is in `audioManager.trackNames`, so Phases 1–3 make Vocals
selectable there for free — Phase 4 only confirms it.

## Phase 1 — every BS-Roformer separation produces and caches vocals

Decided with Eli: separating drums should always separate vocals. The extra
cost is one more iSTFT per segment plus an Opus encode; the model emits all six
stems either way.

- `lib/tempo-map/pipeline-worker.ts` — `obtainDrumStem` passes
  `includeVocals: true` on the fresh-separation branch and posts the vocals to
  the client as soon as they land. Only that branch: the caller-supplied and
  cache-hit branches have no vocals to offer and must not start a separation to
  get them.
- `lib/tempo-map/types.ts` — a `vocals` **worker message**, not a field on the
  public `PipelineResult`: no caller wants the samples, only the cache does.
  Sending them mid-run rather than with the result is what lets the worker drop
  a full-song stem immediately instead of holding it across both beat passes,
  and lets the client's Opus encode overlap the rest of the pipeline.
- `lib/tempo-map/pipeline-client.ts` — on that message, interleave the vocals,
  `encodePcmToOpus(…, 44100, 2)`, and `storeStemOpus(fingerprint, VOCALS_STEM,
  …)`. Opus encoding needs `OfflineAudioContext`, which a worker does not have,
  so the encode belongs on this side of the boundary.
  - Awaited before `runTempoPipelineFromPcm` resolves. `useSeparatedStems`
    re-probes the moment a separating run reports success
    (`useSeparatedStems.ts:219`), so a store still in flight at that point is a
    stem the mixer misses until the next reload.
  - Every failure here is a warning, never a throw: a tempo map that worked
    must not fail over a cache seed. A browser with no WebCodecs encoder skips
    the store outright rather than warning about something it cannot do.

Existing projects whose drums were cached before this change keep cache-hitting
and stay without vocals. That is accepted — the fix is forward-looking, and
re-separating on open would be a large silent cost.

## Phase 2 — the lyrics tool caches the vocals it separated

Demucs vocals are 16 kHz **mono**, not the 44.1 kHz stereo BS-Roformer stem, so
they must never land in the roformer-keyed entry — `separateStems({vocals:
true})` would hand that back believing it is roformer output.

- `lib/audio-pipeline/stem-cache.ts` — add `DEMUCS_SEPARATOR_ID`, built from
  `MODEL_URLS.demucs` (`lib/lyrics-align/model-urls.ts:9`) plus the output shape
  (`vocals|mono|16000`), exactly as `ROFORMER_SEPARATOR_ID` is built.
- `lib/assist/tasks/types.ts` — `resolveDemucsStemFingerprint(audio, bytes?)`,
  which always hashes the bytes under the Demucs id. It cannot reuse
  `audio.stemFingerprint`: that value is the host's *roformer* key.
- `lib/assist/tasks/add-lyrics.ts` —
  - `resolveVocals` probes, in order: roformer `vocals.opus` (unchanged),
    then the Demucs entry, then a fresh Demucs run whose result is stored.
  - `planSteps`'s `resolve` arm counts a Demucs cache hit as cached too, with a
    description that names which vocals it will reuse. A step list that
    promises "Demucs vocal separation" for work that will not happen is the bug
    `separateStepDescription` already exists to avoid.
  - The `stems` (tier-2) branch stores nothing: its input is a mixdown of chart
    stems, not the song audio the fingerprint names.
  - Storing is best-effort, same rule as Phase 1.

## Phase 3 — the editor reads both entries

- `components/chart-editor/hooks/useSeparatedStems.ts` — when the roformer
  vocals probe misses, probe the Demucs entry and publish that stem instead.
  The Demucs fingerprint is computed lazily (only when the roformer probe
  missed) and held in a ref for the life of the project, so an open pays at
  most one extra hash.
- Both arrive as `origin: 'ai-separated'`, so the mixer badges them and
  `usePaddedAudio` pre-mutes them exactly like the drums stem
  (`usePaddedAudio.ts:326`). The Demucs stem decodes at the package rate and
  through `interleaveAudioBuffer`, which always emits 2 channels, so a mono
  source still plays and draws as an ordinary editor track.

## Phase 4 — the piano roll draws it and offers it

- `components/chart-editor/TrackEditPage.tsx` — derive the vocals PCM from the
  padded stems (`stemPcm(paddedStems, VOCALS_STEM)`), wrap it once with
  `audioSamples` (a fresh wrapper per render rebuilds every waveform), and pass
  `lyricsWaveData` / `lyricsWaveChannels={2}` to `ChartEditor`. Reading the
  padded stem rather than a second copy of the cache entry means the leading
  silence `usePaddedAudio` applies is already in it, with no second pad path to
  keep in sync (`EditorApp` needs one only because its vocals never became a
  mixer track).
- Confirm in the browser: the Vocals row is on the mixer with the AI badge, the
  lyrics row draws its waveform, and right-clicking below the piano roll lanes
  lists Vocals as a waveform source.

## Verification

- `pnpm test`, `pnpm typecheck`, `pnpm lint`.
- Unit coverage for the new behavior: the tempo client stores vocals after a
  fresh separation and stores nothing on a cache hit; `add-lyrics` prefers
  roformer vocals, then Demucs cache, then a fresh run, and stores what it
  separated; `useSeparatedStems` publishes a Demucs-only vocals stem.
- In `/chart-editor`, on a project with no stems cached: run the tempo map,
  then confirm Vocals on the mixer, in the lyrics row, and in the source picker
  without a reload.
