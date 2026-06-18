# youtube-align

Find the YouTube video matching an Encore chart and compute the offset needed to
play that YouTube audio in place of the chart's (copyright) bundled audio,
aligned to the chart **notes**. Verifies alignment across the **whole** song —
detecting mid-song interruptions and speed/drift — not just the start.

This is an exploration spike (see `spotify-clonehero-next/plans/in-progress/0050-youtube-audio-alignment.md`).

## What it produces

A CSV, one row per chart:

| column            | meaning                                                              |
| ----------------- | ------------------------------------------------------------------- |
| `chart_md5`       | Encore chart md5 (also the `.sng` filename).                        |
| `youtube_url`     | Matched video, or empty if no confident match.                     |
| `offset_ms`       | Shift to align YouTube to the chart **notes** (`audio_offset + delay`). |
| `audio_offset_ms` | YouTube-vs-bundled-audio offset (diagnostic).                      |
| `delay_ms`        | Chart `delay`/`chart_offset` (note offset from its own audio).     |
| `speed_ratio`     | YouTube speed relative to chart (1.0 = identical).                 |
| `aligned`         | Stays aligned with ~constant offset across the whole song.         |
| `coverage`        | Fraction of the song where local alignment matches the model.      |
| `confidence`      | Median peak-to-sidelobe ratio (match quality).                     |
| `mix_source`      | `full_mix` (used `song.*`) or `stem_sum` (summed stems).           |
| `interruptions`   | JSON list of `{at_ms, jump_ms}` discontinuities in offset(t).      |
| `notes`           | e.g. `match=none`.                                                  |

### Why `offset_ms` adds the chart delay

We align YouTube to the chart's bundled audio. But the chart's notes are offset
from that audio by `delay`/`chart_offset` (`chartTime = audioTime - delay`). The
value a player needs to line YouTube up with the **notes** is
`audio_offset_ms + delay_ms`. Ignoring the delay ships a biased offset for every
chart that has one.

## How alignment works

1. Decode both mixes through one ffmpeg pass to mono at a common sample rate.
2. **Chart mix:** prefer a `song.*` full mix; otherwise equal-power (`1/√n`) sum
   of stems, excluding `preview.*`/`crowd.*`.
3. **Dense offset(t):** a predictive tracker follows the offset window-by-window
   with GCC-PHAT. It searches a tight band around a short extrapolation of the
   recent good track (so a wrong-beat peak can't be selected) and re-locks when a
   confident off-track offset *persists* (a real step). Several candidate initial
   offsets are tried and the most consistent track is kept, so a bad initial lock
   can't derail it.
4. **Interpret:** detect/remove steps on the raw offset (→ `interruptions` and
   their magnitudes), fit the slope on the step-corrected series (→ `speed_ratio`),
   measure `coverage` of the flat corrected level over *all* windows, and gate
   match/abstain on coverage + PSR + step count. At corpus scale a confident
   wrong match is worse than no match, so abstaining (`match=none`) is deliberate.

Pitch is intentionally not detected — only timing matters for playback.

Cost: trying multiple candidate tracks makes `align()` a few× heavier (many FFTs
per song). That's fine for a batch job; if corpus runtime matters, decimate the
feature rate further, cache FFTs, or reduce candidates.

## Usage

```bash
pip install -r requirements.txt          # + ffmpeg on PATH
python -m youtube_align.pipeline --demo   # offline end-to-end (synthetic)
python -m youtube_align.pipeline --md5 <chart_md5> --out out.csv --verbose
```

## Tests

```bash
python -m pytest
```

Covers: SNG round-trip; recovery of a known offset (through lossy Opus), a known
speed change, and a mid-song interruption; abstaining on unrelated audio; and the
chart-note-relative offset.

## ⚠️ Network limitation — the real spot-check is NOT done here

This was built in a sandbox whose network policy **blocks** `api.enchor.us`,
`files.enchor.us`, and YouTube (HTTP 403 `host_not_allowed`). So:

- The alignment **math** is validated against **synthetic ground truth**
  (known offset/speed/gap recovered within tolerance). That de-risks the
  algorithm but is **not** the real-song spot-check the task asked for.
- The Encore-download and YouTube-search/download steps are implemented but
  **unrun**. Thresholds (`PSR_MIN`, `COVERAGE_*`, `CONFIDENCE_MIN`, `STEP_MS`)
  are calibrated on synthetic data and **will need recalibration on real
  recordings**.

Measured on a synthetic sweep (60 seeds): offset, ±1% speed, and mid-song gap
were recovered with **0 failures**; unrelated-audio abstained except a **~3%**
residual false-positive. That residual is an artifact of the synthetic — its
"unrelated" songs share structure, so they correlate about as much as a 1%
time-stretch of the same song, and a confidence/PSR gate can't separate the two
(legit speed matches have the *same* low PSR). `coverage` is therefore the real
match gate; on real recordings, genuinely different songs won't reach the
coverage threshold, but the abstain thresholds should still be validated on a
labeled sample before trusting the corpus output.

To do the real spot-check, run on a machine where those hosts are allowed:

```bash
python -m youtube_align.pipeline --md5 <real_chart_md5> --verbose
# Expect: a youtube_url, offset_ms, speed_ratio≈1.0, aligned=true, coverage≥0.9
```

Spot-check a handful of charts (including one with non-zero `delay`, and ideally
one whose YouTube upload has a talk-intro or an inserted ad) before running the
whole corpus.

## If this graduates into the app

Reuse TypeScript instead of this Python spike: `@eliwhite/parse-sng` (container),
`mergeAudioFiles` in `lib/tempo-map/merge-audio.ts` (equal-power mix),
`getChartDelayMs` (delay), and `lib/tempo-map/` DSP.
