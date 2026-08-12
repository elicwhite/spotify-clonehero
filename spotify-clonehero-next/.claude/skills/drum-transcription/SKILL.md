---
name: drum-transcription
description: The browser-based drum transcription feature at /drum-transcription — separating stems, running the transcription model, building the tempo grid, editing on a Clone Hero highway, and exporting .zip or .sng. Use whenever working in app/drum-transcription or lib/drum-transcription, touching the ONNX/WebGPU model pipeline, the fingerprint-keyed OPFS stem cache, chart export, or the highway editor, since this feature has hard constraints (WebGPU only, no backend, no zustand, OPFS not IndexedDB) that are easy to violate by accident.
---

# Drum transcription

Fully browser-based: upload a song → separate stems → transcribe drums →
build a tempo grid → edit on a Clone Hero highway → export `.zip` or `.sng`.
Everything runs client-side.

## Hard constraints

These are decisions already made. Violating one is not a style disagreement,
it breaks the feature's premise.

- **WebGPU required.** No WASM fallback. Block access with a clear message when
  WebGPU is unavailable (`app/drum-transcription/webgpu-check/`).
- **No backend.** Everything runs client-side as a Next.js page. Nothing is
  uploaded — that is a promise the landing page makes to users, so it is a
  correctness constraint, not a preference.
- **No zustand.** React state + context, same patterns as `app/sheet-music/`.
- **No `chart-preview` npm package.** Use the project's own
  `CloneHeroRenderer.tsx` and `lib/preview/highway/`.
- **`AudioManager` is the primary audio source.** WaveSurfer is for waveform
  visualization and seeking only, never playback.
- **Editing happens on the Clone Hero highway**, like Moonscraper — not on a
  separate grid or a sheet-music UI.
- **OPFS for storage** (`navigator.storage.getDirectory()`), never IndexedDB
  for audio or chart data. Namespace under `drum-transcription/` to avoid
  collisions.
- **Stems live in a fingerprint-keyed OPFS cache** at
  `drum-transcription/stem-cache/{fingerprint}/drums.pcm`, keyed by a SHA-256
  of the uploaded audio bytes plus the separator model identity, so identical
  inputs reuse separated stems across projects. Only the drum stem is produced;
  there is no merged `no_drums.pcm`.
- **Tests required** for all business logic (`pnpm test`).
- **Validate in the browser** as you go — the `validate` and `test-interaction`
  skills drive chrome-devtools MCP.

## Where things live

```
app/drum-transcription/
  page.tsx                    # entry
  DrumTranscriptionClient.tsx # pipeline flow; owns the tool-entry screen
  landing/                    # the marketing page (see the landing-pages skill)
  components/                 # AudioUploader, EditorApp, SourcePicker
  webgpu-check/               # capability gate
  og-preview/                 # OG card preview route
  opengraph-image.tsx

lib/drum-transcription/       # core logic, testable, no React
  ml/                         # ONNX runtime (WebGPU only), separation, transcription
  audio/                      # decoding, STFT/iSTFT, WAV encoding
  pipeline/                   # orchestration
  storage/                    # OPFS project management
  chart-types.ts
  timing.ts
  validate.ts
  __tests__/
```

The chart editor itself is shared, not drum-specific — it lives in
`components/chart-editor/`.

## Reusing code

If a utility you need exists elsewhere in the project, **extract it to a shared
`lib/` location and update the original callsite first, in its own commit**,
then use it from the new code. Load the **`existing-utilities`** skill to check
what already exists, and **`extract-utility`** for the workflow.

## Related skills

- **`existing-utilities`** — what already exists before you write a helper.
- **`reference-projects`** — the external repos this feature was built against
  (Demucs, ADTOF, Moonscraper, the chart format specs).
- **`validate`** / **`test-interaction`** / **`check-opfs`** — browser verification.
- **`verify-chart-roundtrip`** — chart serialization correctness, through Jest.
- **`landing-pages`** — the `/drum-transcription` marketing page.
