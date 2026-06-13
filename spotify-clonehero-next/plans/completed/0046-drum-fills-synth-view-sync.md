# 0046 — Drum fills: chart views don't follow the fill in synth modes

Bug (user report with screenshot, 2026-06-12): in a Groove/Ladder session with Isolated
synth mode, the highway shows the start of the song (black, no notes) and the sheet music
sits at the song's first measures (`verse_1a`) with the playhead at the top. The user
cannot see the fill they're supposed to play; every hit scores Miss (16/16) because the
expected notes are at the fill window but the views (and the user) are at t=0.

## Root cause to confirm

In song-loop mode, AudioManager playback time drives both views and `setPracticeMode`
loops the fill region. In synth modes (isolated/roulette/ladder) the backing track has its
own clock (`BackingTrackPlayer.loopPositionSeconds()`, added in 0045 validation for
scoring) — but nothing maps that clock into chart time for the highway and sheet music, so
they render at chart t=0.

## Fix (implemented: chart-aligned synth track through AudioManager)

The first design — map the BackingTrackPlayer's own clock into chart time and hand the
views a synth-derived time source — was rejected during implementation: it bypasses
AudioManager and leaves two clocks. The implemented architecture keeps **AudioManager as
the single clock in every mode**, and synth modes never display or play the source
song's chart at all (the groove and fill generally come from different songs):

- **Synthetic practice chart** (`lib/drum-fills/practice/practiceChart.ts`, pure,
  tested): synth modes author their own chart — N groove bars (the folded groove
  pattern) followed by the fill notes re-authored by beat offset, at one tempo, in the
  pattern's time signature, starting at tick 0, with Groove/Fill sections. The highway,
  sheet music, scoring window, and backing audio all derive from this one chart.
- **Backing audio rendered at the chart's exact ms timing**
  (`lib/drum-fills/practice/backingAudio.ts`): one loop pass (kit + click over the
  groove bars, fill bars silent) rendered offline via OfflineAudioContext — reusing the
  pure `scheduleLoopEvents` + `renderEvent` kit synthesis — encoded as WAV
  (`lib/audio/wav-encoder.ts`, extracted from drum-transcription) and fed to a second
  AudioManager as a `Files` entry with chartDelay 0. `audioManager.chartTime` IS chart
  time; no mapping layer. Mirrors the sheet-music metronome (`generateClickTrack`)
  pattern. The live `BackingTrackPlayer` class is removed.
- **One code path**: synth modes run the same `setPracticeMode` loop + `handleLoopTick`
  scoring-anchor poll as song-loop mode, against the active AudioManager (song stems or
  backing WAV) — what is scored is exactly what the views show. The synth loop ends at
  the fill end, so a wrap back to the groove completes (not discards) the attempt.
- Views re-anchor on fill change (rung advance / rotation next) via the per-fill
  PracticeSession remount; the synthetic chart starts at t=0 so the views always sit on
  the groove+fill measures. In song-loop mode the manager is seeked to the loop start as
  soon as the audio is ready, so the views anchor on the fill's measures before Play.
- Tempo: the synth backing plays the chart's real rhythm at the fill's tempo;
  slower/faster practice goes through `AudioManager.setTempo` (pitch-preserving), as in
  the speed trainer.

## Also: use full viewport width on practice surfaces (user screenshot #2)

On wide screens the practice layout is constrained by the site's centered max-width
container, leaving large unused margins; the sheet music column fits only ~1 measure per
line. Fix:

- Practice/session surfaces (PracticeView, Groove/Ladder/Roulette sessions) break out to
  full viewport width (modest padding), like other full-bleed tool pages if a pattern
  exists (check how /sheet-music handles its container). List/browse views may stay
  centered.
- Distribute the gained width: wider highway container (the renderer must resize
  correctly — verify camera/aspect handling on resize) and a wider notation pane that
  renders MULTIPLE measures per line (check renderVexflow/SheetMusic for a fixed stave
  width; make it responsive to container width).
- Re-verify the no-page-scroll invariant at 1280×800, 1920×1080, and an ultrawide-ish
  2560×1080 after the change.

## Also: default practice mode = Song loop (user feedback)

Song loop (real song audio) is the default mode everywhere a fill is practiced — library
practice, Today queue, and groove/ladder/rotation sessions (overriding the 0045 choice of
isolated-synth default for multi-song sessions). Isolated synth remains one click away.
In sessions, switching fills loads that fill's song audio (show the existing loading
skeleton; pre-fetch the next fill's audio when known). If a song's audio fails to load,
fall back to isolated synth for that fill with a toast, not an error.

## Validation

Jest tests for the mapping (tempo mismatch, multi-bar grooves, loop wrap). Browser:
open a Ladder session, press Play — highway shows notes scrolling through the fill,
sheet music scrolled to the right measures with moving playhead; inject hits via
\_\_drumFillsInjectHit during the fill window and confirm non-miss judgments; advance a
rung and confirm views re-anchor. Console clean.
