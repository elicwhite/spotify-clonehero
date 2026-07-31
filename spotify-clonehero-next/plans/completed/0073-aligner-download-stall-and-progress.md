# 0073 — Aligner model download: stall recovery + visible progress

## Problem

Every lyrics-aligning surface (`/add-lyrics`, drum-transcription editor's Add
Lyrics dialog) hangs indefinitely on "Aligning syllables to audio". Dev-server
browser logs show the wav2vec2 fp16 download (189 MB from HuggingFace)
stalling mid-stream (e.g. at 91/189 MB) and never erroring or completing.

Three compounding defects:

1. `downloadModel` (lib/lyrics-align/model-cache.ts) has no stall detection:
   a silently dropped connection leaves `reader.read()` pending forever.
2. Download progress is invisible in the UIs. `aligner.ts` binds progress to
   the **first** `init()` caller only (the dialog preloads `init()` with no
   callback), and both UIs' `alignVocals` callbacks only react to
   `Syllabified:` / `Done:` messages — so a stuck download masquerades as a
   stuck aligner with an indeterminate spinner.
3. No recovery: `initPromise` is a cached module singleton never reset on
   failure, and the worker's `error` event has no listener — a wedged or
   failed-to-load worker bricks all aligning until a page reload.

## Fix

- **model-cache.ts**: stall watchdog (AbortController, 30 s without a chunk)
  plus retry loop (4 attempts) that resumes via HTTP `Range` requests
  (handles 206 resume, 200 restart-from-scratch, 416 restart). Progress
  callback gains an optional structured arg `{loadedBytes, totalBytes}`;
  messages throttled to one per MB.
- **aligner-worker.ts**: progress messages carry an optional `percent`
  (0..1) — download percent and CTC chunk progress.
- **aligner.ts**: single persistent worker `message` listener fanning
  progress out to a subscriber set, so progress reaches whoever is currently
  listening (fixes preload-swallows-progress and duplicate-callback spam).
  Worker `error` event rejects all pending promises and resets the
  worker + `initPromise`; init failure also resets `initPromise` so a retry
  doesn't need a reload.
- **AddLyricsDialog.tsx / AddLyricsClient.tsx**: forward progress messages
  into the align step's `detail` and `progress`, so "Downloading alignment
  model 91/189 MB (48%)" etc. is visible instead of a bare spinner.

## Tests

Jest tests for the download loop (`model-cache-download.test.ts`): resume
with correct Range header + reassembly, restart on 200-to-range, permanent
4xx fails fast, attempts-exhausted error, stall watchdog abort via fake
timers, structured progress values.
