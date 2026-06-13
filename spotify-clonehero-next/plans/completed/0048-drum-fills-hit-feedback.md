# 0048 — Drum fills: per-note hit feedback, best attempt, tempo slider, YARG-aligned windows

User feedback (2026-06-12, at the kit): (1) no on-page feedback for what was hit/missed —
wants a green/red marker per beat on the sheet-music stave; (2) "Last attempt" sidebar
should also show **best attempt**; (3) no way to slow the song down; (4) align hit
detection/windows with YARG (reference: /Users/eliwhite/projects/YARG.Core).

## 1. Per-note hit/miss feedback on the sheet music

After each loop pass (and ideally live as hits land), mark every expected note on the
stave with its judgment so the user sees exactly what the app detected.

- Source of truth: `ScoredAttempt.match.judgments` — each `NoteJudgment` has
  `note` (id = `${tick}:${lane}:${isCymbal}`), `judgment` ('perfect'|'good'|'miss'),
  `hit`, `deltaMs` (signed: + = late). Extras are in `match.extras`.
- Marker design: a small colored dot/glyph at each notehead — **green** = perfect,
  **amber/yellow** = good (in-window but loose), **red** = miss. Show the signed timing
  offset (e.g. "+24ms late" / "−18ms early") on hover or as a tiny label for non-miss
  hits. Extra hits (overhits) shown as a faint red "✗" marker near the playhead lane,
  not tied to a note.
- Implementation: keep this **drum-fills-specific and non-invasive to the shared
  `/sheet-music` page**. Prefer an absolutely-positioned overlay layer over the rendered
  stave, positioned from a note-identity→coordinate map. `SheetMusic`/`renderVexflow`
  already build a `timePositionMap` (ms→x,y) and color noteheads per lane; extend the
  drum-fills render path to expose, per rendered notehead, `{noteId, x, y}` (VexFlow
  `StaveNote.getBoundingBox()` + per-key Y from the stave line for the lane) so the
  overlay can place a dot at the exact notehead. If a clean per-key style is simpler than
  an overlay, `StaveNote.setKeyStyle(index, {fillStyle, strokeStyle})` is acceptable —
  but it must be gated behind a drum-fills-only prop and must not change shared-page
  behavior when absent.
- Lifecycle: markers clear at the start of each loop pass and repaint when the pass's
  attempt is scored; if doing live coloring, a notehead turns green/amber the instant its
  hit is matched and unmatched notes go red at pass end. Re-anchor on fill change.
- The note identity used by judgments must match the identity of the rendered notes —
  verify this holds for BOTH song-loop mode (real chart fill region) and isolated-synth
  mode (synthetic practice chart from `practiceChart.ts`); fix the id mapping if they
  diverge.

## 2. Best attempt in the HUD

- Track best attempt (highest `score.score`, tie-break lower `meanAbsTimingErrorMs`) for
  the current fill within the session, surfaced in `PracticeHud` alongside Last attempt:
  show best score + its perfect/good/miss/extra + a "new best!" flash when beaten.
- Persist/seed from history: add a `getFillBest(fillId)` query to `lib/drum-fills/db`
  (MAX(score) over `fill_attempts`, plus the judgments of that row) so best survives
  reloads and reflects prior sessions; update on each recorded attempt. Add `bestAttempt`
  to `useLiveScoring` state (seeded from the query on mount, updated on finishAttempt).

## 3. Tempo / slow-down control in all modes

- Currently tempo UI only appears in speed-trainer mode. Surface a **tempo control in
  every mode** (song loop, isolated, roulette) in the transport: a slider + readout
  (e.g. 50–110%, maybe down to 40%), wired to the existing `effectiveTempo`/`setTempoPct`
  path → `AudioManager.setTempo` (pitch-preserving, already works for song + synth WAV).
  Keep the arrow-key nudges. In speed-trainer mode the trainer still drives tempo
  automatically; the manual control is for the other modes.
- A few quick presets (e.g. 50% / 75% / 100%) are nice-to-have. Ensure the slider value,
  speed-trainer tempo, and keyboard nudges share one state so they don't fight.

## 4. YARG-aligned hit windows

From YARG.Core (read, don't guess — values confirmed): drums use a **static symmetric
±70 ms** hit window (`EnginePreset.Instruments.cs:170-178` MaxWindow/MinWindow = 0.14s
full, `FrontToBackRatio` 1.0; split in `HitWindowSettings.cs:116-131`), pad identity is
exact (cymbal ≠ tom — `YargDrumsEngine.CanNoteBeHit`), an input matching no in-window note
is an **overhit**, and the engine matches the first in-window note whose pad matches
(forward scan). YARG doesn't expose an early/late offset — it's `currentTime − note.Time`.

Changes to `lib/drum-fills/midi/hitMatcher.ts` (`DEFAULT_WINDOWS`):
- Set the **hit (good) boundary to ±70 ms** to match YARG's default; keep a tighter inner
  **perfect window (±30 ms)** for feedback granularity (YARG has no perfect/good split;
  this is our pedagogical addition, documented as such). Beyond 70 ms = miss.
- Keep symmetric front/back (our matcher already uses `|delta|`); keep exact pad/cymbal
  identity matching (already enforced). Confirm greedy nearest-first matching is
  acceptable vs YARG's forward-scan — document the choice; nearest-first is fine for a
  practice scorer and slightly more forgiving.
- Keep `deltaMs` signed and surface it (feeds feature 1's early/late label).
- Reference the YARG files in a code comment so the provenance of ±70/±30 is clear.
- Windows must remain a parameter (don't hardcode) so calibration and future tuning work;
  the user's calibration offset (e.g. −41 ms) is applied before matching — verify that
  ordering is correct (calibration shifts hit times, THEN windows apply).

## Validation

- Jest: update/extend hitMatcher tests for the new ±70/±30 windows (boundary cases at
  29/31/69/71 ms, early vs late symmetry, overhit/extra, cymbal≠tom); scoring unchanged;
  best-attempt query test; tempo-state sharing if testable.
- Browser (chrome-devtools, dev seam `__drumFillsInjectHit`): open a fill, inject hits at
  known offsets (on-time, +50 ms, +90 ms, wrong lane, extra) and confirm the sheet-music
  markers show green/amber/red correctly with early/late labels; confirm best-attempt
  updates and persists across reload; confirm the tempo slider slows song-loop audio
  (pitch preserved) and the highway/playhead stay in sync at reduced tempo; no page
  scroll regression. Screenshots of the marked-up stave.
- Manual (real kit) remains for true feel, but the injection seam should make the visual
  feedback fully verifiable.
