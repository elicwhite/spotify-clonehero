# Drum Transcription — Manual Test Plan (stereo 256-mel CRNN)

Manual verification for the single-pass stereo CRNN pipeline
(`crnn_stereo_256mel.onnx`, 48 kHz, stereo mel + mean-context).

## Prerequisites

- Chrome (or another WebGPU-capable browser) — BS-Roformer separation runs on
  WebGPU.
- Local dev: `public/models/crnn_stereo_256mel.onnx` present (gitignored dev
  fallback — see Deploy below; the transcriber fetches the R2 URL, so for a
  purely local model swap point `CrnnTranscriber` at a local URL or ensure the
  R2 copy is uploaded).
- `public/models/crnn_stereo_256mel.thresholds.json` present (committed).

## What to click

1. Open `/drum-transcription`.
2. Upload a song — use `public/drumsample.mp3` for the fixture behaviors
   below (or drag in any mp3).
3. Watch the progress steps: Loading ML Runtime -> Decoding Audio ->
   Separating Stems (BS-Roformer) -> Building Tempo Map -> Transcribing
   Drums (CRNN). The tempo step shows live sub-stage detail (e.g.
   "Detecting beats (drum stem)").
4. Open the resulting chart in the editor and inspect the lanes.

## Expected behavior

- **Separation**: one BS-Roformer pass (shares the OPFS-cached
  `bs_roformer_sw_6stem_fp16.onnx`, ~336 MB, with the tempo-map feature — if
  you've run tempo mapping before, no re-download). Only the drum stem is
  stored (`stems/drums.pcm`, interleaved stereo 44.1 kHz).
- **Single inference pass**: the transcription step runs ONE pass over the
  audio (windowed 500-frame / stride-375 inference). There is no
  "pass 1 / pass 2" progress anymore; if you see two inference phases, the old
  worker is still wired in.
- **Lane order** (model classes): kick, snare, high-tom, mid-tom, floor-tom,
  hihat, crash, crash-2, ride.
- **Crash-2 never fires** with the provisional thresholds (its threshold is
  2.0, which disables the lane). Any crash-2/second-crash note in the output
  chart is a bug.
- **Tom re-order fires on the fixture song** (`public/drumsample.mp3`): the
  per-song pitch-proxy tom re-ordering performs a real lane swap on this song.
  Verify tom fills descend sensibly (high -> mid -> floor); if the toms look
  pitch-inverted, the re-order block is broken or skipped.
- **Real tempo map**: the written `notes.chart` `[SyncTrack]` must contain
  the detected tempos from the tempo-map pipeline (multiple `B` events for a
  variable-tempo song), NOT a single flat `120` entry. Cymbal notes must
  carry pro-drums markers (`N 66/67/68` lines) — hihat=66 (yellow),
  ride/crash-2=67 (blue), crash=68 (green). If every yellow/blue/green note
  plays as a tom, the `drumType = fourLanePro` line in
  `pipeline/chart-builder.ts` regressed.
- **Resumability**: reload the tab mid-pipeline, reopen the project — it must
  resume from the last completed step (stored drum stem is reused; separation
  must not rerun).
- **Fallback**: with separation unavailable (e.g. WebGPU off), transcription
  still runs on the full mix (resampled to 48 kHz) after a console warning.

## Console checks

- No `Using hardcoded provisional CRNN thresholds` warning (that means both
  thresholds URLs failed).
- No 404 on `crnn_stereo_256mel.onnx` (would mean the R2 upload is missing).

## Deploy steps

(Done 2026-07-03 — both files verified live on R2, ONNX sha256 matches the
local export. Repeat only when the model or thresholds are retuned.)

1. Upload to R2 (`assets.musiccharts.tools/models/`):
   - `public/models/crnn_stereo_256mel.onnx` (~94 MB, gitignored — never
     deploys with the app)
   - `public/models/crnn_stereo_256mel.thresholds.json` (production fallback
     for the same-origin copy; keep in sync when thresholds are retuned)
2. The URL constants in `lib/drum-transcription/ml/transcriber.ts` then serve
   production:
   - model: `https://assets.musiccharts.tools/models/crnn_stereo_256mel.onnx`
   - thresholds: same-origin `/models/crnn_stereo_256mel.thresholds.json`
     (committed, deploys with the app), R2 as fallback, hardcoded array as
     last resort.
3. The local `public/models/*.onnx` copy is the gitignored dev fallback only.
