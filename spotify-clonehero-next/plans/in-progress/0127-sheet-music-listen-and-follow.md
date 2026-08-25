# 0127 — Keep the sheet music on the right section while the band plays

Status: in progress — stages 1–3 built, stage 4 not started

## The problem

Eli plays drums in a band that rehearses in a loud studio. He opens
`/sheet-music` for the songs the band is working on, and then cannot scroll,
because both hands and both feet are busy. Fixed-speed autoscroll does not work:
the band does not play at the chart's tempo, and the right speed also depends on
the zoom level.

The goal is narrow, and the narrowness is what makes it possible. He does not
need an accurate playhead. He needs the **section he is playing to be on
screen**. In this mode the playhead is hidden entirely.

Three constraints come from how the room actually works:

- **Laptop microphone only.** The kit has MIDI out and the room has a mixer with
  a USB connection, but routing either one risks the band's monitoring setup.
  The feature must be standalone.
- **No touching the laptop.** He cannot tap a count-in or press start. The
  system listens all the time, decides by itself that a song began, and copes
  with false starts.
- **The band plays its own version.** His drum part is simplified or different
  from the chart. The other players read tabs found in various places online,
  unrelated to the Clone Hero chart and to each other, so the band's arrangement
  is not derived from the chart at all. Where the two disagree — a section the
  tabs omit, a repeat they count differently — the band follows the tabs and the
  chart is simply wrong for that rehearsal. Eli cannot look this up: the only
  record of what the band actually plays is the band playing it.

## What was measured

Four songs were recorded at a rehearsal on 2026-08-24 with the built-in
microphone, as uncompressed 48 kHz mono, and analysed with the repo's own
`spectralFluxEnvelope` (`lib/tempo-map/drum-onset.ts`). The recordings and the
matching charts are in `~/Desktop/rehearsal` and `~/Desktop/chart-sources`.

The room clips the microphone: 2.31% of samples are pinned at full scale. That
turns out not to matter for onsets.

### The band always plays faster than the chart

| Song                | Chart bpm | Band bpm | Offset  |
| ------------------- | --------- | -------- | ------- |
| Futures             | 84        | 92.4     | +10%    |
| What I've Done      | 120       | ~148     | +25%    |
| My Own Worst Enemy  | ~103      | ~110–114 | +7–11%  |
| She                 | ~185      | ~208     | +12%    |

Never slower, and by a different amount each time. The chart's tempo cannot be
used directly, and a ±10% window around it is both too narrow for some songs and
too wide to stay unambiguous for others.

### The frequency band decides everything

Windowed tempo estimates, 25 windows across one song:

| Band            | Windows that agreed |
| --------------- | ------------------- |
| Broadband       | 7/25                |
| Kick 40–120 Hz  | 9/25                |
| Snare 150–500 Hz| **19/25**           |
| Cymbal 6 kHz+   | 4/25                |

The snare band is the feature. The cymbal band is useless, because clipping
smears broadband energy into exactly that region.

### Local periodicity lies; duration tells the truth

Tempo errors are metrical, not random. On What I've Done the estimator offered
98.7 and 148 (a 2:3 pair). On She it confidently reported 104 bpm with the
steadiest reading of the night — half the true 208, because a fast punk backbeat
is strongly periodic at half the beat rate. In both cases the ratio of the
take's length to the chart's length gave the right answer.

### Global localization from drums does not work

Two independent methods were tried over (tempo ratio, offset): 4-band energy
novelty against the chart's section times, and smoothed chart note density
against observed onset density.

| Song               | Result                                    |
| ------------------ | ----------------------------------------- |
| What I've Done     | correct fit was runner-up, 0.391 vs 0.380 |
| Futures            | correct fit did not appear                |
| My Own Worst Enemy | correct fit did not appear                |

Both failures trace to the same cause: Eli plays simplified or different
patterns, and rock drum density is close to uniform, so the correlation surface
is flat and noise decides the winner. **This approach is closed.**

### Charts have sections but not lyrics

500 charts sampled from two corpora:

| Property           | enchor-songs (300) | enchor-new-charts (200) |
| ------------------ | ------------------ | ----------------------- |
| ≥3 section markers | 100% (median 13)   | 99% (median 15)         |
| Vocal/lyrics track | 0%                 | 0%                      |
| Varying tempo map  | 84%                | 87%                     |

Sections are effectively universal, which is what makes a section-level design
possible. Lyrics are absent, so live vocal alignment has no reference to align
against and is out of scope. Where two versions of a song exist, they agree on
section times and differ only in how finely they subdivide, so the chart with
more sections is the better one to follow.

### Matching the microphone to the studio recording does work

Every failure above compares the room to the *chart*, a symbolic drum sketch of
a performance Eli deliberately does not copy. The page already downloads the
song's audio, so the record itself is available as a reference — and because
Clone Hero charts are synced to their audio, locating the band in the recording
locates them in the chart.

Note for anyone repeating this: in a folder that carries stems, `song.opus` is
the *residual* backing, not the mix. The full mix must be rebuilt by merging
every stem except `crowd` and `preview`.

Features are 12-bin L2-normalised chroma at 10 fps. Searching whole-song over
(tempo ratio, offset), chroma put the correct alignment first on all four songs,
with a coherent peak neighbourhood rather than scattered maxima:

| Song               | True ratio | Chroma best | Rank |
| ------------------ | ---------- | ----------- | ---- |
| Futures            | 0.909      | 0.910       | 0    |
| What I've Done     | 0.800      | 0.790       | 0    |
| My Own Worst Enemy | ~0.920     | 0.895       | 0    |
| She                | 0.890      | 0.890       | 0    |

Onset flux managed 3 of 4 and band energy 2 of 4, so chroma is the feature.
A drum-dominated room microphone was assumed to make chroma useless; it does
not.

**Whole-song alignment is not the live problem, though.** Localising a bare
20-second window against the whole song fails badly — 4 of 18 windows on
Futures, median error 68.5 s. The failure is diagnostic rather than random: the
errors cluster at −68 s, and Futures' verse 1 begins at 17.1 s while verse 2
begins at 85.7 s, exactly 68.6 s apart. Chroma is correctly matching a verse to
a harmonically identical verse. Peak versus runner-up was 0.884 against 0.883.

Constrain that search to ±10 s of an expected position and it becomes precise:

| Song               | Within 5 s | Median error |
| ------------------ | ---------- | ------------ |
| Futures            | 13/18      | 0.2 s        |
| What I've Done     | 13/14      | 0.6 s        |
| My Own Worst Enemy | 12/13      | 0.2 s        |
| She                | 10/10      | 0.2 s        |

48 of 55 windows, median error about a fifth of a second. The remaining misses
are the same repeat confusion reaching one section away. The match reads only
the previous 20 seconds of microphone audio, so it is causal, and it costs a
20-second chroma window against roughly a hundred candidate offsets.

A fifth song, When I Come Around, was recorded with several flubbed fills and a
dropped stick near the end. It tracked at 13/15 windows within 5 s and a median
error of 0.1 s, exact to ±0.2 s through the first 110 seconds — because position
comes from the band's harmony, not from Eli's playing. That take also shows the
two remaining limits clearly. Around 118 s the error steps to a steady −5 s and
stays there, which is a structural divergence between the band's arrangement and
the record rather than accumulating drift. And in the vamping outro the error
grows to 9 s, because a looping two-bar chord pattern is genuinely ambiguous to a
harmonic feature. The second limit is harmless here: anywhere inside the outro
still puts the correct section on screen, which is the whole requirement.

### What works reliably

Deciding whether anyone is playing. Onset rate, gated by an absolute level
floor, split every recording into clean activity blocks. One detail is
load-bearing: a purely adaptive threshold reports 4–6 false hits per second in a
quiet room, so the detector needs an absolute floor **and** adaptive whitening,
never whitening alone.

## The approach

Drop global search. Track a clock, and treat structure as a stored property of
the song rather than something to detect live.

1. **Listen all the time.** Snare-band spectral flux in a worker, adaptive
   whitening plus an absolute dBFS floor, high-passed at 60–80 Hz to reject
   structure-borne kick thump through the table.
2. **Decide a song started.** Onset rate crossing a threshold with hysteresis.
   Assume the song starts at the beginning, which is what actually happens, and
   which removes the global search that was measured not to work. A false start
   is a start that stops; the clock resets and waits.
3. **Estimate the tempo ratio over the first bars.** Collect candidate tempos,
   then choose the metrical level whose ratio to the chart falls in about
   1.0–1.3. On the four measured songs this picks correctly three times outright
   and narrows the fourth from five candidates to two. A rough ratio is enough —
   step 4 corrects it continuously.
4. **Re-anchor against the record, about once a second.** Precompute the studio
   recording's chroma once per song and cache it. Match the previous 20 seconds
   of microphone chroma against the reference, searching ±10 s around where the
   clock thinks the band is, and correct the clock to the winner. This corrects
   drift instead of accumulating it, so no accurate beat tracker is needed —
   only a ratio close enough to keep the truth inside the search window. Drive
   the existing `getChartTimeSec` seam from the corrected estimate.
5. **Learn structural differences per song.** The band's arrangement comes from
   the other players' tabs, so it is fixed and it repeats every rehearsal — but
   it cannot be transcribed from anywhere, because no single document describes
   it. It has to be learned by watching the band play the song, then persisted
   and applied on the next play. This makes divergence detection worth building
   even though correction is stored: the system must at least notice, once, that
   the chart and the band parted company at a given point, so it has something
   to record. Being confidently wrong for one run-through and right afterwards
   is an acceptable outcome; being wrong every time is not.
6. **Fail to coasting, never to freezing.** Low confidence must keep the clock
   running rather than freeze the page. This matters less than first thought:
   because position comes from the band's harmony rather than from Eli's
   playing, his own mistakes and pauses do not blind it. A take with several
   flubbed fills and a dropped stick tracked to a median error of 0.1 s.

## Interface notes

- Position must be a belief over sections from the first version, even when that
  belief is nearly a point estimate. Retrofitting a filter onto a tracker later
  is the expensive path.
- Scroll granularity is the system or line, hysteretic: never scroll backwards a
  small amount, never scroll twice within a bar. A drummer reads ahead, so the
  target should lead the sounding position by a bar or two.
- Show confidence. A silently frozen page and a silently wrong page look
  identical from behind a kit, and one wrong jump mid-song costs all trust in
  the feature.
- `getUserMedia` must ask for `autoGainControl`, `echoCancellation` and
  `noiseSuppression` off, and must verify they were honoured — browsers apply
  these constraints inconsistently, and noise suppression is tuned to remove
  exactly this signal.
- The input device must be chosen explicitly, not left to the browser default.
  During testing the machine listed a Continuity iPhone microphone and a
  BlackHole loopback ahead of the built-in microphone, and device indices moved
  as those came and went.

## What is built

`lib/sheet-follow/` holds the follower: `chroma.ts` (features, shared by both
sides so the live and reference windows match), `follower.ts` (the pure search
and tracking loop), `reference.ts` (decode and sum the chart's stems),
`follow-worker.ts` (all the expensive work, plus the playing / not-playing gate)
and `useAutoScroll.ts` (microphone, worklet and worker lifecycle).
`public/mic-capture-worklet.js` forwards raw samples. The page gains an "Auto
scroll" switch in the left column; turning it on hides the playhead and scrolls
with a dead band instead of on every move.

Two things the replay harness forced, both of which had to be measured rather
than reasoned out:

- **A cold start commits once.** Running the wide search every half second let
  each pass move the estimate by the whole search radius and then re-anchor to
  it, walking the follower out of the song within seconds.
- **A match is a measurement, not a position.** Jumping to the match let one bad
  window move the search centre, so the next search followed it away. Dead
  reckoning owns the estimate and the match only trims it, bounded. Speed is
  taken from the search's own speed candidates; driving it from accumulated
  position error wound it up to the limit and then oscillated.

Measured with an offline, non-causal ground truth (banded subsequence DTW per
playing segment, symmetric step weights, both ends pinned to a coarse anchor;
the anchors match independent duration-ratio estimates on all six takes), and
scored in rows against the layout measured on the running page, with the scroll
clamp modelled — near either end of a song the view is pinned and the estimate's
error stops mattering.

| Take                   | On screen | Median   | Outages | Longest |
| ---------------------- | --------- | -------- | ------- | ------- |
| What I've Done         | 100%      | 0.19 rows| 1       | 1 s     |
| Futures                | 94%       | 0.14     | 1       | 11 s    |
| When I Come Around     | 92%       | 0.06     | 3       | 13 s    |
| She                    | 82%       | 0.57     | 1       | 20 s    |
| Sugar, We're Goin Down | 80%       | 0.24     | 1       | 36 s    |
| My Own Worst Enemy     | 14%       | 4.14     | 1       | 126 s   |

Every failure is one long outage, never flicker.

### What the harness proved cannot be done

**Recovery is impossible with this feature.** Once the follower is lost, a
whole-song search does not find the band. When a wide search says the current
lock is wrong, the place it points to is within 10 seconds of the truth 9 times
out of 88 on one take, and 0 out of 85 and 0 out of 26 on two others. Lengthening
the observation window does not help: 20, 40, 60 and 90 seconds all localise
correctly about one time in ten, with median errors of 32 to 101 seconds, even
when handed the true tempo. Chroma repeats at verse scale and no amount of
context inside one window escapes it.

**Confidence cannot detect a wrong lock.** On the take that spent its entire
length 50 seconds out of place, match trust had a median of 0.408 and fell below
0.15 in only 20% of updates. A wrongly-locked matcher is exactly as confident as
a correct one, because a local peak around a wrong position is just as sharp.
Every recovery mechanism gated on confidence is therefore dead on arrival, and
three built on that premise measured worse than doing nothing.

The consequence is that the only lever is not getting lost. Prevention, not
recovery.

### The gate now decides on transient size, not loudness

Loudness cannot make the call. Across two takes from the same room on the same
night, the quiet level sat 16 dB below the music on one and 24 dB below on the
other, because "quiet" holds different amounts of talking. Sweeping a level
threshold moves which take works and never fixes both: at 12 dB one take reaches
100% and the other 1%, at 13 dB they swap.

Onset *rate* does not separate them either, though it looks like it should. A
talking room produced a median of 5 onsets a second and a band produced 5 as
well, because a peak-picker whose threshold follows its own trailing mean finds
as many "onsets" in quiet noise as in real hits. An earlier offline version
appeared to work only because an absolute level floor underneath it was doing
the discriminating.

Transient *magnitude* separates them, which is exactly what a relative
peak-picker discards. In units of the room's own quiet flux:

| Take               | Playing   | Talking  |
| ------------------ | --------- | -------- |
| What I've Done     | 18–30×    | 0.2–3.4× |
| My Own Worst Enemy | 3.6–5.5×  | 0.3–0.8× |

The ratio is also gain-invariant, which matters because the browser captures the
same room about 14 dB hotter than these recordings.

| Take                   | On screen | Median    | Longest outage |
| ---------------------- | --------- | --------- | -------------- |
| My Own Worst Enemy     | 100%      | 0.93 rows | 0 s            |
| When I Come Around     | 94%       | 0.07      | 10 s           |
| What I've Done         | 87%       | 0.23      | 20 s           |
| She                    | 86%       | 0.50      | 17 s           |
| Futures                | 85%       | 0.38      | 31 s           |
| Sugar, We're Goin Down | 79%       | 0.57      | 38 s           |

For the first time no take fails catastrophically. **But the 531 total is a
knife edge and must not be quoted as robust.** Sweeping the ratio from 2 to 6,
five of the six takes hold steady at 79–100%; only My Own Worst Enemy flips, and
it reaches 100% at 3.5 alone (14% at 3.0, 0% at 4.0). The durable gain is that
What I've Done went from a threshold-dependent 0%-or-100% lottery to a stable
87–88% at every ratio in that range. 3.5 is what the measurements imply — talking
peaks at 3.4, the quietest band starts at 3.6 — but it sits between them with no
margin, and one more take could move it.

### The bug that was worth all of it

The noise floor was seeded from the first 0.1-second block of audio and then
only crept upward, with a 50-second time constant, and never at all once the
gate had latched. A recording that opens on near-silence therefore fixed the
floor about 24 dB below the real room, put the threshold with it, and the gate
never registered a single stop for the rest of the session — the follower locked
onto a false start and coasted through the whole take. Seeding it once the
one-second average has converged took that take from 0% to 100%.

### Tuning has hit diminishing returns

### First live use

Run in the room against the Halocene Zombie chart, the page followed the song
but sat consistently a few systems ahead. The cause was the cold start deriving
its lower search bound from the moment the level gate fired: noise before the
band actually begins counts as elapsed song time, so the search starts past where
the band is, and the ±6 s tracking search cannot walk back that far. The bound
now comes from the observation window's own length, which is the only thing that
is certain, and ignores the gate's timing entirely.

That run also showed the replay harness understates the gate. Replaying the same
take's ffmpeg recording, the gate never fires at all, because ffmpeg captured the
room roughly 14 dB quieter than Chrome does. Gate results measured on the
recordings are therefore a lower bound on what happens in the browser, not a
prediction of it.

### The start gate is the weak part, and it is not solved

Where the gate identifies the start correctly, the matching is excellent. Where
it does not, nothing downstream recovers.

Chrome's capture is about 14 dB hotter than ffmpeg's for the same room: the
rehearsal recordings put a quiet room near −32 dBFS, and Chrome's `getUserMedia`
with gain control off reads about −18 for a quiet room. So the gate cannot use a
fixed level; it compares a one-second average against a tracked noise floor.

That still does not settle What I've Done. That take opens with two false starts
separated by talking; the gate fires on the first one, the follower locks onto
it, and it then dead-reckons through the stop, so by the time the band really
begins it is fifty seconds ahead. Sweeping the margin from 8 to 18 dB moves which
takes work but never fixes all five — the level of talking between takes and the
level of a band playing are not cleanly separable per take with one constant.

Measured levels behind that claim:

| Take           | Quiet room | Talking (p90) | Playing (median) |
| -------------- | ---------- | ------------- | ---------------- |
| What I've Done | −34.7      | −24.2         | −10.4            |
| My Own Worst   | −25.7      | −24.5         | −9.8             |

Playing is consistently near −10 dBFS because the room clips the microphone. But
the gap between talking and playing is 14 dB in one take and 15 dB in the other
while the *floor* differs by 9 dB, which is why one margin cannot serve both.

A recovery path exists in the follower — sustained low confidence gives up the
lock and looks for the song from the top again — but replay never triggered it,
because a wrongly-locked matcher still reports middling confidence. It is
therefore untested, and should not be counted on.

## Stages

1. **Capture and features.** Microphone input with the constraints above and a
   device picker; snare-band flux in a worker; the playing / not-playing
   detector. Testable against the recorded rehearsal files.
2. **Clock and re-anchoring.** Studio-chroma precompute and cache; tempo
   candidate generation and metrical-level selection against the chart; the
   ±10 s chroma re-anchor loop feeding `getChartTimeSec`. A "follow" mode that
   hides the playhead and scrolls by section. Testable end to end against the
   recorded rehearsal files, which is the point of doing it this way round.
3. **Confidence and coasting.** Freeze-versus-coast behaviour, the confidence
   indicator, and manual override that suspends following after a touch.
4. **Learned arrangement.** Notice where the band and the chart diverge, record
   it per song, and apply it on the next play. This is the only stage that
   cannot be built from the existing recordings, because none of them contains a
   divergence.

## Open

- Everything measured so far seeds the search from a known-good position. In the
  running system that position comes from the tracker's own estimate, so the
  loop has to be shown to stay locked rather than wander out of its own ±10 s
  window. That is a closed-loop property no offline probe can establish.
- The reference needs the song's audio. `/sheet-music` already downloads it for
  playback, but the follower is useless on a chart whose audio is missing, and
  charts with badly-synced audio will mislocate rather than fail loudly.
- Stage 4 now has one test case — the −5 s step in When I Come Around — but not
  a clean skipped section. A whole skipped section moves the truth far outside
  the ±10 s window, and widening the search is exactly where the
  verse-versus-verse ambiguity lives, so this stage keeps the real unknowns.
- What the −5 s step actually was is not established. A repeated phrase, a
  dropped bar and a local tempo change all look the same from a step in the
  alignment, and telling them apart matters for what gets stored.
- A stateful beat tracker is no longer needed. Per-window autocorrelation was
  steady on only one of four songs (sd 1.76, 4.71, 6.87, 2.12 bpm), but
  continuous re-anchoring makes tempo precision nearly irrelevant.
