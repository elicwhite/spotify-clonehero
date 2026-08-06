# 0088 — One scheduled click track

Status: todo

Replace both of this app's rendered click-track implementations (the chart
editor's tempo-map click and `/sheet-music`'s measure-driven click) with a
single Web Audio lookahead scheduler that synthesizes clicks a window at a
time.

**Short verdict: build it, but as infrastructure for the deferred
customisation plan, not as a performance fix.** Both of the performance
problems it was originally proposed to solve turned out to be fixable without
it (§0a, §0b), and **both of those fixes have now shipped**.
What only a scheduler can do is live per-event level, live tone changes and
arbitrary subdivisions, which is exactly what customisation needs. If
customisation is dropped, close this plan (§0d).

---

## 0. Verdict, and the order to do things in

This plan was written, reviewed by a contrarian, and substantially rewritten.
The reviewer's strongest objection destroyed the plan's original justification,
and the justification below is the one that survived. Read §11 for the full
exchange.

### 0a. SHIPPED — the click no longer round-trips through a WAV

The original argument was that regenerating the click WAV on every tempo edit
costs ~11.5 MB of churn and a 1.92M-iteration main-thread loop. That
arithmetic is correct (§1a). It was also ~80% removable inside the mechanism
that already existed, and that is what landed:

1. **The two click samples are memoized.** `generateClickSample`
   (`lib/preview/clickTrack.ts`) holds a module-level `Map` of render
   promises keyed by `(frequency, durationSec, sampleRate, volume)` and hands
   each caller a copy. No `OfflineAudioContext` is constructed after the first
   render of a given sample. Covered by
   `lib/preview/__tests__/clickSampleCache.test.ts`.
2. **The WAV round trip is gone entirely, including at construction.**
   `AudioManager` gained a `TrackPcm` (`{samples, sampleRate}`) type and an
   `AudioSource` union, so a caller can hand it synthesized samples instead of
   encoded bytes both in the constructor's file list and in `replaceTrack`.
   `generateBeatClickTrackSamples` replaced `generateBeatClickTrackWav`, and
   `float32ToWav` was deleted — nothing else used it. `chartPackage.ts` and
   `usePaddedAudio.ts` push `{fileName, pcm}`.

Measured on this machine (Chrome, four-minute song, 8 kHz mono, ~500 beats),
median of 5:

| Step                              | Before                            | After                                  |
| --------------------------------- | --------------------------------- | -------------------------------------- |
| Two `generateClickSample` renders | 0.56 ms                           | 0.015 ms                               |
| `Float32Array` + `mixSamples`     | 0.73 ms                           | 0.65 ms                                |
| `float32ToWav` (main thread)      | 13.9 ms                           | gone                                   |
| `decodeAudioData`                 | 177.8 ms                          | gone (`createBuffer` + `set`, 0.45 ms) |
| **Total per regeneration**        | **192.2 ms**                      | **1.1 ms**                             |
| Allocation                        | 23.0 MB (15.4 MB of it transient) | 15.4 MB (7.7 MB transient)             |

Browser evidence, `/chart-editor` with a real 2:52 chart: undo/redo of a
tempo-map edit produces exactly one 8 kHz mono `createBuffer` of 1,382,400
frames per edit, with **zero** `decodeAudioData` calls, zero worklet loads and
zero new `AudioContext`s. Initial project load likewise creates the click
stem with one `createBuffer`; the only decodes are the real audio.

### 0b. SHIPPED — `/sheet-music` no longer rebuilds its AudioManager for click controls

The AudioManager-construction effect's deps are now
`[audioFiles, measures, chartDelayMs, toAudioPracticeMode]`.

- **`masterClickVolume` and `playClickTrack` were a plain bug**, as the review
  said: both were already applied live and also sat in the rebuild deps, so
  dragging the undebounced Master slider rebuilt the `AudioContext` on every
  pointer move. They now live in `clickMixRef` alongside the existing
  `practiceModeRef` / `tempoRef`.
- **`clickVolumes` is now four buffers in one track.**
  `generateClickVoicePcm` renders one full-song buffer per ACTIVE voice at
  UNIT amplitude; `AudioManager.setBufferGain(trackName, index, gain)` writes
  the level. `trackNameForFile` groups every `click_*` file into the one
  `click` track the same way it already grouped `drums_N`.

**The gain curve.** `setBufferGain` is **linear**, deliberately. It replaces
amplitude `generateClickSample` used to bake in, and baked-in amplitude is
linear; the track `volume` keeps its x-squared curve and multiplies it. So the
node gain is `(volume^2 / 2) * bufferGain`, which is bit-for-bit the loudness a
user with persisted `clickVolumes` heard before. Covered by
`lib/preview/__tests__/audioManager.replaceTrack.test.ts` ("multiplies the
linear buffer gain by the x-squared track volume").

**Zero-gain voices cost nothing.** `activeClickVoices` filters volumes at 0,
so they are never rendered. Turning a voice on re-renders the click and swaps
that ONE track via `replaceTrack`; turning a fader within its audible range is
a pure gain write.

**Memory, measured rather than estimated.** On a 5:03 song the click is
9.70 MB per voice (8 kHz mono Float32). The stock configuration
(whole 1, quarter 0.75, eighth 0.1, triplet 0) is three voices = 29.1 MB,
against 9.70 MB for the single mixed buffer before; all four would be
38.8 MB. That +19.4 MB sits next to 116.5 MB of decoded stem for the same
song (48 kHz stereo), and `measureUserAgentSpecificMemory` reported 163.8 MB
for the tab. The rebuild it replaces re-decoded that entire 116.5 MB on every
debounced fader commit, so this is not close: **accepted as-is, with the
zero-voice filter as the only mitigation.** Rendering fewer voices or
dropping the sample rate would both change what the click sounds like, which
was the acceptance bar.

Measured cost of a fader move, `/sheet-music`, 5:03 song:

| Action                                     | Before                                                                           | After                         |
| ------------------------------------------ | -------------------------------------------------------------------------------- | ----------------------------- |
| Master fader, per pointer move             | full rebuild                                                                     | 4 gain writes, 0.005 ms       |
| Subdivision fader inside its audible range | full rebuild                                                                     | gain writes only              |
| Subdivision fader crossing zero            | full rebuild                                                                     | 57 ms render + `replaceTrack` |
| A rebuild itself (measured directly)       | 28 ms worklet + 393-452 ms decode = 422-482 ms, plus the 192 ms click round trip | n/a                           |

Browser evidence: with `AudioContext`, `decodeAudioData`, `createBuffer` and
`AudioWorklet.addModule` all instrumented, 20 Master steps, 10 quarter steps
and 10 whole-note steps each produced **0** decodes, **0** worklet loads,
**0** new contexts and **0** new buffers, with `window.ctx` unchanged
throughout; toggling the click off and on likewise (click volume went
0.4 -> 0 -> 0.4). Only crossing zero created buffers: 3, then 4, then 3, one
per active voice, still with zero decodes and the same `AudioContext`.

Two side findings the plan noted were left alone: `buildBeatClickEvents` still
diverges from `deriveBeatGrid`, and `tickToMsFromTempos` is still a copy of
`lib/chart-utils/tickToMs`. Neither was in the way.

### 0c. So what actually justifies a scheduler

With 0a and 0b done, essentially one thing does: **customisable click patterns
are a committed follow-on plan**, and a rendered buffer structurally cannot
serve it.

- **Per-event velocity** (accent patterns: beat 1 at 1.0, beat 3 at 0.7) means a
  distinct level per event, not per voice. A rendered buffer can do it by
  baking, which is a re-render per change.
- **Arbitrary subdivisions** multiply the voice count, and the per-buffer-gain
  workaround costs a full-song buffer per voice.
- **Custom tones**, especially sampled ones, mean re-rendering the whole song
  buffer to audition a woodblock.

Every one of those is a `GainNode` write or a different event list under a
scheduler, and a full re-render under any rendered-buffer design. That is the
argument, and it is the only one left standing.

### 0d. The verdict

**Build it, and sequence it as infrastructure for the customisation plan rather
than as an optimization.**

0a and 0b are done (see above). Then build the scheduler, immediately before the customisation plan rather than long
before it, so it is validated by the feature it exists for.

**Kill condition, and it can actually fire:** 0a and 0b have shipped, so if
the customisation plan is dropped or deferred indefinitely, **close this plan
unbuilt**. Nothing measurable is left on the table. That is a coherent outcome and
nobody should be embarrassed by it.

The first draft's kill condition was "under ~5 ms **and** under 1 MB", which
its own arithmetic had already disproved and which therefore could never fire.
That was a rigged gate and the reviewer was right to call it.

### 0e. Where this plan does NOT satisfy the one-implementation directive

Stated plainly because the owner should decide, not discover.

The directive is that there be one click implementation. This plan unifies the
**transport** (one scheduler, one voice/gain model, one set of Web Audio
lifetime rules) and deliberately keeps the two **derivations** separate (§2b),
because sheet-music interpolates beat times linearly inside a VexFlow measure
(`generateClickTrack.ts:55-59,68-71`) while the chart editor evaluates the
tempo map exactly.

So after this plan there are still two answers to "where is beat 3", and they
disagree whenever a tempo change falls mid-measure, which makes sheet-music's
the wrong one. Arguably that is the duplication that actually matters.

The reason not to fix it here: making sheet-music derive from the tempo map is
a **behaviour change to `/sheet-music`'s audio**, not a refactor. It needs its
own justification, its own before/after listening comparison, and its own QA on
charts with mid-measure tempo changes. Bundling it into a transport refactor
would mean any regression is impossible to attribute.

**Recommendation: file it as its own plan, "derive the sheet-music click from
the tempo map", to run after this one.** It is small once `ClickEvent[]` is the
shared seam, and it is what actually discharges the directive.

### 0f. Honest accounting of size

Not "roughly flat", which the original claimed and the reviewer disproved.
Deleted: `replaceTrack` (~32), `generateBeatClickTrackWav` (~34),
`buildBeatClickEvents` (~47), `tickToMsFromTempos` (~17),
`generateClickTrackFromMeasures`'s rendering half (~90), two host call sites
(~20). About **240 lines**. Added: `ClickTrack` (~250), event derivation for
two hosts (~120), `ManagedTrack` + `routeTargetFor` + four `AudioManager`
methods (~70), plus new tests (~250). About **690 lines**, of which a third is
tests.

Against that, §0a/§0b's alternatives total roughly 55 lines and no new
abstractions.

So this is roughly a 3x line-count increase over what it deletes, and the
deleted code is pure synchronous arithmetic while the added code contains a
clock and a node lifecycle. That is the real trade and it should be stated in
those terms rather than hidden.

---

## 1. What exists today

### 1a. The chart editor's click

> Describes the state BEFORE §0a shipped. The WAV encode, the
> `decodeAudioData` and the per-call `OfflineAudioContext` renders in the
> table below are all gone; see §0a for what the same steps cost now.

`components/chart-editor/chartPackage.ts:104-127` and
`components/chart-editor/hooks/usePaddedAudio.ts:263-281` synthesize a
full-song 8 kHz mono WAV and push it into the file list handed to
`new AudioManager`, so the click becomes an ordinary `AudioTrack` keyed
`click`. The per-regeneration cost, verified:

| Step                                               | Cost for a 4-minute song                                             |
| -------------------------------------------------- | -------------------------------------------------------------------- |
| `generateClickSample` x2 (`clickTrack.ts:255-258`) | two `OfflineAudioContext` constructions + renders, **per call**      |
| `new Float32Array(8000 * 240)` (`:252-253`)        | 1.92M floats, 7.68 MB                                                |
| `mixSamples` per beat (`:268-271`)                 | ~500 x 400 samples, negligible                                       |
| `float32ToWav` (`:99-156`)                         | 3.84 MB `ArrayBuffer` + 1.92M `DataView.setInt16` on the main thread |
| `decodeAudioData` (`audioManager.ts:419`)          | off-thread, allocates a 1.92M-frame `AudioBuffer`                    |
| `replaceTrack` node swap (`:412-441`)              | `destroy()` + `new AudioTrack` + `start()`                           |

Hosts that get this click: every `usePaddedAudio` caller, which is
`components/chart-editor/TrackEditPage.tsx:853`,
`app/tempo/TempoClient.tsx:760` and
`app/drum-transcription/components/EditorApp.tsx:501`, plus
`prepareChartPackageAudio`'s callers (the difficulty-generation flow). Four
surfaces, not one; the original plan missed `/tempo` and
`/drum-transcription`.

### 1b. `/sheet-music`'s click

> Describes the state BEFORE §0b shipped: the four volumes are no longer baked
> into the samples, and click controls no longer rebuild the AudioManager.

`app/sheet-music/[slug]/generateClickTrack.ts` (181 lines). Different in every
way that matters:

- **Event model:** typed, not boolean. `ClickEvent.type` is
  `'downbeat' | 'quarter' | 'eighth' | 'triplet'` (`:15-18`).
- **Event source:** interpolation within VexFlow `Measure`s
  (`:41-88`), using `measure.startMs`/`endMs`/`startTick`/`endTick` and each
  beat's `startTick`. Not the tempo map. Eighths are the midpoint between
  consecutive beats; triplets are at 1/3 and 2/3.
- **Per-type volumes:** `ClickVolumes` with `wholeNote`, `quarterNote`,
  `eighthNote`, `tripletNote` (`:20-25`), **baked into the samples** at
  `:120-146`, plus a skip-entirely path when a subdivision volume is exactly 0
  (`:153-159`).
- **Tone options:** `ClickOptions` with `clickDuration`, `strongTone`,
  `subdivisionTone` (`:8-12`), currently a module constant (`:28-32`), never
  passed in.
- Registered as `click.mp3` (WAV bytes under an mp3 name; harmless,
  `decodeAudioData` sniffs) at `SongView.tsx:537-552`, addressed as
  `setVolume('click', ...)` at `:279` and `:626`, and every per-track volume
  loop at `:556-573` explicitly skips any file whose name contains `click`.

The two implementations share `generateClickSample`, `mixSamples` and
`float32ToWav` and nothing else.

Two things that look like bugs here and are not, checked so nobody else has to:

- `:110` adds `chartDelayMs` to the buffer length and `:161` adds it again per
  event. **Not a double application.** `measure.startMs`/`endMs` are chart-time
  (built through `tickToMs` in `convertToVexflow.ts`), so the one shift is
  applied once to the events and once to the buffer that must be that much
  longer to hold them.
- `:114` `totalSamples = sampleRate * totalDurationSeconds` is unrounded, unlike
  `clickTrack.ts:252`'s `Math.max(1, Math.ceil(...))`. `new Float32Array(3.7)`
  truncates rather than throwing, so this is harmless.

One real defect worth carrying forward: `ClickVolume`'s `Slider` uses
`defaultValue={[volume]}` (`SongView.tsx:1494`), so it is uncontrolled and will
not track a value set from anywhere but itself. Not caused by this plan, but it
surfaces the moment `setClickVoiceGain` is driven from a second place.

### 1c. The click is a track, and that is why everything works

From being an `AudioTrack` the click inherits:

| Behaviour                                                         | Where                                    |
| ----------------------------------------------------------------- | ---------------------------------------- |
| Volume via `setVolume`/`getVolume`                                | `audioManager.ts:380-396`                |
| Appears in `trackNames`                                           | `:445`                                   |
| Contributes to `duration` via `Math.max`                          | `:101-104`, recomputed at `:441`         |
| Started/stopped by `play`, `seekTo`, `stop`                       | `:363`, `:595`, `:613`                   |
| Playback rate via `setTempo`                                      | `:277`, `AudioTrack.setTempo`            |
| Routed through or around the SoundTouch worklet                   | `AudioTrack.#routeTarget`                |
| Gates song end (`#handleTrackEnded` needs **every** track ended)  | `:713-731`                               |
| Wrapped by the practice / A-B loop, which re-enters `play()`      | `:751-773`                               |
| Volume carried across a padded-audio rebuild                      | `usePaddedAudio.ts:529-556`              |
| Mixer row: "Click" label, `Timer` icon, solo-exempt, ordered last | `sidebar/StemsMixer.tsx:244-245,333-359` |
| Excluded from the waveform source picker                          | `piano-roll/waveformSources.ts:40-53`    |
| Excluded from the assist audio mixdown                            | `chartPackage.ts:166-175`                |

### 1d. Two beat-grid implementations, and a duplicated tempo conversion

`buildBeatClickEvents` (`clickTrack.ts:186-232`) and `deriveBeatGrid`
(`lib/chart-edit/bar-derivation.ts:114-144`) both answer "where are the beats
and which are downbeats". `bar-derivation.ts`'s own header calls itself "the
single shared implementation" for the highway `GridOverlay`, the piano-roll
timeline and the `DownbeatFlags` store. They diverge in three ways, all in the
click's favour of being wrong:

1. `deriveBeatGrid` runs its input through `normalizeTimeSignatures`
   (`:93-101`), which prepends a 4/4 at tick 0 when the first TS event is
   missing **or late**. `buildBeatClickEvents` handles only the empty case
   (`clickTrack.ts:201-204`), so on a chart whose first TS event sits at
   tick > 0 the bar lines start at 0 and the clicks start later.
2. `deriveBeatGrid` skips regions with `!(ts.numerator > 0)`
   (`bar-derivation.ts:128`). `buildBeatClickEvents` computes
   `beatIndex % sig.numerator` (`clickTrack.ts:224`), which for a zero
   numerator is `NaN`, so `NaN === 0` is false and every beat in that region
   comes out unaccented while the loop keeps emitting.
3. Different termination domains: `tick <= endTick` versus
   `timeMs > durationMs` with a `break outer`.

Divergence 1 is fixed by one line on either path (`normalizeTimeSignatures` at
`clickTrack.ts:201`) and is probably unreachable from charts the editor itself
writes, since `deriveTimeSignatures` is fed by `DownbeatFlags` whose tick-0
entry is guaranteed at `bar-derivation.ts:164-166`. It takes an externally
authored chart to hit. **This is a reason to unify, not evidence of user pain**,
and the original plan oversold it.

Separately: `tickToMsFromTempos` (`clickTrack.ts:159-175`) is a line-for-line
copy of `tickToMs` (`lib/chart-utils/tickToMs.ts:10-27`). That is real
duplication, in the same file, that the original plan wrote a section about
beat-grid duplication without noticing.

### 1e. Export

**The click does not reach any exported package, and after this plan it
becomes structurally impossible for it to.** Verified: `chartPackage.ts:104`
copies `audioFiles` into a local `stems` and pushes `click.wav` into that;
`getAudioSources` (`:252-258`) maps `loadAudioFiles()`, the host's on-disk
files. On the padded path the click goes into `buildPaddedAudioManager`'s local
`audioFiles` (`usePaddedAudio.ts:272`) while export goes through
`padPackageAudio` (`hooks/projectAudio.ts:119-141`) over
`decodeChartPackageAudio`'s output. `lib/chart-export/*` has no click handling
because there is nothing to handle.

The `CLICK_TRACK_NAME` filter in `chartPackageAudioBytes`
(`chartPackage.ts:170`) is therefore defence-in-depth over an input that never
contains a click. Keep it; it documents the invariant and costs one `filter`.

Per the owner's directive the click will never be in an exported package, so
no offline render path is designed here. Nothing in this plan touches or
depends on the export dialog's "include stems" toggle, which is being removed.

---

## 2. The shared design

### 2a. Layering

`lib/preview/clickTrack.ts` today has **zero imports**, deliberately: it is
shared by `/sheet-music` and (by convention) sits below the chart layer. The
original plan proposed adding `lib/chart-edit` and `lib/chart-utils` imports to
it, which the reviewer correctly called a layering violation. Split instead:

```
lib/preview/click/
  synth.ts         generateClickSample, mixSamples, float32ToWav.  Zero imports.
  events.ts        ClickEvent, ClickVoice, ClickVoices.            Zero imports.
  scheduler.ts     ClickTrack.        Web Audio + events + synth.
  fromTempoMap.ts  tempo map + TS -> ClickEvent[].   May import lib/chart-edit,
                                                     lib/chart-utils.
app/sheet-music/[slug]/clickEventsFromMeasures.ts
                   VexFlow Measure[] -> ClickEvent[].  May import VexFlow types.
```

`synth.ts` and `float32ToWav` survive because `/drum-fills`' calibration and
backing-track renders still encode WAVs (§2e), and because `float32ToWav` is
generic PCM encoding that has nothing to do with clicks.

`CLICK_TRACK_NAME` moves to `events.ts` and keeps its value `'click'`, which is
the seam every UI consumer keys off (§4). Per the project's no-re-export rule,
update all importers directly; leave no shim behind `lib/preview/clickTrack.ts`.

### 2b. The shared event model

```ts
/** One click, at an audio-track-relative time (chartDelayMs already applied). */
export interface ClickEvent {
  timeMs: number;
  /** Which registered voice sounds. */
  voice: string;
  /** Per-event level, multiplied into the voice's gain. Defaults to 1.
   *  Present so an accent pattern is a level per beat rather than a voice
   *  per level; see §2c. */
  gain?: number;
}

/** What a voice sounds like. Synthesized from an oscillator, or a supplied
 *  buffer (a woodblock, a rimshot) that the scheduler plays verbatim. */
export type ClickSound =
  | {kind: 'tone'; frequency: number; durationSec: number}
  | {kind: 'buffer'; buffer: AudioBuffer};

/** A voice is a sound plus a live fader. The two are separate because three
 *  of sheet-music's four voices are the SAME sound at different levels
 *  (`generateClickTrack.ts:128-145`: quarter, eighth and triplet all use
 *  `subdivisionTone` at the same duration). Keeping them separate means one
 *  shared `AudioBuffer` for all three rather than three identical ones. */
export interface ClickVoice {
  sound: ClickSound;
  /** LINEAR, 0-1. Not the x-squared curve `AudioTrack.volume` applies. See
   *  §2b's note on the volume law. */
  gain: number;
}

export type ClickVoices = Record<string, ClickVoice>;
```

Voice buffers are memoized by `ClickSound` value, so identical sounds share one
`AudioBuffer`.

What each host supplies:

| Host                                          | Voices                                                                                             | Event source                                                       |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Chart editor (`fromTempoMap.ts`)              | `downbeat` 1000 Hz gain 1.0, `beat` 700 Hz gain 0.6                                                | `deriveBeatGrid` + `tickToMs`                                      |
| `/sheet-music` (`clickEventsFromMeasures.ts`) | `downbeat` `strongTone`, `quarter`/`eighth`/`triplet` `subdivisionTone`, gains from `ClickVolumes` | measure interpolation, verbatim from `generateClickTrack.ts:41-88` |

This is exactly today's behaviour on both hosts, expressed once. The editor's
`{timeMs, accent: boolean}` is the two-voice case of it; sheet-music's
`{timeMs, type}` is the four-voice case.

**Where the seam sits:** at `ClickEvent[]`. The scheduler never learns whether
a tempo map or a VexFlow layout produced the times.

That seam is deliberate and it is also this plan's main compromise. Sheet-music
interpolates beat times _linearly within a measure_ between `startMs` and
`endMs` (`generateClickTrack.ts:55-59,68-71`), which disagrees with evaluating
the tempo map at each beat's tick whenever a tempo change falls inside a
measure. Unifying the derivations would change what `/sheet-music` sounds like,
so **this plan keeps them separate and separately tested, and §0e says plainly
that the directive is therefore only partly discharged.** The follow-up plan
that fixes sheet-music's derivation is the one that finishes the job.

**Per-voice gain replaces baked-in volume.** One `GainNode` per voice, all
feeding the `ClickTrack`'s master gain (which is what `setVolume('click', ...)`
drives, so `masterClickVolume` keeps working unchanged).
`setClickVoiceGain(name, gain)` is a `setValueAtTime` on one node. Sheet-music's
four faders become four `setClickVoiceGain` calls and `clickVolumes` comes out
of the AudioManager construction effect's deps (`SongView.tsx:675-683`), which
is the fader-rebuild fix.

**The volume law must stay linear.** `generateClickSample` bakes `volume` as
the peak of a linear ramp (`clickTrack.ts:64-67`) and sheet-music passes
`clickVolumes.*` straight in, so per-subdivision response is **linear** today.
`AudioTrack.volume` applies `(v * v) / 2` (`audioManager.ts:865-875`). If
`setClickVoiceGain` inherited that curve, every persisted `clickVolumes` value
in `localStorage` (`SongView.tsx:113-135,490-521`) would re-read at a different
loudness. So: **`setClickVoiceGain` is linear**, and the composition stays
`linear_voice x (master^2 / 2)` exactly as today, with the master still going
through `setVolume('click', ...)`.

**Zero-gain voices are not scheduled at all.** Sheet-music today skips a muted
eighth or triplet before it ever reaches the mix
(`generateClickTrack.ts:153-159`), so a muted subdivision costs nothing.
Scheduling a silent node per event would cost a `createBufferSource` + `start()`

- an `ended` listener forever, and sheet-music emits **four events per beat**
  (`:62,76,82,83`), so that is not a rounding error. The scan therefore skips
  events whose effective gain (`voice.gain * (event.gain ?? 1)`) is 0.

That is safe here in a way the first draft's volume-gated stopgap was not:
`setClickVoiceGain` **is** the change signal, so a voice crossing from 0 to
non-zero cancels and rescans the pending window from inside `ClickTrack`. There
is nothing to infer and nothing to poll.

### 2c. Honouring the deferred customisation plan

Customisable click patterns are a separate, later plan and are **not designed
here**. The constraint this plan honours is that the model must not foreclose
them. It does not:

- **Accent patterns** mean a per-beat _level_, not a voice per level. That is
  `ClickEvent.gain`, one optional field that costs nothing now and avoids
  minting a voice per accent strength later.
- **Custom tones** almost certainly means sampled sounds, not just a different
  oscillator frequency. That is `ClickSound`'s `{kind: 'buffer'}` arm. Without
  it the shared type gets rewritten by the very next plan.
- **Per-voice volume** is the thing a rendered buffer structurally cannot do
  live and the scheduler gets for free.
- **Subdivisions and triplets** already exist in the model; sheet-music's four
  voices prove it.

**One overclaim in the first draft is withdrawn.** It said the clicks a user
hears "become the beats they see, by construction, through the same function
that draws them". `deriveBeatGrid` (`bar-derivation.ts:114-144`) is a _beat_
grid: it contains no eighth or triplet positions. The moment the customisation
plan adds subdivisions to the chart editor, `fromTempoMap.ts` must produce
positions the grid does not contain, and the claim in that strong form stops
being true.

The claim in its surviving form: **the beat and downbeat positions come from
`deriveBeatGrid`, so they agree with the bar lines by construction, and
subdivisions are interpolated between adjacent grid beats** exactly as
sheet-music already does (`generateClickTrack.ts:65-84`). The grid stays the
anchor; subdivisions are derived from it rather than beside it. That survives
the customisation plan, and it is what should be written down.

### 2d. The scheduler

Standard Web Audio lookahead scheduling (Chris Wilson, "A Tale of Two Clocks",
web.dev). A coarse timer wakes periodically, reads `AudioContext.currentTime`,
and calls `AudioBufferSourceNode.start(when)` for every click in a short window
ahead of now. The hardware fires each click at its exact sample time, so the
timer's jitter never reaches the sound.

- **Tick interval: 25 ms.** The canonical value.
- **Lookahead: 150 ms of _context_ time**, not audio time. Playback rate scales
  one against the other and `start(when)` takes context time. The canonical
  value is 100 ms; 150 because this app's main thread runs a highway rAF
  render, a piano-roll canvas and occasionally ONNX inference. The only cost of
  a longer window is a slightly longer cancel list on a seek.
- **Voice buffers.** A `{kind: 'tone'}` sound is synthesized once via the
  existing `generateClickSample`, at the context's sample rate; a
  `{kind: 'buffer'}` sound is used as given. Either way one `AudioBuffer` is
  shared across every source node that plays it, memoized by `ClickSound` value
  so sheet-music's three identical subdivision tones do not become three
  buffers (`AudioBuffer` is shareable; only the source node is one-shot).
  **Gain is never baked in** (`generateClickSample`'s `volume` argument is
  passed 1.0), because that is what makes the fader live.

**Sample rate note.** Today's rendered clicks are 8 kHz
(`clickTrack.ts:250`, `generateClickTrack.ts:113`), so a 1000 Hz tone sits at
Fs/8 and a 700 Hz tone is close to the 4 kHz Nyquist limit. Synthesizing at the
context rate (typically 44.1/48 kHz) will sound **cleaner**, not identical. The
original plan promised both "sounds exactly like before" and "synthesized at
the context rate", which the reviewer correctly flagged as contradictory. The
promise is therefore: _timing_ is identical at every playback rate (§7 item 4),
_timbre_ changes slightly and for the better. If anyone objects, synthesize at
8 kHz and resample; do not pretend the choice is free.

**The timer's home.** See §6, which is a real open question and not settled by
handwaving.

### 2e. `/drum-fills` is a third and fourth click, and stays that way

- `lib/drum-fills/practice/backingTrack.ts`'s `renderEvent` has a `'click'`
  voice, baked into an offline render alongside kit voices
  (`lib/drum-fills/practice/backingAudio.ts`): groove bars get kit + click,
  fill bars are silent.
- `lib/drum-fills/practice/clickTrack.ts` renders a fixed calibration click
  (`renderClickTrackWav`, used by
  `app/drum-fills/components/CalibrationDialog.tsx:133-142`).

Neither is a metronome over a song, and neither is a live preview of anything.
The backing track is one rendered artifact that happens to contain a click
among other voices; calibration deliberately needs a fixed file to measure
latency against, and a scheduler would measure the scheduler. **Both stay
rendered.** The "one implementation" directive is about the two live
metronomes; conflating these with them would make the app worse. They may
eventually share `ClickVoice` and `synth.ts`, which is a cleanup, not this
plan.

---

## 3. `ClickTrack` is a real track

**Decision: the click keeps a track identity inside `AudioManager`, and no
mixer or waveform UI learns anything new.**

Extract the contract `AudioTrack` already satisfies:

```ts
interface ManagedTrack {
  readonly duration: number;
  readonly ended: boolean;
  volume: number;
  setTempo(tempo: number): void;
  start(at: number, offset: number): void;
  stop(): void;
  destroy(): void;
  interleavedPcm(): {data: Float32Array; channels: number} | null;
}
```

`AudioTrack implements ManagedTrack` unchanged; `#tracks` becomes
`Record<string, ManagedTrack>`. Every loop in `AudioManager` (`setTempo` at
`:277`, `play` at `:363`, `seekTo` at `:572,595`, `stop` at `:613`, `destroy`
at `:634`, `#handleTrackEnded` at `:713`) then covers the click unmodified, and
`trackNames`, `setVolume`, `getVolume`, the mixer row, the solo exemption, the
waveform filter and the volume carry-over all keep working because they key off
the name `click`, which does not change.

`ClickTrack` implements it honestly rather than by stubbing:

- `start(at, offset)` gives the scheduler exactly what it needs and nothing
  more: the linear map `contextTime(audioSec) = at + (audioSec - offset) / tempo`.
- `stop()` cancels every scheduled-but-unfired source and disarms the timer.
- `setTempo` re-anchors (§5c) and re-routes.
- `volume` is a `GainNode` with the same x-squared curve as `AudioTrack`.
- `interleavedPcm()` returns `null`, already the documented "hasn't decoded
  yet" answer (`audioManager.ts:408-413`) and already filtered out of the only
  consumer (`waveformSources.ts:40`).
- `duration` is assigned, not derived. §3a.
- `destroy()` **terminates its worker**. `AudioManager.destroy()` is
  explicitly idempotent under StrictMode double-mount (`:625-641`); a
  per-instance worker would otherwise be a new leak on exactly that path.

**Why not teach the UI about a non-track audio source.** It would mean a second
volume path in `StemsMixer`'s effect (`:237-241`), a second row source in
`orderedNames`, a second case in `usePaddedAudio`'s carry-over loop
(`:529-556`), and a `soloExempt` concept with no track to exempt. All to
express "this makes sound and has a fader", which is what a track is. The
`ManagedTrack` interface is smaller than the divergence would be.

**Construction.** The click has no file, so it is built separately, opt-in:
`new AudioManager(files, onSongEnded, {clickTrack: true})`. Opt-in because
`AudioManager` has hosts with no click at all (`/preview`, `/chart-review`,
`/tempo-viewer`, `/add-lyrics`, drum-fills calibration) and giving them a
`click` entry in `trackNames` would put a phantom Click row on any mixer they
render and churn ~20 test fixtures for nothing. The flag is passed from exactly
the three places that push `click.wav` today: `prepareChartPackageAudio`
(`chartPackage.ts:120`), `buildPaddedAudioManager` (`usePaddedAudio.ts:274`,
which covers `/chart-editor`, `/tempo` and `/drum-transcription`), and
`SongView.tsx:553`. The host set is therefore unchanged.

New `AudioManager` surface, all thin, all no-ops when there is no click track:

```ts
setClickEvents(events: readonly ClickEvent[]): void
setClickVoices(voices: ClickVoices): void          // registration + full gain set
setClickVoiceGain(voice: string, gain: number): void
setClickDuration(seconds: number): void
```

### 3a. Duration and song end

A rendered click has a length; a scheduler does not. Two consumers care, and
the original plan under-specified both.

`AudioManager.#duration` is `Math.max` over all tracks (`:101-104`). `Infinity`
breaks the transport scrubber; `0` breaks the **silent project** case, where
`usePaddedAudio` builds a manager whose only track is the click, spanning
`silentDurationSeconds`. So `ClickTrack.duration` is assigned via
`setClickDuration`, from the value `buildPaddedAudioManager` already computes
(`usePaddedAudio.ts:264-266`).

Three things this requires that the original plan omitted, all in Phase 2:

1. `#duration` is assigned in only two places today (`:104` and `:441`).
   `setClickDuration` must recompute it, the same `Math.max` over
   `Object.values(this.#tracks)`.
2. `usePaddedAudio` snapshots duration into React state once at build
   (`setDurationSeconds(built.audioManager.duration)`, `:567`). A later
   `setClickDuration` would never reach the transport. Either publish duration
   through `AudioServiceContext` or have `setClickDuration`'s caller also
   update that state. Pick the latter; it is one call site.
3. **The claim that this makes a silent project's `song_length` change free is
   false as originally written.** `silentDurationSeconds` is a field of
   `BuildTarget` and is compared by `targetsEqual` (`:126`), so it triggers a
   full manager rebuild today for reasons unrelated to the click. Making the
   click's duration assignable does not remove that rebuild. Either drop the
   claim, or drop `silentDurationSeconds` from `BuildTarget` and route it
   through `setClickDuration` instead. The latter is correct and small, but it
   is a **separate change with its own risk** and should be its own commit
   inside Phase 2, not smuggled in as a side effect.

`ended`: an `AudioBufferSourceNode` fires `ended`; `ClickTrack` has no single
node to hang that on, so its scheduler sets `#ended = true` when the playhead
passes `duration` and calls the same `onSongEnded` callback `AudioTrack` calls.
`#handleTrackEnded` (`:713-731`) is unchanged and still requires every track to
have ended. On a silent project the click is the **only** track and is
therefore solely responsible for ending the song and for the loop wrap at
`:723-727`. That case gets its own test.

---

## 4. What breaks when the click stops being a rendered buffer

Exhaustive. Most rows are "nothing", which is the point of §3, but each was
checked rather than assumed.

| Consumer                                                                                           | Impact                                                                                                                                                                                                                                              |
| -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `StemsMixer` Click row, label, `Timer` icon, separator, ordering (`:244-245,333-359`)              | **None.** Keyed on `name === CLICK_TRACK_NAME` against `trackNames`.                                                                                                                                                                                |
| The Click slider -> `setVolume` (`:237-241`)                                                       | **None.** `ClickTrack.volume` is a `GainNode`.                                                                                                                                                                                                      |
| `mixerBus.soloExempt` / `defaultVolumeFor` / `defaultMuteFor` / `resolveMixer`                     | **None.** Pure, name-keyed.                                                                                                                                                                                                                         |
| Mute/solo against other stems                                                                      | **None.** `resolveMixer` resolves to a number per name; the click is exempt from other stems' solo and has none of its own.                                                                                                                         |
| `trackNames` consumers (`StemsMixer`, `PianoRollTimeline:590`, `usePaddedAudio:530,553`)           | **None.** All name-keyed.                                                                                                                                                                                                                           |
| `waveformSources.isClickTrack`                                                                     | **Still required and still correct.** The click is still in `trackNames`; `getTrackPcm('click')` now returns `null`, a case the filter means it never reaches.                                                                                      |
| `duration`                                                                                         | **Changed.** §3a, with three sub-changes.                                                                                                                                                                                                           |
| `#handleTrackEnded`                                                                                | **Changed.** `ClickTrack` reports `ended` from the scheduler. Needs the silent-project test.                                                                                                                                                        |
| `AudioManager.replaceTrack`                                                                        | **Deleted.** Only production caller is the click sync (`usePaddedAudio.ts:650`).                                                                                                                                                                    |
| `lib/preview/__tests__/audioManager.replaceTrack.test.ts`                                          | **Deleted** with it, plus the `replaceTrack` assertions and fake in `usePaddedAudio.test.tsx`.                                                                                                                                                      |
| `AudioServiceContext` (`publishAudioManager` / `audioManagerRef`, `usePaddedAudio.ts:358-362,563`) | The channel every other consumer reads the manager through. A new constructor option and four new methods widen what that ref guarantees; the type is `AudioManager` either way, so nothing breaks, but §3a item 2 may add a duration publish here. |
| `chartPackageAudioBytes`'s `CLICK_TRACK_NAME` filter                                               | Already defensive over a click-free input. Kept.                                                                                                                                                                                                    |
| Export (`getAudioSources`, `padPackageAudio`, `lib/chart-export/*`)                                | **None.** The click never reached it and now has no bytes to reach it with.                                                                                                                                                                         |
| `/sheet-music` `SongView.tsx:279,556-573,626,675-683`                                              | **Changed by design.** The `click.mp3` push goes away; `setVolume('click', ...)` for the master stays; `clickVolumes` leaves the construction effect's deps. The `:556-573` name-skip stays correct.                                                |
| `/tempo`, `/drum-transcription`                                                                    | Get the click through `buildPaddedAudioManager`, unchanged behaviour, but they are in the blast radius and their tests mock `generateBeatClickTrackWav`.                                                                                            |
| Seven test files mocking `lib/preview/clickTrack`                                                  | Mechanical update; the module moves and `generateBeatClickTrackWav` disappears. §9.                                                                                                                                                                 |

**Nothing in this app assumes "every audible thing is a track" in a way the
click breaks**, because after this change the click is still a track.

---

## 5. The hard cases

Every one reduces to: _the map from context time to audio position changed, so
cancel the pending window and rescan._ The cancel list is at most a few nodes,
so that is affordable as the universal answer.

**Cancelling** means, per source that was started and has not fired `ended`:
`source.stop()` then `disconnect()`. `stop()` on a scheduled-but-unstarted
source cancels it; `stop()` on a node that never had `start()` throws, which
cannot happen because every source is started at creation. Sources leave the
pending list on their own `ended`.

**(a) Seek mid-playback.** `seekTo` -> `play({time})` -> `stop()` then
`start(at, offset)` on every track (`:341-365`). No special case.

**(b) Play from an arbitrary position.** Same path; binary search the event
array for the first `timeMs / 1000 >= offset`.

**(c) Playback rate other than 1.0.** The anchor `(at, offset)` plus `tempo` is
the whole map. On `setTempo(t2)`: compute the current audio position under the
old tempo, re-anchor to `(context.currentTime, thatPosition)`, set the new
tempo, re-route the gain, cancel and rescan. `AudioManager.setTempo` already
calls `track.setTempo` on every track (`:277-279`).

Note a real hazard the reviewer found: `AudioManager.setTempo` updates its own
`#effectivePlayTime` bookkeeping only when `#isInitialized && #startedAt >= 0`
(`:237`), while `ClickTrack` would re-anchor unconditionally. Make
`ClickTrack.setTempo` re-anchor only when it has been `start`ed, mirroring that
condition, or the two models silently diverge after a `setTempo` while stopped.
This is a two-line guard and a test.

**(d) A/B loop and practice-mode wrap.** `updateLoop()` calls `this.play({time})`
(`:771`), which is case (a). Both loop kinds compile to that one path by design
(`:22-32`), so there is one place to be correct.

**(e) A tempo edit while playing.** `setClickEvents` swaps the array, cancels
the pending window, rescans. The next click is on the new map within 150 ms. No
node swap, no decode, no `await`. `clickTrackSignature` upstream keeps a plain
note edit from triggering any of it.

**(f) Pause with events already scheduled.** `pause()` is `context.suspend()`
(`:313-318`), which freezes `currentTime`; the existing `#rawCurrentTime`
(`:428-441`) already depends on that. Sources scheduled at absolute context
times stay valid and fire at the same offsets on `resume()`. **Nothing needs
cancelling, and cancelling would be wrong** (it would silence the first 150 ms
after every resume).

**(g) The first click after `play()`.** `play()` calls
`track.start(currentTime, offset)` while the context may still be suspended,
then awaits `resume()`. So `ClickTrack.start()` schedules its first window
**synchronously**, and the scan treats an event whose context time is less than
30 ms in the past as `start(0)` (fire now) and drops it otherwise. 30 ms
because it is above the 25 ms tick and below the ~50 ms at which a metronome
flam is heard as a separate hit.

**(h) Very fast tempos, and sheet-music's four-events-per-beat rate.** The
chart editor emits one event per beat, so 300 BPM is 200 ms apart against a
50 ms sample: no overlap even at 600 BPM, and at 4x playback that is 25 ms
apart in context time, at most 6 pending nodes.

`/sheet-music` is four times denser: beat + eighth + two triplets
(`generateClickTrack.ts:62,76,82,83`). At 200 BPM that is ~13 events per second
of audio time, and at 4x playback ~53 per second of context time, so a 150 ms
window holds about **8 nodes**. Still trivial. The worst realistic case,
300 BPM at 4x, is ~12. There is no tempo at which this design runs out of
window, but the first draft's "at most 6" was computed for the editor alone and
is corrected here.

Muted subdivisions cost nothing, because zero-gain events are never scheduled
(§2b).

**(i) Very long songs.** The event array is O(beats). A 20-minute 200 BPM song
is 4000 entries, ~64 KB; sheet-music's four-voice model is ~4x that, ~256 KB.
Compare ~7.7 MB for one rendered click buffer today, or ~31 MB for the
four-buffer alternative in §0b. The per-tick work is a binary search plus the
handful of events in the window, independent of song length.

---

## 6. The timer, honestly

The original plan asserted a worker timer was needed because hidden tabs clamp
`setInterval` to 1 Hz. The reviewer pushed back on three grounds and two of
them land:

1. **Chrome applies a hidden page's throttling policy to its dedicated workers
   too.** So a worker is not automatically an escape hatch, and the original
   plan asserted rather than established that it was.
2. **A hidden tab is already broken here for other reasons.** The smoothing
   loop is `requestAnimationFrame`-driven (`:489,492`), which does not fire in
   a hidden tab, so `updateLoop()` never runs (`:462`) and **A/B loops and
   practice mode already never wrap in a background tab**, and `currentTime`
   returns a frozen `#smoothedTime` (`:510-515`). Asking the click to hold time
   in a tab where the playhead and the loop engine are dead is asking for
   parity with nothing.
3. It is a regression tax: today's rendered click plays fine in a hidden tab,
   and the scheduler breaks that, so any timer work is buying back capability
   the plan itself removed, not adding any.

**Decision: ship the main-thread `setInterval` first, and treat the hidden-tab
case as a known, documented regression rather than something to pre-engineer
around.** Add QA item 13 (§7) to characterise it. If it turns out to gap
audibly, the fix is a worker _and_ it should be evaluated together with the
already-broken rAF-driven loop wrap, because fixing one without the other
produces a background tab where the metronome is right and the playhead is not.
That belongs in whatever plan owns background-tab playback, not this one.

The `ClickTrack` takes its tick source as a constructor parameter
(`(cb) => () => void`, returning a disposer), so swapping in a worker later is
a one-line change at the construction site and the scheduler's tests can drive
it with a fake clock. That is the extensibility that is actually worth paying
for; the worker itself is not, yet.

**Where the tick is armed and disarmed** is a real bug the original plan walked
into. It proposed hanging it off `#startSmoothingLoop`/`#stopSmoothingLoop`,
which does not work:

- `#startSmoothingLoop` early-returns when already running (`:448`), so a
  `ClickTrack` re-armed while the rAF loop is alive would never start its
  timer.
- The rAF `tick` self-terminates without calling `#stopSmoothingLoop` (`:451-456`
  sets `#smoothingRafId = 0` and returns), so any path that stops playback
  through that branch would leave the timer running forever.
- `seekTo` while paused calls `track.start(realTime, timeSec)` (`:595-597`) and
  _then_ `#stopSmoothingLoop()` (`:602`), so the first window would be
  scheduled and immediately disarmed.

So: **arm and disarm inside `ClickTrack` itself**, driven by its own
`start`/`stop` plus a `context.onstatechange` listener for suspend/resume, not
by `AudioManager`'s rAF lifecycle. The click's timer has nothing to do with the
playhead-smoothing loop and coupling them was a mistake.

---

## 7. Browser QA matrix

Per CLAUDE.md, chrome-devtools MCP. Chart editor with
`public/All Time Low - SUCKERPUNCH (Hubbubble).sng`; raise the Click fader
first. Sheet-music separately.

**Chart editor**

1. Play from 0. Clicks land on the highway's bar and beat lines.
2. Seek mid-playback, rapidly and repeatedly. No doubled clicks, no gap longer
   than a beat, nothing surviving from before the seek.
3. Play from an arbitrary mid-bar position. First click is the next beat, not a
   flam.
4. Playback rate 0.25, 0.5, 2.0, 4.0. **The click stays locked to the music at
   every rate.** This is what §8's routing exists for; a ~110 ms offset means
   the routing is wrong.
5. Change rate while playing, both directions. At most one click at the old
   spacing. Also change rate while **stopped**, then play (the `:237` guard,
   §5c).
6. A/B loop over four bars, twenty wraps. No drift, no doubled click at the
   wrap.
7. Practice mode over a section. Same.
8. Drag a tempo marker while playing. Click follows within a beat; playback
   does not stutter; playhead does not move.
9. Tap tempo (plan 0083) committing repeatedly while playing. Worst case for
   `setClickEvents` churn.
10. Insert a short bar with the downbeat tool. The accent moves with the bar
    line.
11. A 6/8 or 7/8 section. Beat unit and accent pattern match the grid.
12. Pause 30 s, resume. In phase, no burst of backlogged clicks.
13. Hidden tab for a minute while playing, then return. **Characterise, do not
    assert.** Record whether the click gaps and whether the playhead and A/B
    loop were already broken independently (§6).
14. Silent project (no audio). Transport runs, click audible by default
    (`defaultVolumeFor` gives 70), song ends at `song_length`.
15. `/tempo` and `/drum-transcription` both still play and still click.
16. Export a package; no click file (regression on §1e).

**Sheet-music**

17. Play with the click on. Clicks land on the notation's beats, including
    through a tempo change inside a measure (this is where the interpolation
    differs from the tempo map, §2b: it must still sound like it does today).
18. Move each of the four subdivision faders **while playing**. Volume changes
    instantly, playback is not interrupted, and no `AudioManager` is
    constructed (assert via a console counter or a devtools breakpoint on the
    construction effect).
19. Drop a subdivision fader to exactly 0 and back up. Silent then audible, no
    rebuild.
20. Master click toggle and master volume.
21. Reload: `persistedSettings.clickVolumes` restores and the restored gains
    are applied without a rebuild. **Compare loudness at each fader position
    against a pre-change build**: the gain law must stay linear (§2b), or every
    existing user's saved click balance shifts.
22. Drag the Master click slider (`:271-276`, undebounced) and toggle the click
    on/off. No `AudioManager` construction on either (§0b's ref fix), volume
    still applies live.
23. `list_console_messages` clean throughout, both hosts.

Sheet-music's click **defaults to on at 0.7 master** (`SongView.tsx:122-128`),
unlike the chart editor's `defaultVolumeFor` of 0. So sheet-music is where an
audible click is the common case, which means any regression in timbre, taper
or the zero case is immediately user-facing rather than latent. Weight items
17-22 accordingly.

---

## 8. Routing and the SoundTouch worklet

The subtlest part, and the one where the original plan reached the right
conclusion by the wrong reasoning.

At tempo 1.0 `AudioTrack` connects its gain straight to `destination`; off 1.0
it goes through the SoundTouch worklet for pitch correction, which carries
roughly 110 ms of latency (`:813-823`). That latency applies to every music
track equally. **A `ClickTrack` wired straight to `destination` at tempo 0.5
would therefore play ~110 ms ahead of the music**, which for a metronome is not
a subtlety, it is the feature broken.

So the `ClickTrack`'s gain connects to whatever `AudioTrack.#routeTarget()`
picks, re-routing on `setTempo`. Extract that rule into one free function
`routeTargetFor(ctx, worklet, tempo)` used by both, per CLAUDE.md's
no-duplication rule.

**And each source gets `playbackRate = tempo`, but not for the reason the
original plan gave.** For a _rendered_ click, `playbackRate` is what makes the
click spacing follow tempo, because the buffer encodes absolute audio-time
positions. For a _scheduler_, spacing already comes from `start(when)`; the
scheduler has divided tempo out. So `playbackRate = tempo` on a one-shot 50 ms
sample changes **nothing but timbre**, and it is correct here only because the
worklet (`public/soundtouch-worklet.js`, `rate = 1/tempo`, `tempo = tempo`)
undoes exactly that shift, and the worklet is only in the path when
`tempo !== 1.0`.

Write that reasoning into the code as a comment, because the next person to
"simplify" the routing will otherwise silently pitch-shift the metronome, and
QA item 4 is a human ear rather than an assertion. Concretely:

```
tempo === 1.0  -> direct to destination, playbackRate 1.0
tempo !== 1.0  -> through the worklet, playbackRate = tempo, which the
                  worklet's rate = 1/tempo cancels
```

`#clearWorklet()` (called on every tempo change and every seek off 1.0) drops
whatever click audio was in the worklet's FIFO. Correct, and already what
happens to music.

---

## 9. Phases

Each phase is independently green and independently landable.

**Phase 0 — Not this plan.** The two small fixes in §0a land on the tactical
path first. Then take a `performance_start_trace` over a committed tempo edit
with the click audible and record what is left. If §0c's kill condition is
met, stop here.

**Phase 1 — The shared pieces, unwired.**

- Create `lib/preview/click/{synth,events,scheduler,fromTempoMap}.ts` per §2a.
  Move `generateClickSample`/`mixSamples`/`float32ToWav` verbatim; update the
  three importers directly (chart-editor hosts, sheet-music, drum-fills), no
  re-export shim.
- `fromTempoMap.ts` derives from `deriveBeatGrid` + `tickToMs`, deleting
  `buildBeatClickEvents` and `tickToMsFromTempos` (§1d). It takes `durationMs`
  as today and converts to an `endTick` itself; **do not** reach for
  `audioExtendedEndTick`, whose only caller (`PianoRollTimeline.tsx:751-766`)
  has to compute `maxAnchorTick` from two reduces and `durationTick` from
  `msToTick` over a `timedTempos` list, none of which exists in
  `buildPaddedAudioManager`. A forward walk to the first tick past `durationMs`
  is smaller and local. Note `tickToMs` is typed `(chart: ParsedChart, ...)`,
  so either widen it structurally or keep a local conversion; do not cast.
- `ClickTrack` in `scheduler.ts`, taking its tick source as a parameter (§6).
- Jest: event derivation across tempo changes, meter changes, x/8 meters, a
  3-beat bar from the downbeat tool, a chart whose first TS event is late
  (regression on §1d divergence 1), a zero numerator (divergence 2). Scheduler
  window selection against a fake clock: given an anchor, tempo and window,
  which events are selected and at what context times; the 30 ms late boundary;
  the `setTempo`-while-stopped guard (§5c).
- Nothing imports `scheduler.ts` yet. Green.

**Phase 2 — Wire the chart editor.**

- `ManagedTrack`; `#tracks` retyped; `AudioTrack implements`; `routeTargetFor`
  extracted (§8).
- `AudioManager` gains `{clickTrack: true}` and the four methods; `#duration`
  recomputation in `setClickDuration` (§3a item 1).
- `chartPackage.ts` and `usePaddedAudio.ts` stop pushing `click.wav`, pass the
  flag plus events plus voices. The click-sync effect body
  (`usePaddedAudio.ts:626-657`) becomes a synchronous `setClickEvents`, keeping
  `clickTrackSignature` as its guard.
- `setDurationSeconds` reachability (§3a item 2).
- Delete `replaceTrack` and its test file; update `usePaddedAudio.test.tsx`.
- Green, UI byte-identical, `/tempo` and `/drum-transcription` unchanged.

**Phase 2b — Separate commit.** `silentDurationSeconds` out of `BuildTarget`
and through `setClickDuration` (§3a item 3). Independently revertible.

**Phase 3 — Wire `/sheet-music`.** Only after Phase 2 has shipped and been
used; the whole point of the order is that the second consumer does not go on
unproven infrastructure.

- `clickEventsFromMeasures.ts`: the derivation half of
  `generateClickTrack.ts:41-88`, verbatim, emitting `ClickEvent[]` with the
  four voice names. Behaviour-preserving: it must produce the same times it
  produces today, including the mid-measure interpolation (§0e).
- `SongView.tsx`: `{clickTrack: true}`, `setClickVoices` from `ClickVolumes`
  (linear gains, §2b), `setClickVoiceGain` on each fader, `clickVolumes` **out**
  of the construction effect's deps (`:675-683`), `setClickEvents` when
  `measures` changes. `measures` is `useMemo`'d on `[chart, track]`
  (`:472-474`) with `track` itself memoized on
  `[chart, selectedDifficulty, instrument]` (`:461-470`), so this fires far
  less often than the chart editor's tempo-edit path. Delete
  `generateClickTrackFromMeasures`'s rendering half and the `click.mp3` push.
- QA items 17-22.

**Phase 4 — Delete `lib/preview/clickTrack.ts`.** By this point it is empty.

**Not a phase, but the follow-up that actually discharges the directive:** a
separate plan to derive the sheet-music click from the tempo map rather than by
measure interpolation (§0e). Small once `ClickEvent[]` is the seam; a
behaviour change, so it needs its own QA.

---

## 10. Out of scope

- **Customisable click patterns** (subdivisions, accent patterns, tones,
  per-voice UI in the chart editor). Deferred to its own plan, to be written
  and contrarian-reviewed after this lands. This plan's only obligation is not
  to foreclose it, discharged in §2c. The reason to defer is that the option
  surface is a product decision with its own UI, and designing it against
  unproven scheduler infrastructure would mean revising it twice.
- **Any export of the click.** Settled by the owner: the click is a preview aid
  and will never be in a chart package. No `OfflineAudioContext` render path is
  designed. Nothing here depends on the export dialog's "include stems" toggle,
  which is being removed.
- **`/drum-fills`' backing-track click and calibration click** (§2e). Both are
  rendered artifacts by design.
- **Unifying the two event _derivations_.** Sheet-music interpolates within a
  measure; the editor evaluates the tempo map, and the two disagree on any
  chart with a mid-measure tempo change. Forcing them together is a behaviour
  change to `/sheet-music`'s audio, not a refactor, so it needs its own
  before/after comparison and its own QA. **Filed as the immediate follow-up
  plan; see §0e, which states that this plan therefore discharges the
  one-implementation directive only in part.**
- **`AudioManager`'s existing rebuild-per-fader deps on `/sheet-music`
  (§0b).** The `masterClickVolume` / `playClickTrack` ref fix is a plain bug
  fix that should land now, independently, and does not wait on this plan.
- **Count-in before playback.** Adjacent and nearly free once the scheduler
  exists, but it is a product decision with its own UI.
- **Background-tab playback.** The rAF-driven loop wrap is already broken there
  (§6) and fixing the click alone would produce a tab where the metronome is
  right and the playhead is not.
- **The multi-second frame on `AudioManager` swap.** This plan removes the
  click's share of it (a render, an encode, a decode) and nothing else; the
  remainder is the pad/encode/decode of song audio. Do not credit this plan
  with it.
- **Latency calibration between the click and the user's ears.**

---

## 11. Objections considered

A contrarian reviewed the first draft with instructions to disprove whatever it
could by reading the code. Its findings, and what happened to each.

**Accepted, plan changed:**

1. _"The Phase 0 exit condition can never fire."_ Correct and damning: it was
   an AND of two clauses, one of which the plan's own arithmetic had already
   disproved. **Rewritten as §0c with a condition that can fire.**
2. _"Two ~10-line fixes remove most of the measured cost: memoize the click
   samples, and give `replaceTrack` an `AudioBuffer` path instead of the WAV
   round trip."_ Correct, and it destroys the original justification.
   **Promoted to §0a as work that happens first and is not part of this plan,
   and the verdict rebuilt on other grounds.**
3. _"`setClickDuration` does not deliver the claimed benefit"_ without
   recomputing `#duration`, reaching `setDurationSeconds` at
   `usePaddedAudio.ts:567`, and dealing with `silentDurationSeconds` being in
   `targetsEqual`. All three verified. **§3a now lists all three, and the third
   became its own phase.**
4. _"§2b is wrong: there is a second divergence."_ Verified:
   `beatIndex % 0` is `NaN` at `clickTrack.ts:224` where `deriveBeatGrid`
   guards at `bar-derivation.ts:128`. Also correct that the cited divergence is
   a one-line fix on either path and probably unreachable from editor-authored
   charts. **§1d now lists three divergences and explicitly downgrades the bug
   from evidence of pain to a reason to unify.**
5. _"`tickToMsFromTempos` is a line-for-line copy of `tickToMs`, and the plan
   wrote a section on duplication without noticing."_ Verified and
   embarrassing. **Added to §1d and to Phase 1's deletions.**
6. _"`deriveClickEvents` is not a drop-in: `audioExtendedEndTick` needs
   `msToTick` and two reduces that do not exist at the call site, and adding
   `lib/chart-edit` imports to `lib/preview/clickTrack.ts` violates its
   zero-import layering."_ Both verified against
   `PianoRollTimeline.tsx:751-766`. **§2a splits the module so the chart-aware
   derivation lives in its own file, and Phase 1 explicitly rejects
   `audioExtendedEndTick`.**
7. _"The scheduler wiring points at the wrong call sites"_: `#startSmoothingLoop`'s
   early return at `:448`, the rAF self-terminate at `:451-456`, and `seekTo`'s
   `start`-then-`stopSmoothingLoop` ordering at `:595-602`. All three verified.
   **§6 now arms the timer inside `ClickTrack` and says why coupling it to the
   smoothing loop was a mistake.**
8. _"The proposed volume-gated stopgap is not five lines"_: the click-sync
   effect's deps are `[chartDoc, audioManager]` and volume is pushed from
   `StemsMixer.tsx:237-241` with no signal back, so there is no 0-to-nonzero
   transition to observe. Verified. **The stopgap was dropped entirely; §0a's
   two fixes are unconditional and need no volume signal.**
9. _"The worker is a regression tax, Chrome throttles worker timers too, and a
   hidden tab is already broken because the rAF-driven `updateLoop` never
   runs."_ The last point is verified at `:462,489`. **§6 reverses the
   decision: main-thread timer first, hidden tab documented as a known
   regression, tick source injectable so a worker is a one-line change if QA
   says it is needed.**
10. _"§3e states the right conclusion from the wrong reason"_: `playbackRate =
tempo` does not set click spacing for a scheduler and is correct only
    because the worklet cancels it. Verified. **§8 rewritten with the correct
    reasoning and an instruction to put it in the code, because the wrong
    reason is a trap for the next refactor.**
11. _"The sample-rate change contradicts 'sounds exactly like before'."_
    Correct. **§2d now states the promise as timing-identical,
    timbre-slightly-different, and offers the 8 kHz fallback rather than
    pretending the choice is free.**
12. _"`/tempo` and `/drum-transcription` are click hosts and the survey omits
    them."_ Verified: both call `usePaddedAudio`
    (`TempoClient.tsx:760`, `EditorApp.tsx:501`), which pushes `click.wav`
    unconditionally at `:272`. **Added to §1a, §3, §4 and QA item 15.**
13. _"`audioManager.replaceTrack.test.ts`, `AudioServiceContext` and worker
    teardown are missing."_ All verified. **Added to §3, §4 and §9.**
14. _"'Net line count roughly flat' is false by ~3x."_ Correct. **§0d now gives
    the real numbers and says the added code is the harder kind.**

**Disagreed, with reasons:**

15. _"A second playhead implementation contradicts the plan's own
    de-duplication argument."_ Partly. `ClickTrack` does maintain
    `(anchor, offset, tempo)`, which `AudioManager` also maintains at
    `:246-249`. But the alternative is for `ClickTrack` to read
    `AudioManager`'s privates, which makes it untestable without a whole
    `AudioManager` and couples the scheduler to the manager's bookkeeping. The
    map is three fields and one multiplication; `AudioTrack` effectively holds
    the same state today in its source nodes' `start(at, offset)` arguments and
    nobody calls that a second playhead. **The real risk the objection
    identifies is the `#isInitialized` guard at `:237` making the two models
    conditionally divergent, and that is accepted and handled in §5c.**
16. _"The worker is cargo cult."_ Accepted as to the worker, rejected as to the
    parameterised tick source. Making the tick injectable is what lets the
    scheduler be tested against a fake clock, which is the only way any of §5
    gets a unit test at all. That is worth a constructor parameter regardless
    of what drives it in production.
17. _"Adding a second caller to unproven infrastructure while the first
    caller's benefit is obtainable with two small edits is the wrong order of
    operations."_ Answered by sequencing rather than dismissed: §0a's fixes
    land first and independently, the scheduler lands on the chart editor in
    Phase 2 and proves itself there, and `/sheet-music` follows in Phase 3 only
    after that. If Phase 2 goes badly, Phase 3 never starts and nothing is lost
    beyond Phase 1's isolated modules. **The objection changed the phase order;
    it did not change the destination.**

### Round two, after the scope change

The reviewer was re-briefed on the shared-infrastructure directive and the
deferred customisation plan, and asked to attack the new shape.

**Accepted, plan changed:**

18. _"`AudioTrack` already has one `GainNode` per buffer
    (`audioManager.ts:801-804`, `:919`); a small `setBufferGain` plus the ref
    fix delivers the entire sheet-music payoff with no new infrastructure. The
    plan must beat this, not the status quo."_ Verified. This is the round's
    strongest hit and it removes sheet-music's fader rebuild from the
    justification. **§0b now presents this alternative fairly, including its
    ~31 MB memory cost, and §0c/§0d rebuild the verdict on the customisation
    plan alone.**
19. _"Two of the three churning deps are already-fixed-elsewhere bugs":_
    `masterClickVolume` (undebounced) and `playClickTrack` are applied live at
    `SongView.tsx:271-283` **and** sit in the rebuild deps, while
    `practiceModeRef`/`tempoRef` at `:483-489` is the ref pattern that fixes
    them, already in the file. Verified. **Promoted to §0b as work to do now,
    independently, and to QA item 22.**
20. _"The volume law silently changes"_: `generateClickSample` bakes a linear
    peak (`clickTrack.ts:64-67`) while `AudioTrack.volume` applies
    `(v * v) / 2` (`:865-875`), so every persisted `clickVolumes` would re-read
    at a different loudness. Verified. **§2b now specifies `setClickVoiceGain`
    as linear and QA item 21 checks it against a pre-change build.**
21. _"The `=== 0` skip is not reproducible by a gain of 0, and sheet-music
    emits four events per beat, so the node arithmetic is wrong."_ Both
    verified. **§2b skips zero-gain events entirely; §5h is recomputed for the
    four-voice case (~8 nodes, worst realistic ~12).** The reviewer's follow-on
    worry that this reintroduces a "did the gain cross zero" invalidation
    problem does not apply: `setClickVoiceGain` **is** the signal, called
    directly, unlike the abandoned volume-gated stopgap which had nothing to
    observe.
22. _"The voice model forecloses velocity and sampled tones."_ Correct on both.
    **`ClickEvent.gain` and `ClickSound`'s buffer arm added in §2b**, one
    optional field and one union member, which is much cheaper now than
    rewriting the shared type in the next plan.
23. _"`deriveBeatGrid` is a beat grid with no subdivision positions, so the
    'clicks are the beats you see, by construction' claim dies the moment
    subdivisions arrive."_ Correct. **§2c withdraws the strong form and states
    the surviving one: beats and downbeats come from the grid, subdivisions are
    interpolated between adjacent grid beats.**
24. _"Three of the four sheet-music voices are byte-identical buffers,
    evidence the model conflates timbre with fader."_ Verified
    (`generateClickTrack.ts:128-145`: quarter, eighth and triplet all use
    `subdivisionTone` at the same duration). **`ClickVoice` split into
    `{sound, gain}` with buffers memoized by sound identity.**
25. _"`ClickVolume`'s `Slider` is uncontrolled (`SongView.tsx:1494`)."_
    Verified. Not caused by this plan; **noted in §1b** because it surfaces if
    a gain is ever set from a second place.
26. _"The `measures` churn hypothesis is refuted: it is `useMemo`'d on
    `[chart, track]`."_ Verified, and it is good news. **Recorded in Phase 3.**
27. _"The worker gets a second host where the loop it protects is already
    dead."_ Sheet-music's practice loop runs through the same
    `setPracticeMode` -> `#activeLoop` -> `updateLoop` path, which is
    rAF-driven. **Reinforces §6's decision not to ship a worker; no change
    needed.**

**Disagreed, with reasons:**

28. _"'One implementation' is not achieved, because two inconsistent beat-time
    derivations survive and are now coupled."_ The factual half is right and
    important enough that it is **now stated up front in §0e rather than buried
    in an out-of-scope bullet**. The disagreement is only about what to do:
    unifying the derivations changes what `/sheet-music` sounds like on any
    chart with a mid-measure tempo change, so it needs its own before/after
    comparison and its own QA. Bundling it into a transport refactor makes any
    regression impossible to attribute. **It is filed as the immediate
    follow-up plan, and §0e tells the owner plainly that this plan only
    partially discharges the directive** rather than claiming otherwise.
29. _"drum-fills' two clicks should be checked against the one-implementation
    directive."_ The reviewer checked and agreed they are legitimately
    different: the backing track's click is one voice of a synthesized kit
    pattern rendered into a single artifact, and calibration needs a fixed file
    precisely because it is measuring the latency a scheduler would introduce.
    A scheduler cannot be its own calibration reference. **§2e unchanged.**

**Checked and confirmed as fact, used above:** the `chartDelayMs` at
`generateClickTrack.ts:110` and `:161` is a single shift applied to two
quantities, not a double application; the unrounded `totalSamples` at `:114`
truncates rather than throwing and is harmless.
