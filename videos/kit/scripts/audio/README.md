# scripts/audio

A film's soundtrack: the music edit and the timing data every scene syncs
to, sound effects placed on cue frames, and a music bed arranged from loops.
Everything runs in Node (`node --import tsx`), with ffmpeg and ffprobe on the
PATH. Commands below run from `videos/kit`; every path comes from a flag.

| Tool            | What it makes                                                                                                             |
| --------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `soundtrack.ts` | `buildSoundtrack(config)`: a song's chart and stems, edited into the film; timeline.json, peaks, envelopes, mix and stems |
| `sfx.ts`        | sound effects synthesized with ffmpeg, placed on film frames over a bed                                                   |
| `loopBed.ts`    | a music bed arranged from loops on a beat grid                                                                            |

## The soundtrack from a chart

```bash
node --import tsx scripts/audio/soundtrack.ts --config <film>/soundtrack.config.ts \
  --chart <chart folder> --out <film>/public/generated [--export default] [--report <file.json>]
```

The chart folder holds `notes.chart` (or `notes.mid`), `song.ini` and one
audio file per stem, named after it (`drums.ogg`, `vocals.opus`, ...). The
config module's export (`--export`, default `default`) is a
`SoundtrackConfig` (`soundtrackConfig.ts`):

| Field                          | Meaning                                                                                                                                                                                                                                                                               |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `durationSec`, `fps`           | The film's length (a whole number of frames) and rate                                                                                                                                                                                                                                 |
| `stems`                        | Stem names as the chart folder has them, or `{name, files}` to sum several files (`drums_1`, `drums_2`) into one stem. The mix is their plain sum, as the game plays it                                                                                                               |
| `songBars`                     | Song-bar ranges `[first, last]` (inclusive, 0-based) laid end to end from video time 0. They must add up to `durationSec` to within a frame, or the build stops; the last segment then ends exactly on the film's end (a film is whole frames, bars rarely are)                       |
| `crossfade`                    | `{default, stems?}`: each splice's equal-power crossfade (`lengthSec`, above 0; `guardSec`, `lookbackSec`, `marginSec`), placed clear of any attack near the bar line                                                                                                                 |
| `lanes`                        | Gain automation on video bars and beats: `{kind: 'ramp', stems, gainDb, from, to, rampIn, rampOut}` and `{kind: 'mute', stems, edges: [{at, mute}], muteFadeSec, unmuteFadeSec}`. A position is a bar or `[bar, beat]`; a span is `{beats}` or `{sec}`. Lanes on one stem multiply    |
| `tail`                         | An optional reverb ring-out for a song that ends before the film: a send opens at `send` (ramping in over `sendRampSec`), the dry stems fade over `dryFade: {from, to}`, and `rt60Sec`, `wetDb`, `preDelaySec`, `brightHz`, `darkHz`, `darkenSec`, `lowCutHz` and `seed` set the tone |
| `startFadeSec`, `finalFadeSec` | Click-free edges                                                                                                                                                                                                                                                                      |
| `master`                       | `{lufs, ceilingDbtp}`: one gain on every stem, and a look-ahead true-peak limiter only if the peaks need it; the stems still sum to the mix                                                                                                                                           |
| `drumStem`, `vocalStem`        | The stem whose chart notes verify the edit, and the stem whose muted ranges drop lyric phrases from the timeline                                                                                                                                                                      |
| `peaks`, `envelopes`, `notes`  | Which stems get curves (default all), the peak rate (default 240/s), and extra words for `mix.notes`                                                                                                                                                                                  |

The config is checked before any audio is read, and every problem is named
at once: each field's type and range (the rate, lengths, crossfades, `rt60Sec`
and `darkenSec` above zero, whole frames), stem names that exist and do not
repeat (`mix` is reserved), and mute edges that alternate. A value that
would turn into NaN, and so into silence, never reaches the render. The
order of positions needs the chart's beat grid, so the build checks it
when it resolves them: a ramp whose ramps overlap, mute edges out of film
order, a dry fade that starts before the send opens or ends before it
starts, and a send after the film's end all stop the build.

It writes, each file atomically (temporary name, then rename), with
timeline.json last:

- `timeline.json`: the contract in `src/music/contract.ts`, credits in `meta`
- `peaks.json`, `envelopes.json`: `{rate|fps, stems: {mix, <stem>...}}`
- `audio/mix.wav` and `audio/stems/<stem>.wav`: 24-bit, 48 kHz

Lyric text never leaves `chart.ts`: only syllable timing is written. The
same inputs give the same bytes. The verification report (stdout and
`--report`) covers loudness by the in-house BS.1770 meter and by ffmpeg's
ebur128, the true peak, clicks at every splice, drum sync against the chart
and against the unedited stem, and a cross-correlation proving every drum
hit sits on the same sample it did in the song. The tool exits 1 when a
check fails; the files are still written, for inspection.

To try it without song material, generate a synthetic chart folder (invented
metadata, a click-track kit and tones whose every hit lands on its note):

```bash
node --import tsx test/fixtures/synthetic-song.ts --out "$TMPDIR/song" [--bars 40] [--bpm 120]
```

## Sound effects

```bash
node --import tsx scripts/audio/sfx.ts --cues <cues.json|module.ts> [--fps <fps>] \
  --out <mix.wav> (--bed <bed.wav> | --length <frames>) [--export sfx] \
  [--lufs -14] [--true-peak -1.5] [--raw] [--kinds-dir <dir>] [--report <file.json>]
node --import tsx scripts/audio/sfx.ts --list-kinds
```

A cue is `{frame, kind, pan?, gain?}`: the film frame the sound starts on,
one of the kinds below, a stereo position (-1 left to 1 right, or
`{from, to}` to move across the sound), and dB relative to the kind's level.
`--cues` is a JSON array or a module whose export (`--export`, default
`sfx`) is that array. The frame rate is `--fps`, or the `fps` a cue module
exports beside its cues (`export const fps = FORMAT.fps;`); a JSON cue list
needs `--fps`, and when both are given they must agree. Without `--bed`,
`--length` (frames) sets the mix's length. The pan law is constant power
with a centred sound at unity in both channels. Every cue is checked first
(a whole frame, a known kind, pans within -1..1), naming every bad one.

| Kind          | Level  | Sound                                                                            |
| ------------- | ------ | -------------------------------------------------------------------------------- |
| `click`       | -17 dB | mouse button down and release                                                    |
| `tick`        | -21 dB | a UI toggle                                                                      |
| `pop`         | -19 dB | an element appearing                                                             |
| `swipe`       | -22 dB | a cut or a card sliding in, moving left to right (0.3 s)                         |
| `whoosh`      | -18 dB | a camera move (0.65 s, loudest half way: cue it 0.33 s before the fastest point) |
| `whoosh-long` | -17 dB | a long camera move (1.3 s)                                                       |
| `impact`      | -9 dB  | the drop: sub hit, noise crack, short room                                       |
| `riser`       | -14 dB | a two-second build (cue it 2 s before the hit)                                   |
| `success`     | -15 dB | a completed action: a rising two-note chime                                      |

Every kind is an ffmpeg lavfi graph, peak-normalised to -1 dBFS; the noise
is seeded, so the sounds are the same every run. `--kinds-dir` also writes
each rendered kind for auditioning; `--raw` writes the placed mix without
the loudness step.

## A music bed from loops

```bash
node --import tsx scripts/audio/loopBed.ts --arrangement <file.json|module.ts> \
  --library <loop folder> --out <bed.wav> [--export arrangement] [--stem <label>] \
  [--report <file.json>]
```

An arrangement is data: `{bpm, lengthBeats?, loudness?, tracks}`, each
track `{file, startBeat, beats, loopBeats, bpm?, stretch?, offsetBeats?,
gainDb?, fadeInBeats?, fadeOutBeats?, highpassHz?, lowpassHz?, sweep?,
stem?}` with `file` relative to `--library` and every time in the
arrangement's beats (`offsetBeats`: how far into the loop the track
starts). It is checked first, naming every problem. A
loop whose `bpm` differs is stretched with ffmpeg's rubberband: `stretch:
'percussive'` keeps drum attacks within about 2 ms of the grid (the default,
`'smooth'`, suits tonal parts and smears transients about 10 ms early).
`sweep: [500, 900, 1600]` steps the lowpass through those cutoffs on equal
slices of the track, the filter running on through the steps. `--stem
drums` renders only the tracks labelled `stem: 'drums'`, with the full
bed's master gain and limiter curve, so it lines up with the bed (a drum
part to transcribe for a highway, say).

AAC loops need macOS: Apple Loops are AAC in CAF, and ffmpeg keeps the
encoder's priming samples when it decodes a CAF, which would put every loop
about 48 ms late and leave a gap at each seam. The tool reads the priming
and valid-frame counts with macOS's `afinfo` and trims to them. Loops in
WAV, AIFF or FLAC have no priming and work anywhere. For a film on a loop
bed, `tempoTimeline` in `src/music/tempo.ts` builds its timeline.

## Loudness of the SFX mix and the bed

Both end in `loudness.ts`, the same master as the soundtrack's: one static
gain for the whole track to the loudness target (the kit's BS.1770-4
meter), and the kit's look-ahead true-peak limiter (`master.ts`, no
latency) only when that gain would push the true peak over the ceiling. So
the music keeps its dynamics: a steady loop comes out as the loop times one
gain. ffmpeg's ebur128 reads the written file back; more than 0.5 LU off
target, or a true peak over the ceiling, exits 1.

## Library modules

| Module                | What                                                                                                                                               |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pcm.ts`              | Decode anything to 48 kHz float stereo (ffmpeg), read and write WAV (24-bit or float, atomic; a NaN or infinite sample is an error, never silence) |
| `dsp.ts`              | FFT, spectral-flux onsets with the detector's own latency measured on synthetic bursts and removed, biquads, BS.1770-4 loudness, 4x true peak      |
| `master.ts`           | The stem sum (as long as the longest stem), the master gain and the true-peak limiter                                                              |
| `edit.ts`             | Splices with attack-aware crossfades, the sample-exact edit render, gain lanes, the reverb ring-out, fades                                         |
| `verify.ts`           | Click checks, drum sync, the edit-lag cross-correlation, ffmpeg's loudness reading                                                                 |
| `chart.ts`            | A chart folder in song time (scan-chart): beats, bars, sections, Expert drums and guitar, syllable timing                                          |
| `timeline.ts`         | The timeline writer: timeline.json, peak and envelope curves                                                                                       |
| `soundtrackConfig.ts` | The config type and its check, the bar-sum check, lanes to breakpoints                                                                             |
| `loudness.ts`         | The SFX mix's and the bed's loudness: the master's gain (and limiter), then the ebur128 read-back                                                  |

Unit tests: `test/audio-*.test.ts` (loudness against the EBU Tech 3341 sine
and gating cases and white noise, the master, the splice model, the config
and bar-sum checks, cues and arrangements). `test/e2e-audio.test.ts` runs
the tools end to end on the synthetic chart: a soundtrack edit that moves
no drum hit by a sample, the highway sync and the sting's events against
its timeline, a loop bed from one steady loop, and an SFX mix over it.
