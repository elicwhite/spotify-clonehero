# Plan 0063: Opus-at-rest storage, vocals stem, and lyrics in the chart editor

Spec from an interactive session with Eli (2026-07-19). Decisions recorded
inline; Eli-answered questions marked **[Eli]**.

## Goals

1. **Cut storage cost**: transcode uploads to Opus at rest; stop storing the
   original upload and the decoded `full.pcm`.
2. **Capture the vocals stem** during roformer separation and store it as Opus
   in the fingerprint-keyed stem cache (drums stays raw PCM — it may be
   reprocessed by the CRNN later).
3. **Add Lyrics** flow in the drum-transcription editor, reusing the
   `/add-lyrics` alignment pipeline but fed the roformer vocals stem.
4. **Lyrics editing in the piano roll** (draggable, no grid snap) with the
   highway (markers + karaoke overlay) as sibling views of the same
   `chartDoc.parsedChart.vocalTracks` data.

## Decisions

- **[Eli] Drop `full.pcm`.** Store only `audio/song.opus`; decode to PCM in
  memory on project open.
- **[Eli] No migration.** Existing projects keep `original.<ext>` +
  `full.pcm` and keep working through a legacy read path. Only new uploads use
  the new layout.
- **[Eli] `/add-lyrics` page unchanged** (keeps Demucs). Only the editor flow
  uses the roformer vocals stem.
- **[Eli] Lyrics UX: "surprise me"** — design options in §C, winner chosen
  there.
- Opus bitrate: 128 kbps (existing `encodePcmToOpus` default) for both the
  song and the vocals stem.
- No tier-2 Demucs retry in the editor lyrics flow (that fallback is
  `/add-lyrics`-specific; memory: auto-fallback was net-zero in exp28).

## Part A — Opus-at-rest storage

Files: `lib/drum-transcription/storage/opfs.ts`, `stem-cache.ts`,
`app/drum-transcription/components/*` (upload + project open),
`lib/drum-transcription/ml/roformer-separation.ts`.

1. **Upload flow** (new projects): decode upload (`decodeAudio`, 44.1 kHz
   stereo) → `encodePcmToOpus` (`lib/audio/opus-encoder.ts`, WebCodecs,
   48 kHz) → store bytes as `audio/song.opus`. Do NOT write
   `audio/original.<ext>` or `audio/full.pcm`. Keep `audio/meta.json`
   (duration etc.). If the upload is already `.opus`, store its bytes
   verbatim.
2. **Project open**: if `audio/song.opus` exists → decode to interleaved
   stereo Float32 @44.1 kHz in memory and feed the existing consumers
   (AudioManager WAV wrap in `EditorApp.tsx`, `loadAudioForDemucs`,
   waveforms). Legacy projects (no `song.opus`) keep the current
   `full.pcm`/`original.<ext>` path untouched.
3. **Fingerprint**: for new projects compute `computeStemFingerprint` over the
   **stored opus bytes** + separator id. Legacy projects keep their persisted
   `stemFingerprint`. `DRUM_SEPARATOR_ID` unchanged (old cache entries are
   unreachable from new fingerprints anyway; no invalidation needed).
4. **Separation input**: decoded-from-opus PCM (i.e., separation sees exactly
   what's stored).
5. Export already transcodes/passes through Opus (`transcode-audio.ts`);
   verify `.opus` passthrough works with the new source.
6. **Tests** (Jest): storage layout read/write both generations, fingerprint
   over opus bytes, open-path selection logic (new vs legacy). IO seams
   injectable — no WebCodecs in jsdom; mock encode/decode.

## Part B — Vocals stem capture

Files: `lib/tempo-map/stem-separation.ts`,
`lib/drum-transcription/ml/roformer-separation.ts`,
`lib/drum-transcription/storage/stem-cache.ts`.

1. Extend `separateDrumStem` (or a sibling entry) to optionally also iSTFT the
   `vocals` stem index — model inference already emits all 6 stems; add a
   second accumulator + overlap-add, reusing the existing `istft-batch`
   worker path. `/tempo-map` callers unaffected (option defaults off).
2. In `runSeparation` (roformer-separation.ts): store drums as
   `drums.pcm` (unchanged) AND encode vocals PCM → Opus → store
   `vocals.opus` in the same fingerprint dir. Cache API grows an extension-
   aware variant (`{stemName}.{pcm|opus}`).
3. Vocals written opportunistically; absence of `vocals.opus` (old cache
   hits) → lyrics flow triggers a re-separation or reports it needs one
   (simplest: Add Lyrics runs separation if vocals missing).
4. **Tests**: cache store/load for opus stems; separation option plumbing
   (worker-level DSP is covered by existing stem-separation tests).

## Part C — Add Lyrics in the editor

1. **Extraction commit (own commit, first)**: lift `applyAlignedLyricsToDoc`
   out of `app/add-lyrics/AddLyricsClient.tsx` into
   `lib/lyrics-align/apply-lyrics.ts`; update the original callsite directly
   (no re-export shims). Also extract the shared dialog copy if practical.
2. **Add Lyrics button** in the editor's left column → dialog with the
   `/add-lyrics` copy (auto-splits into syllables, each line its own phrase,
   auto-aligned) + a lyrics textarea + progress steps.
3. **Vocals source**: load `vocals.opus` from the stem cache → decode →
   downmix to mono + resample to 16 kHz → `alignVocals` (existing worker).
   If missing, run separation first (progress shown in the dialog).
4. **Overwrite confirm**: if `chartDoc.parsedChart.vocalTracks` already has
   lyrics, confirm before replacing.
5. **`ReplaceLyricsCommand`** (`components/chart-editor/commands.ts`):
   snapshot-style `EditCommand` — execute swaps in the new
   `vocalTracks` (via `applyAlignedLyricsToDoc`), undo restores the prior
   `vocalTracks`. Fully undo/redo-able through the existing stacks.
6. **Tests**: apply-lyrics transform (already pure), ReplaceLyricsCommand
   execute/undo round-trip.

## Part D — Piano-roll lyrics view + retiming

Options considered:

- **D1. Dedicated lyrics row with syllable flags + phrase bands** — a new row
  in `PianoRollTimeline` (between tempo lane and note lanes): each syllable a
  small flag/chip at its tick showing its text; each phrase a subtle
  background band spanning phrase start→end. Drag a chip to retime (NO grid
  snap). Consistent with section-flag interaction; phrase bands give line
  structure at a glance.
- **D2. Lyrics inline in the flags row** — cheaper, but collides with section
  flags + bar numbers and leaves no room for phrase structure.
- **D3. Karaoke text strip over the waveform row** — pretty but poor for
  precise per-syllable editing and conflicts with waveform source switching.

**Winner: D1** (with phrase bands kept visually minimal in v1; band-edge
dragging of phrase markers is a possible follow-up, not in scope).

Implementation:

1. New lyrics row in `PianoRollTimeline.tsx` (render + geometry consts +
   hitTest), populated from
   `selectRenderDoc(state).parsedChart.vocalTracks.parts['vocals']`
   (lyrics via `notePhrases[].lyrics`, phrases for bands). Row hidden when no
   vocal track exists.
2. Drag-to-retime a syllable chip: reuse the existing `lyric` `EntityKind` +
   `MoveEntitiesCommand` + `lib/chart-edit/helpers/lyrics.ts` `moveLyric`.
   **No grid snapping** — convert pixel → tick continuously (clamp between
   neighbors/phrase bounds per `moveLyric` semantics). Selection/hover flows
   through the existing `ChartEditorContext` selection map.
3. **Highway stays in sync for free**: `useHighwaySync` re-derives lyric
   markers + karaoke overlay from `chartDoc` on every change; verify marker
   drag on the highway and chip drag in the piano roll mutate the same doc.
4. **Tests**: hit-test/geometry for the lyrics row; move-lyric command tick
   math (no-snap path).

## Execution & verification

- Coding delegated to Sonnet subagents per part (A → B → C → D, B may start
  once A's cache API lands). Extraction in C.1 is its own commit.
- Review of each part + final review by the top-level (Fable) agent.
- Browser verification via claude-in-chrome against `pnpm dev`
  (http://localhost:3000/drum-transcription): upload → opus stored (OPFS
  check via evaluate), separation stores drums.pcm + vocals.opus, Add Lyrics
  end-to-end on `public/drumsample.mp3` (or a real song), overwrite confirm,
  undo/redo, piano-roll chip drag, highway lyric render. WebGPU required.
- `pnpm test`, `pnpm typecheck`, `pnpm lint` green before completion.
- Commit on completion; move this plan to `plans/completed/`.

## Round 2 (Eli browser feedback, 2026-07-19)

1. **Separation must not block the main thread.** The editor's
   `separateDrums` (roformer-separation.ts) runs on the main thread — UI is
   unresponsive during separation. Move it into a dedicated Web Worker,
   mirroring `lib/tempo-map/pipeline-worker.ts`/`pipeline-client.ts` (which
   already run `separateDrumStem` + ONNX in a worker). Opus encoding of the
   vocals stem stays on the main thread (OfflineAudioContext is unavailable
   in workers); PCM transfers back via transferables.
2. **Lyrics row editing + context menus**:
   - Right-click a lyric chip → Edit text… (inline), Delete lyric.
   - Right-click a phrase band → Delete phrase (with its lyrics), Add lyric….
   - Right-click empty row space → Add phrase here.
   - Drag phrase band edges (ew-resize cursor) to resize the phrase
     (phrase-start/phrase-end), reusing the existing marker entity kinds.
   - New chart-edit helpers as needed (delete/add lyric, add/delete/resize
     phrase) with unit tests per edge case.
3. **Pill interaction fixes**: the whole rendered pill is grabbable (hit box
   = pill rect, not a ±14px window at the tick x); the dashed ghost line at
   the chip's position shows on hover, not only mid-drag.
4. **Row placement**: lyrics row moves ABOVE the tempo lane (directly under
   the ruler) — lyrics are ms-locked, never affected by tempo edits.
5. **Vocal stem waveform** rendered behind the lyrics row (from the cached
   `vocals.opus`, decoded on load), with a context-menu toggle on the row to
   hide/show it.
6. **Tempo-lane controls**: remove the tap-tempo feature entirely (Tap/Apply
   buttons + tap-capture state; `tapTempoSync` and its tests go too if
   nothing else uses it). Move the x2 / ÷2 structural corrections out of the
   floating button cluster into the tempo row's right-click context menu.
