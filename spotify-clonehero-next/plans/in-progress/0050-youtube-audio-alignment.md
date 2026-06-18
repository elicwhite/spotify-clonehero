# Plan 0050: YouTube Audio Alignment for Charts

> **Status:** Exploration / spike. Core algorithm validated; real-corpus run is
> gated on network access (see "Environment constraint").
>
> **Goal:** For each Encore chart (which ships copyright audio), find the matching
> YouTube video and compute the time offset needed to play that YouTube audio in
> place of the bundled audio, aligned to the chart's notes. Verify alignment
> across the **whole** song — not just the start — detecting mid-song
> interruptions (inserted gaps) and speed differences (drift). Emit a CSV row per
> chart.

## Why this exists

Charts downloaded from Encore embed copyright audio. We want the option to play
the matching YouTube video instead. That requires, per chart:

1. The matching YouTube URL.
2. The offset to apply to the YouTube audio so it lines up with the **chart
   notes**.
3. A whole-song alignment verdict: does it stay aligned, or does YouTube have an
   interruption / play at a slightly different speed?

## Deliverable: CSV schema

One row per chart. Columns:

| column               | meaning                                                                    |
| -------------------- | -------------------------------------------------------------------------- |
| `chart_md5`          | MD5 of the chart (the Encore `md5`, also the `.sng` filename).             |
| `youtube_url`        | Matched YouTube watch URL, or empty if `match=none`.                       |
| `offset_ms`          | Milliseconds to shift YouTube to align with **chart notes** (see below).   |
| `audio_offset_ms`    | YouTube-vs-bundled-audio offset (diagnostic; excludes chart delay).        |
| `delay_ms`           | Chart `delay`/`chart_offset` (from `getChartDelayMs` semantics).           |
| `speed_ratio`        | YouTube playback speed relative to chart audio (1.0 = identical).          |
| `aligned`            | bool: stays aligned across the whole song within tolerance.                |
| `coverage`           | fraction of the song where local alignment matches the model (0..1).       |
| `confidence`         | median peak-to-sidelobe ratio of local correlations (match quality).       |
| `mix_source`         | `full_mix` (used a `song.*` file) or `stem_sum` (summed stems).            |
| `interruptions`      | JSON list of `{at_ms, jump_ms}` discontinuities in offset(t).              |
| `notes`              | free text (e.g. `match=none`, `length_mismatch`).                          |

### Offset is chart-note-relative (critical)

We align YouTube to the bundled audio (`audio_offset_ms`). But the chart's notes
are offset from its own audio by `delay`/`chart_offset`
(`chartTimeMs = audioTimeMs - chartDelayMs`, per plan 0027). The value a player
needs to line YouTube up with the **notes** is:

```
offset_ms = audio_offset_ms + delay_ms
```

Aligning YouTube to the bundled audio and ignoring `delay_ms` ships a
systematically biased offset for every chart with non-zero delay. Validation
includes a non-zero-delay case.

## Algorithm

1. **Decode** both the chart mix and the YouTube audio with ffmpeg to mono
   float32 at a common sample rate (sample-rate discipline: one resampler, one
   rate — naive per-side resampling drifts timing).
2. **Chart mix reconstruction:** prefer a single `song.*` full mix if present;
   otherwise equal-power sum (`1/sqrt(n)`) of stems, excluding `preview.*` and
   `crowd.*`. Record `mix_source`.
3. **Coarse global offset:** cross-correlate the two **onset-strength
   envelopes** (spectral flux, ~100 Hz frame rate, normalized). Robust to
   EQ/loudness/codec differences between the copyright master and a YouTube
   re-upload. Gate on peak-to-sidelobe ratio (PSR) — low PSR ⇒ likely not the
   same recording.
4. **Dense offset(t):** slide overlapping windows across the song; for each,
   estimate local delay via **GCC-PHAT** (phase transform — whitens magnitude,
   so robust to the master/EQ differences). Produces `(t_i, offset_i, psr_i)`.
   Discard low-PSR windows (silence / no content).
5. **Interpret offset(t)** with a robust line fit `offset = a + b·t`:
   - slope `b` ⇒ `speed_ratio` (constant speed difference / drift),
   - residual **step** discontinuities ⇒ interruptions (inserted gap),
   - `coverage` = fraction of valid windows whose residual is within tolerance.
6. **Match decision / abstain:** require PSR and coverage above thresholds, else
   emit `match=none`. At corpus scale even a 1% false-positive rate ships
   hundreds of wrong URLs, so abstaining is a feature. A near-miss (same song,
   different mix) aligns only in patches ⇒ low coverage ⇒ abstain.

Pitch is intentionally **not** detected: for playback alignment only speed/timing
matters, key does not.

## Matching the YouTube video

Search yt-dlp `ytsearchN:"<artist> <title>"`, then **confirm by alignment**
(coverage + PSR), not by search rank. Trust the aligner, not the title.

## Environment constraint (read before running)

This was developed in a sandboxed container whose network policy **blocks**
`api.enchor.us`, `files.enchor.us`, and all of YouTube
(`youtube.com`/`googlevideo.com` → HTTP 403 `host_not_allowed`). pip/apt/GitHub
work. Therefore:

- The **alignment core** is validated here against **synthetic ground truth**
  (known offset / speed / gap applied to a local file, then recovered). This
  de-risks the math but is **not** the real-song spot-check the user asked for.
- The Encore download + YouTube search/download steps are built but **cannot run
  here**. Run `tools/youtube-align/` on a machine where those hosts are allowed.

The real-song acceptance test (run where the network is allowed):

```bash
python -m youtube_align.pipeline --md5 <chart_md5> --out out.csv --verbose
# Pass: prints offset_ms, speed_ratio, aligned=true with coverage >= 0.9
```

## Layout

```
tools/youtube-align/
  youtube_align/
    sng.py            # SNG container reader (inverse of lib/chart-export/sng.ts)
    audio.py          # ffmpeg decode, onset envelope, GCC-PHAT, common SR
    chart_audio.py    # stem selection + equal-power mix
    align.py          # coarse offset + dense offset(t) + interpret + abstain
    youtube.py        # yt-dlp search/download (network-gated)
    pipeline.py       # per-chart orchestration + CSV (CLI)
    make_synthetic.py # ground-truth generator (ffmpeg)
  tests/              # pytest: sng round-trip, recovery of offset/speed/gap, negative, delay
  README.md           # how it works + the network limitation + real-data command
```

## Validation done here

- SNG reader round-trips a synthetically-built container (matches `sng.ts`).
- Aligner recovers a known offset within tolerance.
- Aligner recovers a known speed_ratio (time-stretched copy).
- Aligner flags a known mid-song inserted gap as an interruption at the right
  time.
- Negative case (unrelated audio) abstains (`match=none`).
- Chart-relative offset = `audio_offset_ms + delay_ms` on a non-zero-delay case.

## If this graduates into the app

Reuse TS rather than the Python spike: `@eliwhite/parse-sng` for the container,
`mergeAudioFiles` (`lib/tempo-map/merge-audio.ts`) for the equal-power mix,
`getChartDelayMs` for the delay term, and the `lib/tempo-map/` DSP for envelopes.
