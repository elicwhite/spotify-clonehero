# Plan 0064: Leading-silence padding for clean tick-0 (real TS + real tempo)

Spec from a session with Eli (2026-07-19). Feature: pad the start of the
song's audio with silence so the written chart opens the way human charts do
— the real time signature AND the real tempo at tick 0, whole lead-in bars
at the real tempo, no synthetic constructs (no 472k-BPM collapse marker, no
r/4 partial-first-bar trick).

## Why

`buildSyncLayout` (lib/tempo-map/synctrack-ticks.ts) must satisfy two hard
constraints: ms(tick 0) = 0 and the predicted origin (first downbeat) on a
bar line. When the audio starts close to (or after) the first downbeat there
is no room for whole lead-in bars, so the writer falls back to a stretched
lead-in BPM, a partial first bar (r/4 TS at tick 0), or a compressed
near-instant segment (BPM in the hundreds of thousands for 0.5 ms). All are
correct but none look like a human chart. The 15.5k-chart census
(drum-to-chart `wiki/tick0-lead-in-conventions.md`, 2026-07-02) showed the
human solution is upstream of the writer: **the ecosystem pads audio** —
first-note time p10 ≈ 2015 ms, median 5.5 s — so whole near-real-tempo bars
always fit. This feature does the same thing programmatically.

Key property: padding needs **no writer changes**. It moves the input into
the regime where the existing tier (a) ("whole lead-in bars") fires with
implied stretch ≈ 0, so the emitted lead-in BPM equals the real tempo and
`leadInTs` stays null. All existing tiers remain as fallback when the
feature is off.

## The calculation

Inputs, taken from the **final installed synctrack** (i.e. AFTER
`finalizeSynctrack` — KS-warp / reach-extension / partial-origin-revert can
move `tempos[0]`, so compute after, never before) and the emitted note list:

- `originMs` = `sync.tempos[0].ms` — first downbeat, audio-relative ms (may
  be negative or sub-beat small).
- `bpm0` = `sync.tempos[0].bpm` — the real tempo at the origin.
- First time signature `n/d` → `barBeats = n * 4 / d` (quarter-note beats;
  fractional is fine, e.g. 7/8 → 3.5), `barMs = barBeats * 60000 / bpm0`.
- `firstNoteMs` = earliest emitted note time in ms (pickups may put this
  BEFORE `originMs`; use the true minimum).
- `LEAD_MIN_MS = 2000` — human census p10 of first-note time (2015 ms),
  rounded down. Constant, top of the new module.

Steps:

1. **Required extra room.** The padded first note must sit ≥ LEAD_MIN_MS
   into the audio:

   `pMin = max(0, LEAD_MIN_MS - firstNoteMs)`

   (A song that already has generous silence gets `pMin = 0`; step 2 then
   only adds the sub-bar remainder needed for exact bar alignment.)

2. **Whole lead-in bars.** Choose the smallest whole-bar count that clears
   `pMin`:

   `N = max(1, ceil((originMs + pMin) / barMs))`

   `N ≥ 1` guarantees at least one full bar before the origin even when
   `originMs ≤ 0` (origin at/before the current audio start — the formula
   handles negative `originMs` with no special case).

3. **Exact padding.**

   `P_ms = N * barMs - originMs`

   By construction the padded origin time `originMs + P_ms = N * barMs` is
   exactly N bars at `bpm0` from t=0.

4. **Sample quantization.** Silence must be whole samples:

   `P_samples = round(P_ms * sr / 1000)`, `P'_ms = P_samples * 1000 / sr`

   The residual `|P'_ms - P_ms| ≤ 0.5 sample` (≈ 0.011 ms at 44.1 kHz,
   0.010 ms at 48 kHz). Do NOT try to null it: it flows into
   `buildSyncLayout` as an implied lead-in stretch of ~1e-5 — six orders of
   magnitude under the 25% tier-(a) threshold — so tier (a) still fires and
   the emitted tick-0 BPM differs from `bpm0` by < 0.001. `DUPBPM_COLLAPSE`
   (eps 1e-3) then merges the tick-0 segment with the origin segment, so the
   chart opens with a SINGLE tempo marker at the real tempo.

Resulting chart open (what the user sees at tick 0): real `n/d` TS, real
tempo `bpm0`, first downbeat on the bar line at tick `N * barBeats *
resolution`, pickups (if any) on the real-tempo grid inside the lead-in
bars. Nothing synthetic.

### Worked example (the Intro screenshot song, 2026-07-18)

`bpm0 = 146.98`, 4/4 → `barMs = 4 * 60000 / 146.98 = 1632.88 ms`. The old
writer emitted a 472,108.39 BPM collapse marker → `preBeats =
472108.39 / (60000 / 0.5) / 1 = 3.934` → `originBeats = 4 - 3.934 = 0.066`
→ `originMs ≈ 26.9 ms` (audio starts 27 ms after a downbeat — tier (c)
territory). First note at the origin:

- `pMin = 2000 - 26.9 = 1973.1 ms`
- `N = max(1, ceil((26.9 + 1973.1) / 1632.88)) = ceil(1.225) = 2`
- `P_ms = 2 * 1632.88 - 26.9 = 3238.9 ms` (142,836 samples @ 44.1 kHz)

Chart opens: `4/4` + `146.98` at tick 0, first downbeat at tick 1536
(res 192), first note ≈ 3.27 s in. No 472k marker, no partial bar.

## Application mechanics

Run the full pipeline (separation → ADT → beats → synctrack →
`finalizeSynctrack`) on the ORIGINAL audio, compute `P'_ms` once at the end,
then apply it as a uniform shift — **never re-run the pipeline on padded
audio** (everything downstream is time-invariant under a constant shift, and
re-running would let the beat tracker move):

1. **Audio**: prepend `P_samples` of digital silence per channel in the PCM
   domain, BEFORE Opus/OGG encode (plan 0063 layout: pad, then
   `encodePcmToOpus`). Encoder pre-roll/preskip is container-handled as
   today; no change. `song.ini` delay stays 0.
2. **Events**: add `P'_ms` to every ms-domain artifact — synctrack
   `tempos[].ms` / `timeSignatures[].ms` / `origin_ms`, note
   `timeSeconds`, section markers, waveform/preview offsets. One shared
   helper; grep for every consumer of pipeline ms before landing.
3. **Writer**: unchanged. `buildSyncLayout` receives the shifted synctrack
   and lands in tier (a) as shown above.

Per-note offset basis (t4, 0/7 ms) is unaffected — uniform shifts commute
with it.

## Edge cases & guards

- **Origin before audio start** (`originMs < 0`): formula unchanged; the
  origin lands on a bar line inside the padded region and the old
  negative-origin collapse path never triggers.
- **Fractional `barTicks`** (`barBeats * resolution` non-integer — only for
  exotic denominators at low resolution): assert integer at res 192 for
  d ∈ {1,2,4,8,16}; if the assert ever fires, bump N's tick placement by
  rounding and log (do not block).
- **No tempos** (empty synctrack): feature no-ops, writer's 120 BPM default
  stands.
- **Very long existing silence** (`firstNoteMs` ≥ LEAD_MIN_MS and
  `originMs` already ≈ N·barMs): `P_ms` can be sub-bar-small or ~0; that is
  correct — we only top up to exact bar alignment.
- **Feature toggle**: off → current behavior byte-identical (tiers a/b/c).
  This is the parity story: with padding ON, goldens change by design; add
  a dedicated fixture rather than regenerating the existing lead-in goldens.
- **UI**: surface "Added X.X s (N bars) of leading silence" in the
  conversion summary so charters aren't surprised by the longer audio.

## Test plan

- Unit: the four formula steps against hand-computed cases — sub-beat
  origin (worked example), negative origin, already-padded song (pMin=0),
  7/8 first TS, and the `N = max(1, …)` boundary.
- Property: for random (bpm0 ∈ [60, 220], originMs ∈ [-4000, 8000], TS ∈
  {4/4, 3/4, 6/8, 7/8}), after padding `buildSyncLayout` must return
  `leadInTs === null`, a single post-collapse tempo marker at tick 0 within
  0.001 BPM of `bpm0`, and origin tick = `N * barBeats * resolution`.
- E2E: one real song through the padded path; open in Moonscraper/CH and
  confirm tick 0 shows the real TS + tempo (the manual-render check that
  was still open on the tick-0 conventions page covers this too).

## Non-goals

- No change to `buildSyncLayout` tiers (they remain the no-padding
  fallback), no change to KS-warp/reach, no re-tick of pickups (they
  already re-tick on the real-tempo grid), no trimming of excessive
  existing silence (separate feature if ever wanted).

## Editor-button addendum (session 2026-07-19)

Eli's revised scope: this is a **button in the editor** (above Add Lyrics),
not a pipeline stage. Constraints: the stored audio (`song.opus`, stem
cache) is NEVER modified; no `delay`/`song_offset` in the exported chart —
notes are genuinely re-timed; the silence amount must track later tempo
edits at the start of the track.

Design decisions:

1. **Audio anchor.** New doc-level value `audioAnchor = {tick, ms}` — the
   chart-time position of original audio sample 0. Lives on the
   `ChartDocument` (cast-based accessor in `lib/chart-edit/leading-silence.ts`,
   survives the spread-based clones, so whole-doc undo snapshots restore it)
   and is mirrored to `ProjectMetadata.audioAnchor` on save; regenerate
   clears it. Absent/0 anchor ⇒ feature off, current behavior.
2. **Anchor glue semantics** (same as notes): audio-glue (KEEP-MS) tempo
   edits keep `anchor.ms`, recompute tick; grid-glue (KEEP-TICKS) edits keep
   `anchor.tick`, recompute ms. This is how "editing tempo at the beginning
   changes how much leading silence there is" falls out for free.
3. **Apply = ms-domain shift through the existing writer.** The command
   reconstructs the logical synctrack via `synctrackFromChart`, dropping a
   tick-0 collapse marker (bpm ≥ 5000 — tiers c/negative) when present;
   origin = first downbeat-aligned tick at/after the surviving opening
   marker (tick 0 for non-collapse charts, originMs = 0). Plan formula
   unchanged (LEAD_MIN_MS = 2000, N whole bars, sample-quantized P').
   Every event's msTime += P', then `swapSynctrack` (quantizeNotes off,
   sections preserved) + collision nudge + `retimeChart`. Content notes
   shift by an exact whole-bar tick count; tier (a) fires with ~0 stretch,
   so the chart opens with the real TS + real tempo. Repeat presses
   accumulate into the anchor (or no-op when P' < 0.5 ms).
4. **Non-collapse openings (tiers a/b) are NOT reverse-engineered** — a
   tick-0 stretched-BPM or partial-TS opening is indistinguishable from
   real music, so the shift treats tick 0 as the origin and prepends whole
   bars of the opening TS at the opening BPM. Only the unambiguous collapse
   marker is rebuilt into the clean real-tempo opening.
5. **Audio at rest untouched; in-memory PCM padded.** EditorApp pads the
   decoded full-mix/drums/vocals PCM by `round(anchor.ms * sr / 1000)`
   samples before WAV-encoding/AudioManager/waveform use, and rebuilds them
   when the anchor's sample count changes (preserving playback position).
   WYSIWYG: in-session audio == exported audio.
6. **Export** pads PCM before Opus encode (opus-verbatim passthrough is
   bypassed when anchor > 0); `song_length` follows from the padded
   duration. No `delay` written.
7. **Audio-relative boundaries get +anchor.ms**: decoded onsets fed to the
   half/double RE-PREDICT op, and Add Lyrics alignment output.
