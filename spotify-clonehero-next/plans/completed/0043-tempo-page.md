# 0043 — /tempo: browser tempo & time-signature mapping page

Productize the POC at `~/projects/drum-to-chart/browser-pipeline` as a Next.js
page at `/tempo`. The user picks a standalone audio file OR an existing chart
(directory or .sng/.zip). The page separates the drum stem (bs-roformer-web),
runs Beat This! on the full mix and the drum stem, computes the drum-onset
offset, and converts beats → synctrack with the SOTA heuristic converter
(byte-exact port already proven in the POC). Then:

- **Standalone audio** → generate a new chart (synctrack + empty drums track +
  song.ini) and render it.
- **Existing chart** → copy the chart, swap its SyncTrack for the predicted one
  while preserving every event's wall-clock time (port of
  `_spotcheck/_tooling/swap_synctrack.ts`), and let the user toggle
  Original ↔ New to compare, exactly like `/tempo-viewer`.

## Pipeline (from browser-pipeline PLAN.md, locked SOTA)

```
audio (decoded at native rate, mixed if multiple stems)
  ├─ S1  bs-roformer-web fp16 (WebGPU) → drum stem 44.1k mono   [~80s/song]
  │       ├─ S3  Beat This! ONNX (WASM fp32) on drum stem
  │       └─ S2b spectral-flux drum-onset offset
  ├─ S2  Beat This! ONNX (WASM fp32) on full mix                [~12s]
  └─ S4  beatsToSynctrack (pure TS) → {origin_ms, tempos[], timeSignatures[]}
```

Key fidelity decisions inherited from the POC (do not relitigate):

- libsoxr WASM for all resampling (Web Audio's resampler is too lossy).
- Beat This! on the **wasm** EP (WebGPU EP silently runs fp16 and drifts logits).
- bs-roformer on WebGPU fp16; decode audio at its native rate (no 44.1k
  OfflineAudioContext forcing an implicit lossy resample).
- One Beat This! session, two sequential calls.

## Code layout

```
lib/tempo-map/                 # core logic, no React
  types.ts                     # Synctrack, progress events
  fft-radix2.ts                # vendored radix-2 FFT (worker-safe)
  resampler-soxr.ts            # WASM libsoxr wrapper
  stft-worker.ts               # bs-roformer STFT/iSTFT worker (vendored)
  stem-separation.ts           # separateStems port (chunked, crossfade)
  beat-this-mel.ts             # log-mel (slaney filterbank JSON)
  beat-this-mel-fb.json
  beat-this-onnx.ts            # chunked split_predict_aggregate
  beat-this-pp.ts              # minimal Postprocessor
  drum-onset.ts                # spectral-flux offset
  converter.ts                 # beatsToSynctrack (SOTA constants)
  synctrack-ticks.ts           # ms↔tick segment math (from swap_synctrack)
  swap-synctrack.ts            # re-tick a ParsedChart under a new synctrack
  build-chart.ts               # new ParsedChart for standalone audio
  pipeline-worker.ts           # web worker orchestrating S1–S4
  pipeline-client.ts           # main-thread wrapper w/ typed progress events
  merge-audio.ts               # decode + mix chart stems at native rate
  __tests__/                   # Jest: converter, pp, ticks, swap, drum-onset

app/tempo/
  page.tsx                     # metadata + dynamic ClientPage
  TempoClient.tsx              # picker → progress → compare view
```

Reused infra: `components/chart-picker/*` (directory / sng / zip readers,
DropZone), `components/ProcessingView` (step list + per-step ETA),
`lib/lyrics-align/model-cache.ts` (OPFS model cache),
`lib/ui-utils.ts` ETA helpers, `lib/chart-edit` + `lib/chart-export`,
`AudioManager`, `SheetMusic`, `CloneHeroRenderer` (layout copied from
`app/tempo-viewer/ClientPage.tsx`).

## Models

- bs-roformer fp16: `https://huggingface.co/elicwhite/bs-roformer-sw-6stem-onnx`
  (336 MB), OPFS-cached.
- beat_this.onnx (83 MB): not on HF; copied to `public/models/beat_this.onnx`
  (gitignored) from `~/projects/drum-to-chart/browser-pipeline/app/models/`.

## Progress UI

ProcessingView steps, plain language:

1. "Downloading AI models" (first run only; streaming % + ETA)
2. "Isolating the drums" (segment progress + ETA from separateStems)
3. "Finding the beat" (Beat This! chunk progress, full mix then drums)
4. "Building the tempo map" (instant)
5. "Writing the chart" (instant)

## Acceptance

- Standalone `public/drumsample.mp3` upload → chart renders with tempo list.
- Existing chart (sng/zip or directory) → Original/New toggle compares charts
  over the same audio; tempo+TS list click-seeks both views.
- Heavy compute (separation, Beat This!, mel, resample) all off main thread.
- Jest tests green for converter / pp / tick math / swap-synctrack.
- chrome-devtools MCP validation: console clean, WebGPU gate message when
  unavailable.
