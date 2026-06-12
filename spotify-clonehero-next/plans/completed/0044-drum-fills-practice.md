# 0044 — Drum Fills Practice Tool (`/drum-fills`)

A comprehensive tool for learning and mastering drum fills, sourced from the user's real
Clone Hero library. Scan the library → detect fills in Expert drum tracks → classify them
into a learnable taxonomy → practice them with full MIDI scoring (Alesis Surge over Web
MIDI) across four practice modes → track mastery with spaced repetition.

## Product overview

**User flow:**

1. **Scan** — user clicks "Scan Library", picks `/Users/eliwhite/Clone Hero/Songs` via
   `showDirectoryPicker`. Handle is cached in IndexedDB (idb-keyval) and silently re-used
   (with `requestPermission` re-prompt when needed) so the picker doesn't re-appear every
   reload during development. Scanning + fill detection runs in a web worker with progress UI.
2. **Library** — browsable/filterable library of detected fills: per-fill card with song,
   tempo, length, subdivision, voicing, complexity, mastery state, and a mini sheet-music
   preview. Filters across the taxonomy.
3. **Practice** — pick a fill (or take the "Today" queue): a practice screen with BOTH the
   Clone Hero highway and Sheet Music views of groove + fill, looped playback, live MIDI
   hit feedback, per-attempt scoring, speed trainer, and mastery progression.
4. **Today queue** — spaced-repetition scheduler surfaces due reviews + new fills daily.

**Practice modes (all four):**

- **Song-context loop** — real song audio, AudioManager practice-mode loop over N groove
  bars + the fill (+ landing downbeat). Practices the transition in/out.
- **Isolated loop** — no song audio; WebAudio-synthesized backing (click + simple kit:
  kick/snare/hat synthesized, no asset files) plays the extracted groove for N bars, then
  the fill, at any BPM.
- **Progressive speed trainer** — loop starts at ~70% tempo; after K consecutive passing
  attempts, tempo steps up automatically toward (and past) 100%. Uses
  `AudioManager.setTempo` (pitch-preserving) in context mode; native BPM in isolated mode.
- **Fill roulette** — steady generated beat; random fills from a filtered pool are queued
  and displayed a bar ahead; sight-reading and vocabulary breadth.

## Architecture

```
app/drum-fills/
  page.tsx                      # entry; WebMIDI/browser capability gate; view router
  components/
    LibraryView.tsx             # scan button, progress, filters, fill cards grid
    FillCard.tsx                # taxonomy chips, mastery badge, mini sheet preview
    PracticeView.tsx            # highway + sheet music + controls + scoring HUD
    TodayQueue.tsx              # SRS daily queue
    MidiStatus.tsx              # device picker, connection state, calibration entry
    CalibrationDialog.tsx       # tap-along latency calibration
  contexts/ / hooks/            # React state (no zustand)

lib/drum-fills/                 # pure logic, fully unit-tested (Jest)
  detection/                    # fill detection + classification (no React, no DOM)
    grooveModel.ts              # bar fingerprints, dominant-groove inference
    detectFills.ts              # deviation/density/voicing heuristics → FillSpan[]
    classify.ts                 # taxonomy: length, subdivision, voicing, complexity
    types.ts
  midi/
    chProfile.ts                # parse CH MIDI Profile YAML; built-in Alesis Surge map
    padMapping.ts               # MIDI note number → CH lane (kick/red/Y/B/G pad|cymbal)
    hitMatcher.ts               # expected notes vs timed hits → per-hit judgments
    calibration.ts              # latency offset estimation from tap-along samples
  practice/
    scoring.ts                  # attempt score from judgments (accuracy, timing)
    srs.ts                      # SM-2-style scheduler; mastery state machine
    speedTrainer.ts             # tempo-ramp policy
    backingTrack.ts             # WebAudio synth kit + click for isolated/roulette modes
  scan/
    scanWorker.ts               # web worker: walk library, parse charts, detect fills
    scanController.ts           # main-thread orchestration, progress, DB writes

scripts/drum-fills-spotcheck.ts # Node harness: run detection over the real library
                                # (filesystem path), print stats + sample fills for tuning
```

## Reuse (mandatory — do not reimplement)

| Need                                  | Use                                                                                                                                                                                                                |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Library walking, song.ini             | `lib/local-songs-folder/` (`scanLocalCharts.ts`); add idb-keyval `get('songsDirectoryHandle')` + permission re-request to `lib/local-songs-folder/index.ts`                                                        |
| Chart file reading (folder/.sng/.zip) | `components/chart-picker/chart-file-readers.ts`                                                                                                                                                                    |
| Chart parsing                         | `lib/chart-edit/` `readChart` / `@eliwhite/scan-chart` `parseChartAndIni`; Expert drums = `trackData` where `instrument==='drums' && difficulty==='expert'`; drum flags via `lib/chart-edit/helpers/drum-notes.ts` |
| tick↔ms                              | `lib/chart-utils/tickToMs.ts`, `msToTick` (move to a shared location if needed — update original callsite first, no re-export shims)                                                                               |
| Audio playback, looping, tempo        | `lib/preview/audioManager.ts` (`setPracticeMode`, `setTempo`)                                                                                                                                                      |
| Highway                               | `lib/preview/highway/index.ts` `setupRenderer` via `app/sheet-music/[slug]/CloneHeroRenderer.tsx` (extract/generalize if props don't fit; update original callsite)                                                |
| Sheet music                           | `app/sheet-music/[slug]/SheetMusic.tsx` + `convertToVexflow.ts` (same extraction rule)                                                                                                                             |
| DB                                    | `lib/local-db/` — new migration `010_drum_fills`                                                                                                                                                                   |
| UI                                    | `components/ui/` shadcn; `cn()`; `sonner` toasts                                                                                                                                                                   |

## Fill detection algorithm (v1, heuristic)

Per song (Expert drums only):

1. Build per-bar (and per-half-bar) rhythmic fingerprints from `noteEventGroups` using
   `resolution`, `tempos`, `timeSignatures`: onset grid (quantized to 48 divisions/bar),
   voice set per onset (kick/snare/hat-class/tom-class/crash-class from type+flags).
2. Infer local groove: the dominant repeating fingerprint over a sliding window
   (similarity ≥ threshold across ≥3 of last 6 bars).
3. Candidate fill spans: regions of 0.5–2 bars that (a) deviate strongly from local
   groove fingerprint AND at least one of: (b) tom-voice density spike vs baseline,
   (c) note-density (NPS) spike ≥ ~1.5× local baseline, (d) terminate at a crash on a
   downbeat / section boundary (use `textEvents` sections when present).
4. Emit `DetectedFill`: songRef, startTick/endTick, precedingGrooveSpan (the 1–2 bar
   groove before the fill), tempoBPM at fill, confidence score, raw features.
5. Classify: length (half/1/2 bar), subdivision (8ths/16ths/triplets/mixed via
   inter-onset histogram against grid), voicing tags (toms, snare-only, kick-woven,
   crash-end, cymbal-work, flams/ghosts from flags), complexity 1–5 (density +
   syncopation + voice-switch rate).
6. Dedupe near-identical fills within a song (same fingerprint) — keep one, count reps.

**Tuning/validation:** `scripts/drum-fills-spotcheck.ts` runs the same detection code in
Node directly against `/Users/eliwhite/Clone Hero/Songs` (sample of songs), printing
per-song fill counts, taxonomy distribution, and ASCII renderings of sample fills.
Iterate thresholds until spot-checks look right. Unit tests cover synthetic charts
(known groove + planted fills) and edge cases (tempo changes mid-fill, odd time sigs,
charts with no drums, half-bar pickups).

## MIDI scoring

- `navigator.requestMIDIAccess()`; device list UI; default mapping = embedded Alesis
  Surge profile (from `/Users/eliwhite/Clone Hero/MIDI Profiles/Alesis Surge.yaml`):
  kick 36; red 38,40; yellow pad 48,50; blue pad 45,47; green pad 41,43,58; yellow
  cymbal 22,42,23; blue cymbal 51,46; green cymbal 49. Also support loading any CH
  MIDI Profile YAML.
- Timestamping: use `MIDIMessageEvent.timeStamp` (performance.now domain) mapped to
  AudioContext time; subtract calibration offset.
- Calibration: play a click, user hits any pad on the click ×16; offset = median delta;
  persisted (localStorage or DB).
- Hit matching: greedy nearest-note matching within windows (perfect ≤35ms, good ≤75ms,
  miss otherwise), pad identity must match lane+cymbal/tom class; extra hits penalized.
- Attempt = one loop pass over the fill span. Score = weighted accuracy; pass ≥ 90%.
- Live feedback: hit/miss flashes on highway lanes + judgment text; per-attempt summary.

## Mastery + SRS

- States: `new → learning → mastered` per fill. Learning→mastered after N passing
  attempts at ≥100% tempo (speed trainer completes).
- SM-2-style scheduling on mastered fills (ease, interval, due date); failing a due
  review demotes interval. "Today" queue = due reviews first, then new fills picked for
  taxonomy diversity (cover under-practiced categories).
- DB migration `010_drum_fills`: `fills` (id, song hash/path ref, song meta, span ticks,
  groove span, tempo, taxonomy columns, fingerprint, features JSON), `fill_attempts`
  (fill_id, ts, mode, tempo%, score, judgments JSON), `fill_srs` (fill_id, state, ease,
  interval_days, due_at, pass_streak), `scan_runs`.

## Hard constraints

- No backend; everything client-side (Node script is dev-only tooling).
- No zustand; React state/context like `app/sheet-music/`.
- Heavy work (scan/parse/detect) in a web worker.
- Don't duplicate code: extract shared utilities to lib (own commit) before reusing.
- Jest tests for all business logic (detection, classify, matcher, scoring, srs,
  calibration, profile parsing, speed trainer).
- Browser-validate with chrome-devtools MCP. Note: native file pickers break after
  `Page.setInterceptFileChooserDialog` — prefer `upload_file`/handle injection or manual
  validation for picker flows.
- When moving files, update all imports directly; no re-export shims.
- Don't dispatch/run commands inside `setState(prev => ...)` updaters.
- Three.js raycasts, React decides; one-way state push to renderer.

## Build phases

1. **Core libs (parallel):** detection+classify (+Node spot-check harness), midi
   (profile/mapping/matcher/calibration), practice core (scoring/srs/speedTrainer/
   backingTrack), DB migration+queries. All with tests.
2. **Scan pipeline:** worker + controller + handle caching; persists fills to DB.
3. **UI:** scaffold + LibraryView (scan flow, filters, cards, sheet previews), then
   PracticeView (highway + sheet music + 4 modes + live MIDI scoring + mastery) and
   TodayQueue.
4. **Validation:** yarn test / lint / tsc clean; chrome-devtools browser validation;
   real-library spot-check report for detection quality.
