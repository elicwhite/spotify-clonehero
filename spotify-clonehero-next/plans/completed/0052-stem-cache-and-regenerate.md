# 0052 — Fingerprint-keyed stem cache + Regenerate button

## Goal

1. **Stem cache keyed by input fingerprint, not project.** The separated drum
   stem should be stored under a content fingerprint of the uploaded audio
   (plus a hash of any separation-relevant inputs, i.e. the separator model
   identity), so re-uploading the same song — or regenerating a project —
   reuses the already-separated stem instead of re-running the ~336 MB
   BS-Roformer separation.
2. **Regenerate button** in the editor's left sidebar (above the confidence
   gauge/panel): re-runs the beat grid (tempo map) and predicted notes using
   the cached stem, discarding edits/review progress after confirmation.

## Design

### Stem cache (`lib/drum-transcription/storage/stem-cache.ts`, new)

- Fingerprint = SHA-256 hex over `audioBytes || 0x00 || utf8(separatorId)`.
  `computeStemFingerprint()` is pure (crypto.subtle) and unit-tested.
- Cache layout: `drum-transcription/stem-cache/{fingerprint}/drums.pcm`
  (interleaved stereo Float32 @ 44.1 kHz, same format as before). Extensible
  to other stem names later.
- `storeCachedStem` / `loadCachedStem` / `hasCachedStem(fingerprint, stemName)`.

### Separator integration (`lib/drum-transcription/ml/roformer-separation.ts`)

- `DRUM_SEPARATOR_ID` derived from the model URL + output config
  (`drums|stereo|44100`) — changing the model invalidates the cache.
- `ensureProjectStemFingerprint(projectId)`: returns
  `ProjectMetadata.stemFingerprint`, computing and persisting it on first use
  from the stored original upload bytes (fallback: the decoded `full.pcm`
  bytes for ancient projects without a stored original).
- `separateDrums` stores its output to the cache (fingerprint) instead of
  `{projectId}/stems/`.
- `loadDrumStem` / `hasDrumStem` keep their project-id signatures but resolve
  through the fingerprint cache first, falling back to the legacy
  `{projectId}/stems/drums.pcm` path for pre-existing projects.

### Storage (`lib/drum-transcription/storage/opfs.ts`)

- `ProjectMetadata.stemFingerprint?: string` (+ allowed in `updateProject`).
- `listProjects()` skips the `stem-cache` directory.
- New `deleteProjectFile(projectId, fileName)` helper (missing file = no-op).

### Regenerate (`lib/drum-transcription/pipeline/runner.ts`)

- `regenerateProject(projectId, onProgress, transcriber?)`:
  - Refuses `gridSource === 'provided'` projects (their grid is the user's
    own chart; nothing to regenerate — same restriction as resume).
  - Deletes derived artifacts: `synctrack.json`, `confidence.json`,
    `review-progress.json`, `notes.(edited.)chart|mid`.
  - Delegates to `resumePipeline`, whose existing gates re-run tempo mapping
    + transcription; separation is skipped via the (now cache-aware)
    `hasDrumStem` check.

### UI

- `EditorApp` renders a "Regenerate" button (with destructive-action confirm
  dialog — edits and review progress are discarded) above `ConfidenceGauge`
  in `leftPanelChildren`; hidden for provided-grid projects. While
  regenerating, autosave is disabled so a stale save can't resurrect deleted
  artifacts.
- `DrumTranscriptionClient` owns the flow: on regenerate it flips into the
  existing `ProcessingView` (unmounting the editor), runs
  `regenerateProject`, then returns to the editor which remounts and reloads
  the fresh chart/confidence from OPFS.

## Tests

- `stem-cache.test.ts`: fingerprint determinism, sensitivity to audio bytes
  and separator id, hex shape.
- `runner` artifact list: regenerate deletes both chart formats + edited
  variants (exported constant).

## Out of scope

- Cache eviction/GC for `stem-cache/` (stems were previously kept
  per-project forever; dedupe strictly reduces total usage).
- Regenerate for chart-flow (provided-grid) projects.
- Migrating legacy per-project stems into the cache (legacy fallback read
  covers them).
