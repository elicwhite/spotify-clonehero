# 0124 — Own the opening: song start, lead-in bars, editable tick 0

Status: in-progress

Revision 9. Eight contrarian review passes came before it. Revisions 1 to 6
answered each finding with a new rule, and the document reached 810 lines of
rules that disagreed with each other. Revision 7 removed machinery instead,
and removed too much: it deleted the parts that produced the opening tempo
and meter, but a hard default needs a writer. Revision 8 supplied the writer but
replaced the deleted record with two guesses about what a chart means, and
both guesses corrupt real charts. Revision 9 replaces the guesses with a
recorded fact. What is left is two persisted numbers, one recorded opening,
and one recomputed pad.

Every figure in this document was computed, not written by hand. An earlier
revision "corrected" 164 ms to 166 ms by trusting a review comment; 164 ms
was right, and 166 ms is the answer at a BPM this song does not have.

## The problem

**Tick 0 cannot be edited.** `hitTsChip` skips the tick-0 chip, the marquee
and `deleteSelection` filter `tick !== 0`, and below them sit four hard
guards: `removeTimeSignature` and `removeTempo` throw at tick 0
(`lib/chart-edit/helpers/tempo.ts:43`, `:70`), `RemoveTimeSignatureCommand`
and `DeleteTempoMarkerCommand` return early there, and
`DeleteTempoMarkersCommand` strips tick 0 in its constructor.
`AddTimeSignatureCommand` exists and no UI calls it. So no control in the app
sets the chart's first meter.

**The lead-in is measured from tick 0.** `planLeadingSilence` reads the meter
from `chart.timeSignatures[0]` and pads whole bars of it. A wrong meter there
pads wrong bars, and the user cannot correct it.

**The lead-in is measured from a note that does not exist.** 0064 sizes the
pad with `pMin = max(0, LEAD_MIN_MS - firstNoteMs)`
(`lib/chart-edit/leading-silence.ts:231`). Charters build the tempo map and
add the silence before they chart anything, so `firstNoteMs` is `Infinity`
and the floor never applies.

**Presses accumulate and nothing resizes.** `applyLeadingSilence` sets
`newAnchorMs = existing.ms + plan.padMs` and shifts events by `plan.padMs`,
while the planner re-measures the padded chart. A later tempo edit calls
`refreshAnchorKeepMs`, which keeps the duration and only re-ticks, so the
lead-in silently becomes a different number of bars. The audio layer already
disagrees: `usePaddedAudio` keeps the original PCM and re-pads from source.

**A regenerated map lands in the wrong frame.** Assist tasks read
`loadOriginalBytes`, so a new map is in original-audio time.
`ReplaceTempoMapCommand` installs it unshifted and keeps the anchor.
Measured: on a doc padded 2000 ms, a change the pipeline saw at 4000 ms lands
at chart ms 4000, which is 2000 ms into the audio.

**Nothing measures where the music starts.** `Synctrack.origin_ms` is grid
phase, not the musical start: `anchorOriginToAudioStart` advances it "by whole
BARS to the first downbeat at/after t=0"
(`lib/tempo-map/converter.ts:417-421`). The okgo fixture's value is 51 ms. A
file with eight seconds of silence still reports an origin near zero.

### What the research says

From `~/projects/drum-to-chart`:

- **The region before the first downbeat is not music.**
  `wiki/tick0-lead-in-conventions.md`, mined over 15,518 charts, frames every
  tick-0 construct as writer convention. It exists to satisfy two
  non-musical constraints: `ms(tick 0) = 0`, and the origin on a bar line.
- **Whole bars, at least two seconds.** Human first-note time p10 = 2015 ms,
  median 5.5 s.
- **Meter cannot be read from audio.**
  `wiki/meter-not-recoverable-from-audio.md`: the shipped numerator has 33.3%
  precision and 9.2% recall on meters that are not 4/4. Python ships
  `force4` — always 4 — because the picker measured worse. This plan follows
  it: **the opening meter is 4/4 until the user says otherwise.**
- **Never remove notes from the intro.** `PIPELINE_AUDIT.md:100` (F65): the
  first five seconds carry a 65-80% edit rate, read as missed count-in notes.

## The model

Two persisted numbers, one recorded opening, and a pad that is always
recomputed:

```
X = songStart.audioMs   // first downbeat, measured in the ORIGINAL audio, >= 0
N = leadIn.bars         // whole bars of lead-in
P = N * barMs - X       // the pad, sample-quantized
```

`X` is invariant under padding and under tempo edits, because it is a
position in the audio. Ticks are derived from it, so it needs no glue pair.

**Where `barMs` comes from — a record, not a guess.** The chart cannot answer
"what is the real opening?" once the writer has wrapped a lead-in construct
around it. Two revisions tried to infer the answer from the chart's shape.
Both failed on real inputs:

- "Use the later marker when the first one governs the song start" rewrites a
  hand-authored chart. With `T0(tick 0, 120)` and `T1(bar 9, 60)` and
  `X = 0` — the flow step 4 advertises — it makes 60 BPM the opening, drops
  `T0`, and halves every tick in the first section.
- "One signature event means it came from our pipeline" is false. A human
  chart in 7/8 throughout has exactly one signature event
  (`lib/chart-edit/bar-derivation.ts:93-101`), and the rule would convert it
  to 4/4 for its whole length.

So the opening is **recorded when a synctrack becomes a chart**, which is the
one moment the real values are in hand and no construct exists yet:

```ts
interface Opening {bpm: number; meter: {numerator: number; denominator: number}}
```

Written at every site that installs a synctrack, and the list is short and
enumerable: `ReplaceTempoMapCommand`, `CommitTempoCandidateCommand`,
`RepredictTempoCommand` (exported, no caller today, but a live footgun), and
`lib/drum-transcription/pipeline/chart-builder.ts`, which is how a
transcription project gets its chart without touching an editor command.

Reading it:

- **With a record.** `bpm0` is `Opening.bpm`. The meter is 4/4 — the
  prediction's numerator is not used (33.3% precision on meters that are not
  4/4; Python ships `force4`) — and step 3 writes it.
- **Without a record** — an imported `.chart` or `.sng`, or a project from an
  older build. `bpm0` is the chart's tempo at tick 0, and **the meter is the
  chart's meter at tick 0 and is never overwritten.** We did not make this
  chart's opening, so we do not claim to know better than it. A collapse
  marker (BPM >= `COLLAPSE_BPM_MIN`) is the one value we refuse: it is not
  music, and `barMs = 12 ms` would give a 167-bar lead-in. There, and only
  there, the next marker's tempo is used.
- **After the first emit,** the record and tick 0 agree by construction,
  because step 3 wrote tick 0 from the record. Later tick-0 edits write both.

**Choosing `N`.** The smallest whole count that meets all three bounds:

```
N * barMs >= LEAD_MIN_MS                 // the music starts at least 2 s in
N * barMs >= X                           // P >= 0
N * barMs >= X - min(eventAudioMs)       // nothing is pushed before tick 0
```

Every bound is a `ceil`; there is no nearest here. The third is empty on a
chart with no notes, which is the normal state when the button is pressed,
and applies later when pickups sit before the downbeat.

**Which bounds apply, and when. This is stated once, here, and nowhere
else.**

- When the **user chooses** `N` — the first press, a later press, `[+]`,
  `[-]`, Reset — all three bounds apply.
- On a **recompute** — a tempo or meter change, a promotion, a map install —
  bounds 2 and 3 apply and bound 1 does not.

Bound 1 is cosmetic; bounds 2 and 3 are correctness. Dropping bound 1 on a
recompute stops a lead-in that is merely short from becoming a song that is
one bar out of place: at `X = 0`, `N = 1`, 4/4, `A = 60`, promoting to
`B = 240` gives `barMs = 1000`, and raising `N` to 2 would move the whole
song one second against its audio.

Keeping bound 2 on a recompute is not optional. `X = 3000`, `N = 2`, tick-0
tempo 60, 4/4 gives `barMs = 4000` and `P = 5000`; retype to 240 and
`barMs = 1000`, so holding `N` gives `P = -1000`. Bound 3 does not catch it —
with every note at or after `X`, bound 3 reads `N * barMs >= 0` — and a
negative pad reaches `padAudioAhead`, `shiftOnsets`
(`components/chart-editor/commands.ts:1183-1186`) and `ReplaceLyricsCommand`
(`:1913-1922`), all of which add the anchor unsigned, and then
`swapSynctrack` clamps the negative result to tick 0.

A song that already holds silence needs no special case. Eight seconds of
silence gives a large `X`, the second bound applies, and `N` tops the pad up
to the next bar line — 164 ms at 146.98 BPM — instead of adding a lead-in.

**Invariants.**

- **I1 — `ms(tick 0) = 0`.** The apply path emits the opening itself
  (step 3). The writer never infers one.
- **I2 — the song start is on a bar line.** `P + X = N * barMs`, to within
  half a sample period, at one constant tempo across the lead-in. I2 is a
  tick equality, not an ms equality, because `P` is sample-quantized.
- **I3 — nothing is pushed before tick 0.**
  `P >= max(0, -min(eventAudioMs))`. `P >= 0` is not sufficient:
  `swapSynctrack` clamps a negative chart ms to tick 0 silently
  (`lib/tempo-map/swap-synctrack.ts:120`), so a pad that shrinks would stack
  every pickup into one chord at tick 0.
- **I4 — the audio stays aligned outside the lead-in.** The audio is padded
  by the same `P`, so alignment holds from the song start onward. Inside the
  lead-in it does not: a tempo change at the opening re-times count-in
  events, which is what a tempo edit means.

## The approach

### 1. What is persisted

Three own-properties on the `ChartDocument`, beside `audioAnchor`, reached
through accessors in `lib/chart-edit/leading-silence.ts`. With the anchor
they make four records, and the carry helper copies all four:

```ts
interface SongStart {audioMs: number}   // >= 0, always user-set
interface LeadIn {bars: number}         // absent = the opening is not emitted yet
interface Opening {bpm: number; meter: Meter}   // recorded at synctrack install
```

`audioAnchor` stays, but it is the derived pad, not accumulated state.

**Persistence.** There are **two** metadata stores, and both need the three new
fields:

- `lib/project-storage/opfsProjectStore.ts` — the interface (`:74`), the
  `createProject` opts type (`:259`) and its write (`:288`).
- `lib/drum-transcription/storage/opfs.ts` — its own `ProjectMetadata`
  (`:138`), its `Pick<...>` allowlist (`:310-328`) and its `createProject`.
  `EditorApp` writes through this one, not the other.

All three are absent-means-unset, so a project written by today's build
loads with the feature off. Every site that mirrors `audioAnchor` must mirror
them: `TrackEditPage`'s autosave and its load re-attach
(`TrackEditPage.tsx:776-777`), `EditorApp`'s `updateProject` and its load
re-attach, and `createProjectFromDoc.ts:77`. A field left off any one site
does not survive a reload.

**Carry.** `carryDocSidecars(from, to)` copies **all four** records — the
anchor, the song start, the lead-in and the opening. Use it wherever the
anchor is re-attached today (`ReplaceTempoMapCommand`,
`CommitTempoCandidateCommand`). Note that both `repredictTempo` return paths
spread `...doc`, so those re-attaches are defensive; the substantive call at
those sites is `refreshAnchorKeepMs`, which the helper does not replace.

### 2. The pad contract

`planLeadingSilence(doc, sampleRate, {bars})` returns an **absolute** `P`.

- `applyLeadingSilence` shifts events by `P_new - P_old`, not by `P`.
- The task's pre-pad uses `P_new`, not `(existingAnchor?.ms ?? 0) + padMs`
  (`lib/assist/tasks/add-leading-silence.ts:104-106`).
- **The task measures the doc twice** (`:94` and `:115`) and applies the
  second plan. Under absolute `P` the two can differ if the doc changed
  during the run, which would leave the audio padded to one value and the
  chart to another. The run must compare them and re-pad when they differ,
  rather than apply a plan the audio does not match.
- `audioAnchor` is set to `P`, never added to.
- **It must not return null for a small pad.** `planLeadingSilence` today
  returns null below half a millisecond (`leading-silence.ts:237`). Under an
  absolute `P`, `P = 0` and `P = 164 ms` are legal targets that may be a
  *decrease*. Return null only when `P_new === P_old`.

**Four consumers take `P_new - P_old`:** `shiftChartMs`, the installed map,
`state.loopRegion` (chart ms, `lib/chart-editor-core/state.ts:208`) and the
playhead that `usePaddedAudio` carries in chart time (`:571`). The worker
pre-pad is **not** one of them: `padAudioAhead(anchorMs, ...)` already takes
the absolute pad (`lib/assist/tasks/add-leading-silence.ts:108-112`) and must
keep taking it.

**Recompute triggers.** A change to `X`; a change to the meter or tempo at
tick 0, including the tick-0 meter edit and the tempo promotion of step 6;
**any tempo or signature event added or moved before the song start**, which
breaks the single-tempo lead-in that `barMs` depends on; a map install,
including the x2 / /2 commit; and each change of `N`. **A change to `X` also
re-minimizes `N`**, so a corrected song start cannot leave an oversized
lead-in behind. Markers left inside the lead-in are dropped by the next
apply, and reported like every other discard.

**The clamp.** If a recompute breaks a bound, raise `N` until it holds. The
clamp and exactness cannot both survive: when any bound applies after a
promotion, the body moves by the leftover bar. Step 6 says so.

**The bar count is a control, not a ratchet.** The card shows
`Lead-in: 2 bars [-] [+]` with a Reset to the three-bound minimum. A
recompute can leave `N` below that minimum, because it does not apply bound
1. The control then snaps rather than steps: `[+]` and `[-]` both move to the
minimum first, and `[-]` is disabled at it. Without a
way down, a tempo retype and its inverse can leave a 164 ms lead-in at 8.3 s,
with two forward edits that undo cannot reach. Clicks accumulate against a
live preview and commit once, on idle or on Apply, because each commit
re-pads every stem in the worker.

### 3. Emit the opening; the writer must infer nothing

`applyLeadingSilence` installs through `swapSynctrack`, which calls
`buildSyncLayout`. That function reads `originMs = tempos[0].ms` and
manufactures a tick-0 lead-in. So every path that installs a map on a padded
doc — the apply **and** the regeneration of step 7 — emits the opening
itself:

- `newSync.tempos[0]` is `{ms: 0, bpm0}` — the opening tempo, from tick 0.
- `newSync.timeSignatures[0]` is `{ms: 0, meter}` — the opening meter. **This
  is the write that puts 4/4 in the chart.** On the first emit, `meter` is
  4/4; on every later emit it is the chart's tick-0 meter, which holds the
  user's edit if there was one.
- Every tempo and signature event before the song start is dropped.
- **With a record, the pipeline's own signature is replaced.**
  `lib/tempo-map/converter.ts:773` emits exactly one signature for the whole
  song, at the origin, with a numerator from the picker this plan does not
  trust. When there is an `Opening` record, that signature came from us, so
  the emit removes it and the tick-0 4/4 governs the whole song. That is what
  `force4` means, and it is what makes a tick-0 meter edit fix the song
  rather than the lead-in alone. **Without a record nothing is removed and no
  meter is written** — the chart's own signatures stand, wherever they sit.
  The test is the record, never the number of events: a human chart in 7/8
  throughout has exactly one signature event too.

Verified: at `|originMs| <= 1` `buildSyncLayout` emits a single segment
`{tick 0, ms 0, bpm}` with `leadInTs = null`
(`lib/tempo-map/synctrack-ticks.ts:150-153`), and `swapSynctrack` pins the
first signature to tick 0 (`:214-221`). The emitted opening survives the
round trip, so the writer needs no change.

The lead-in is therefore single-tempo, which is what makes `barMs` well
defined. The cost is that a genuine tempo change inside the intro is
discarded. **Notes are never discarded** (F65); pickups keep their audio
time and re-tick onto the lead-in grid.

**The discard is reported.** Dropping more than one tempo event, or any
signature event, asks first and names what goes. A chart that was rephased
before `X` was set carries a short measure at tick 0; dropping it renumbers
every bar in the song, so that case says so in words, not in counts.

**The card's recommendation.** Trigger (a) of
`detectLeadingSilenceRecommendation` fires on a synthetic opening, and
trigger (b) has never fired because no host supplies `detectedAudioOnsetMs`.
Delete both, and the dead parameter with them, but do not leave the card
silent: it is highlighted when the chart has a tempo map and `X` is unset,
which is exactly the state that needs the user. Otherwise slice 1 ships a
card that is disabled and unhighlighted, and nothing tells the user why.

### 4. Setting the song start — the one manual step

`X` is always user-set. Nothing else can know it.

- **The control.** "Music starts here" on the tempo lane's empty-space menu,
  and the same action on the leading-silence card for the playhead position,
  showing the value so the user can check it. Neither arms a pointer mode.
- **A tap inside the lead-in is refused.** It gives `chartMs < P`, and an
  unclamped `X` would go negative and grow the pad by a bar on every repeat.
  Clamping to 0 is not the answer either: it would move the song start to the
  first audio sample, which is not where the user pointed, with no feedback.
  The app refuses and says "that point is inside the lead-in".
- **Until it is set, "Add leading silence" is disabled**, with the reason
  "Set where the music starts" and the control named in the note.

A charter who aligned the audio sets the song start at 0:00 and gets `N`
whole bars with no further input.

### 5. The meter: 4/4 by default

There is no meter confirmation step and no confidence gate. The first emit
writes 4/4 at tick 0 (step 3), and on a pipeline chart it also removes the
predicted signature, so 4/4 governs the whole song.

When the user edits the first time signature (step 6), the lead-in
regenerates at the same bar count. Correcting 4/4 to 3/4 is therefore one
edit; it fixes the whole song, not the lead-in alone, and the silence resizes
to keep the song start on a bar line.

### 6. Editing tick 0

The lock exists because tick 0 is where the audio starts. With `X` explicit,
tick 0 no longer defines the grid's phase, so it can open.

**Editing the meter.** The tick-0 chip becomes editable — edit only, never
movable, never draggable. The write goes through `AddTimeSignatureCommand`,
whose `addTimeSignature` replaces the event at the tick and works at tick 0
(`SetTimeSignatureCommand` routes via `planDownbeatAt`, which rejects
`targetTick <= 0`, `lib/chart-edit/downbeat.ts:156-157`). The same batch then
runs the step-2 recompute, and this is not optional: at `X = 100`, `N = 2`,
4/4 at 146.98, `P` is 3165.8 and the song start is at tick 1536; retype 3/4
without a recompute and bars are 576 ticks, so 1536/576 = 2.667 and I2 dies.
With it, `P` becomes 2349.3 and the song start ticks to 1152 = two bars.

**Promoting the first tempo marker.** Markers `T0(0, A)`, `T1(t1, B)`.
Deleting `T0` means `B` applies from the start. The operation keeps every
tick, so the beats do not move, whatever the user's glue mode. Every event at
or after `t1` then shifts in time by one constant:

```
delta = (t1 / resolution) * (60000/B - 60000/A)
```

The pad absorbs it. When `t1` is the song start's own marker,
`t1 = N * barTicks`, so `delta = N * (barMs_new - barMs_old) = P_new - P_old`
exactly, and everything from the song start on keeps its beats and its audio
position. When `t1` is a later marker the body moves by the difference, and
the menu says so first.

Two limits. Events between tick 0 and `t1` are re-timed by the A-to-B change;
the pad does not restore them. And when bound 2 applies — the promotion would make `P`
negative — the clamp raises `N` and the body moves by the leftover bar. Bound
1 never fires on a recompute, so a promotion that only shortens the lead-in
leaves the song where it is.

**Promoting the first time signature.** Tick 0 holds one signature. When `t1`
does not fall on a whole number of new bars from zero, the bar line at `t1`
cannot be kept and also hold the promoted meter. The promotion honors the
meter: "Use 5/4 from the start" gives 5/4 from the start, bars after `t1` are
renumbered, and the menu says so first. No short measure is written anywhere.
`planDownbeatAt` is not involved.

**New commands, not widened ones.** The tempo promotion keeps ticks whatever
the glue mode, so it cannot reuse `DeleteTempoMarkerCommand`, which branches
on `this.glue` (`components/chart-editor/commands.ts:1070-1080`), and it
cannot call `removeTempo`, which throws at tick 0. Both promotions are new
commands over new helpers.

**Naming.** These are promotions, not deletions. `deriveTimeSignatures`
always emits an event at tick 0, so "no signature at tick 0" is not
expressible. The menu says what happens: "Use 4/4 from the start", "Use 132
BPM from the start". Both are gated on `capabilities.showEditingControls`;
the existing "Remove time signature change" item is missing that gate and
gains it here.

The five tick-0 guards stay in place. They are correct: `removeTempo` and
`removeTimeSignature` must still throw at tick 0
(`lib/chart-edit/helpers/tempo.ts:43`, `:70`), and the three command-level
guards still forbid a *deletion* there. The promotions do not go through any
of them.

Every tick-0 edit writes the chart **and** the `Opening` record, so the two
cannot drift.

**The recompute has to be wired at every site that re-times the doc.** Six
call `remapKeepMs` today — `components/chart-editor/commands.ts:850`, `:989`,
`:1076`, `:1132`, `:1195`, `:1239` — plus the two new promotion commands, and
each currently calls `refreshAnchorKeepMs` alone. The claim that an edit and
its recompute cannot disagree holds only when every one of them is wired.
Implementation decides which genuinely need it; the plan requires the list to
be walked, not assumed.

### 6b. Rephase, once there is a song start

`RephaseDownbeatsCommand` rotates the lattice by putting a short measure at
tick 0, so bar lines sit at `s, s + barTicks, ...` and the song start is off
a bar line unless `s % barTicks === 0`, which a rotation makes false
(`lib/chart-edit/downbeat-ops.ts:217`). Recomputing `P` moves the song start
by whole bars, so the offset survives. Re-deriving `X` from the tap would
overwrite the user's own statement.

So with `X` set, the item becomes "Move the song start here": it sets `X` at
the tapped beat, recomputes, and writes no short measure. Without `X` it
stays the rotation it is today.

It must not inherit two things. It is **always enabled**: `rephaseDownbeats`
returns null when the tapped beat is already a downbeat, and "the song starts
one bar later" — a tap on a downbeat — is the most likely correction. And it
is **not a superset** of the rotation: the rotation re-phases every region
against its own numerator (`downbeat-ops.ts:220-231`), while moving `X`
rotates only regions that inherit phase from tick 0. The two items are
described differently.

### 7. Regenerating a tempo map on a padded doc

The task measures the map on the original audio; the chart is in the padded
frame. `ReplaceTempoMapCommand` therefore does four things in this order:

1. Shift the incoming `tempos[].ms` and `timeSignatures[].ms` by `P_old`,
   then apply step 3's emitted-opening rule to the result. A shift alone
   leaves `tempos[0].ms > 0` and `buildSyncLayout` manufactures a lead-in
   again — on the okgo numbers, tier (a) with a stretched tick-0 segment.
2. Install it through the existing `repredictTempo` path, carrying the
   sidecars.
3. `X` is not touched: a regeneration does not know where the music starts,
   and the user's value stands. Nothing else is recorded, so there is no
   precedence rule to arbitrate.
4. If `X` is set, re-run the step-2 recompute in full, which re-installs the
   map at the new pad and re-emits the opening. Shifting events under a map
   that stays put would move the song start past the first real marker. `N`
   is carried, and only the third bound is enforced. The audio is re-padded
   through the same `padAudioAhead` worker step the leading-silence task
   uses.

Steps 1 and 4 both install. That is deliberate, not waste: step 1 must land a
legal chart before `openingAt` can read tick 0, and step 4 is the one that
ends at `P_new`. An implementation may fuse them if it can hold I2 between
them; the plan requires only the end state.

**The x2 / /2 correction is a map install too, and it needs its own emit.**
It does not take the route above. `previewStructural` passes
`decodedOnsets ?? null` (`components/chart-editor/piano-roll/PianoRollTimeline.tsx:4483-4487`),
so on a transcribed project it goes through `warpGridReach`, which is
origin-anchored and returns a different map from the one handed in
(`lib/tempo-map/ks-warp.ts:236`, `:280-297`, `:635`); with no onsets it takes
the `remapKeepMs` fallback instead. Both install a map, so both re-emit.
The **preview** doc has the same problem and is rendered before any commit,
so anything that reads an opening off `pendingTempoCandidate` must read the
`Opening` record, never the candidate's tick 0.
`ReplaceTempoMapCommand` avoids this only because it passes `onsets = null`
and takes the `remapKeepMs` fallback. So the emitted opening does not survive
a warp, and `CommitTempoCandidateCommand` must re-emit and recompute after
the commit, exactly as step 7 step 4 does. Its no-anchor branch has a tested
object-identity contract (`components/chart-editor/commands.ts:1231`), so the
recompute runs only when `X` is set.

### 8. Migration

Existing projects have an anchor and no song start. The first time `X` is set
on a project whose `audioAnchor > 0`, back-derive the bar count,
`N = max(round((P + X) / barMs), N_min)`, and recompute. The `max` matters: a
small existing pad rounds to `N = 0`, which the model has no meaning for.

This does **not** hold `P` fixed. Rounding moves the pad by up to
`barMs / 2` when the bounds already hold, and by more when they do not — a
500 ms pad with `X = 100` at 146.98 rounds to `N = 0`, clamps to `N = 2` and
moves the pad 2.7 s. The move is bounded, safe under I4, one undo step, and
announced: "Lead-in set to 2 bars (3.2 s)".

### 9. Sequencing

1. **The pad engine, its gate, and its recovery path.** Steps 1, 2, 3, 5, the
   card half of step 4, and **the tick-0 meter edit from step 6**: the
   records and their persistence, the absolute-`P` contract, the emitted
   opening, the 4/4 write, "Set music start" on the card at the playhead, and
   the disabled state until `X` exists.

   Two things force their way into this slice. The gate cannot wait: the card
   has a live entry point today (`LeadingSilenceCard.tsx:80`), and an engine
   that computes `P` from an unset `X` is worse than what it replaces. And
   the tick-0 meter edit cannot wait either, because slice 1 writes 4/4 into
   the chart and the meter edit is the only way back — in slice 1 without it,
   `hitTsChip` excludes tick 0, `SetTimeSignatureCommand` rejects
   `targetTick <= 0`, and `AddTimeSignatureCommand` has no caller. A slice
   that can write a wrong meter and cannot correct it does not ship.

   **Rephase is disabled while `leadIn !== null`** until slice 3 replaces it.
   Its rotation writes a short measure at tick 0, and the next recompute
   reads the meter from there. Slice 1 must not ship that hazard with its fix
   two slices away.
2. **The rest of the song-start UI.** The tempo-lane menu item, migration
   (step 8), the `[-] [+]` control, and the regeneration order (step 7).
3. **The rest of tick 0.** The two promotions and step 6b.

## Out of scope

- Teaching `buildSyncLayout` to take the origin explicitly. It reads
  `tempos[0].ms` today (`lib/tempo-map/synctrack-ticks.ts:85`) and calls it
  the origin. Step 3 removes the need, so the writer keeps its golden
  fixtures and its parity with `train.py`.
- The dropped bar phase (`ts_anchor_ms`). Python anchors the first signature
  at `beta_to_time(phase + 0.5)`; our writer forces tick 0. On the okgo
  fixture that moves bar lines from beats 0,3,6 to 1,4,7. Its own plan.
- Automatic onset detection. `autoresearch-chartstart` has a mel-energy-step
  predictor scored at +/-500 ms, never wired in. It could pre-fill the song
  start later. It is not in this plan, and no record holds a pending
  suggestion.
- `song.ini` `delay` and the stored audio at rest, which are never modified.
  This is not a claim that export is untouched: every recompute changes the
  exported audio's length, because the pad is what gets encoded in front of
  it. `planExportAudio` already pads from original PCM, so no export code
  changes; its bytes do.

## Tests

- `P = N * barMs - X` for `X = 0`, a small `X`, an `X` past one bar, and 7/8
  and 5/4 meters. Each bound applying in turn: the two-second floor on a
  chart with no notes, `P >= 0` on an already-padded song where the pad tops
  up to the next bar line, and the event bound with a pickup before the song
  start.
- **The audio-position invariant, written first.** A note's audio position
  (`chartMs - anchor.ms`) does not move across any recompute: a press, a
  meter edit, a promotion, a regeneration. Four consumers take
  `P_new - P_old`; a missed site or a reversed sign gives a chart that is
  internally consistent and one pad out against its audio, and no test on
  `P` alone finds it. **The tolerance is one tick, not zero.** Every apply
  runs `swapSynctrack` (ticks are rounded, `swap-synctrack.ts:120`), then
  `nudgeNoteCollisions`, then `retimeChart`, which re-derives `msTime` from
  the rounded tick — about 2.1 ms at 147 BPM and resolution 192. Assert the
  tolerance and measure the real figure on the okgo fixture before slice 1
  exists.
- A shrinking pad never pushes an event before tick 0; `N` rises instead of
  `swapSynctrack` clamping it to tick 0.
- A tap inside the lead-in is refused and changes nothing. A corrected `X`
  re-minimizes `N`.
- A recompute never raises `N` for the two-second floor: the `A = 60` to
  `B = 240` promotion at `X = 0`, `N = 1` keeps `N = 1` and the song's audio
  position.
- A recompute always keeps bound 2: at `X = 3000`, `N = 2`, 60 BPM, retyping
  to 240 raises `N` rather than producing `P = -1000`.
- `[+]` and `[-]` snap to the three-bound minimum when a recompute left `N`
  below it, and `[-]` is disabled there.
- Round trip: after any apply the chart holds one tempo at tick 0, the
  opening meter at tick 0, no `leadInTs`, and the song start at tick
  `N * barTicks`. Run it for a collapse opening, a partial-bar opening, a
  stretched opening and a clean chart.
- The `Opening` record is written at all four install sites, including
  `chart-builder.ts`, so a drum-transcription project and an editor project
  give the same answer. It survives a reload, undo/redo and every command
  that rebuilds the doc.
- With a record, the opening tempo on the okgo fixture is 152.67, not the
  writer's 147.87, and the first emit writes 4/4 at tick 0 and removes the
  pipeline's own signature, so the whole song is 4/4.
- **Without a record, nothing is overwritten.** A human chart in 7/8
  throughout — one signature event — is still 7/8 after an apply. A
  hand-authored chart with 120 BPM at tick 0 and 60 BPM at bar 9 keeps 120
  as its opening when `X = 0`.
- A collapse opening (BPM >= `COLLAPSE_BPM_MIN`) never reaches `barMs`, with
  or without a record.
- The meter defaults to 4/4 even when the prediction says 3/4, and editing it
  to 3/4 resizes the pad at the same bar count.
- Presses and the `[-]` control: `N` 1 to 2 to 3 and back, the pad moving by
  `barMs` each time, and Reset returning to the three-bound minimum.
- A tempo or signature event added inside the lead-in triggers a recompute
  and is dropped by the next apply.
- Promotions: beats kept; `delta = P_new - P_old` when `t1` is the song
  start's marker; the body moving by the leftover bar when any bound applies,
  including the two-second case where `P` stays positive; the meter promotion
  putting the promoted meter at tick 0 and renumbering the tail, with no
  signature event written anywhere else; and the five tick-0 guards left in
  place, with the promotions going around them through their own commands.
- Regenerating on a padded doc: the end state has the map at `P_new`, the
  emitted opening intact, and `X` unchanged.
- Migration: the announced back-derivation, including the `N = 0` case that
  clamps and moves the pad 2.7 s.
- Notes before `X` survive the opening rebuild with their audio time intact.

## What is built

Slice 1 is implemented and green: `pnpm typecheck`, `pnpm test` (425 suites,
4456 tests) and ESLint/Prettier are clean.

- `SongStart`, `LeadIn` and `Opening` records, their accessors,
  `carryDocSidecars`, and both metadata stores.
- `resolveOpening`: the record before the first emit, the chart after it, and
  the collapse-marker refusal when there is no record.
- `planLeadingSilence` with an absolute `P`, the three bounds, and bound 1
  applied only to a user choice (`{userChoice: true}`).
- `applyLeadingSilence` shifting by `deltaMs` and emitting the opening.
- `SetSongStartCommand`, `SetOpeningMeterCommand`, and the card: a "Set song
  start" action at the playhead, the disabled gate, and the bar count in the
  note.
- The opening recorded at `ReplaceTempoMapCommand`, `chart-builder.ts` and
  the structural preview.
- The tick-0 chip is editable in the tempo-lane menu; the remove item stays
  off it; rephase stands down while a lead-in exists.
- `leading-silence-detector.ts` and its dead onset parameter are deleted.

The API the review pass settled on: `planLeadIn(doc, bars?)` for a user
choice, `replanLeadIn(doc)` for a recompute, `applyLeadIn(doc, plan)` to
install. The two-second floor is the difference between the first two, which
is a function name rather than a boolean. Nothing takes a sample rate: the
pad is milliseconds and `anchorPadSamples` rounds when the audio is padded.
`DocSidecars` is the one list of records, extended by both project metadata
stores and applied by `readDocSidecars` / `applyDocSidecars`.

Two findings from the review passes were confirmed by the tests as written,
before the code was fixed:

- `resolveOpening` returned a hard 4/4 even after the user set a meter, so
  the pad did not resize and the song start landed at 2.667 bars — exactly
  the arithmetic step 6 predicts. The predicate is now "has the opening been
  emitted", and after the emit the chart is the truth.
- The plan's 164 ms / 3165.8 ms figures were right, and revision 8's
  "correction" to 166 / 3166.4 was wrong. The values are computed in the
  tests now, not asserted in prose.

Slice 2 is implemented and green too (427 suites, 4466 tests):

- **Step 7.** `ReplaceTempoMapCommand` shifts the incoming map by the pad
  before installing it (`shiftSynctrackMs`), records the opening from the
  UNSHIFTED map, and re-runs the recompute so the map is re-installed at the
  new pad with the opening re-emitted. A test reproduced the original defect
  first: a change the pipeline measured at 4000 ms landed at chart ms 4000 on
  a doc padded 2000 ms.
- **Step 8.** `barsForExistingPad` back-derives the count for a project
  padded by the old model, and `SetSongStartCommand` uses it on the first
  gesture. Its tests pin the bound: exactly two bars stays put, 3000 ms moves
  half a bar, and 500 ms rounds to zero bars and is clamped up.
- **Step 4's second control.** "Music starts here" on the tempo lane, which
  refuses a tap inside the lead-in rather than clamping it to zero.
- **The bar count.** "Add a bar" and "Remove a bar" on the card, both routed
  through the same task, so the audio is re-padded under the same progress
  card. `replanLeadIn` now returns null when there is no lead-in: a recompute
  must never create silence the user did not ask for.

Slice 3 is implemented and green (429 suites, 4477 tests):

- **The two promotions.** `PromoteOpeningTempoCommand` keeps every tick and
  hands the time change to the pad; `PromoteOpeningMeterCommand` honors the
  meter at tick 0 and renumbers the tail, writing no short measure and never
  touching `planDownbeatAt`. Both are offered from the tick-0 marker's own
  menu, labelled for what they do, and the five tick-0 guards stay where they
  are.
- **Step 6b.** With a song start, the rotation item is gone rather than
  disabled: "Move the song start here" says the same thing without writing a
  short measure, and it is always enabled.

Two defects the tests caught before the code was right:

- The tempo promotion double-counted. `retimeChart` had already moved every
  event's ms into the new grid, and `applyLeadIn` then shifted them again by
  the pad's own change — 1333 ms off the audio in the worked case. A
  tick-preserving edit needs `adoptLeadInPad`, which moves the anchor and the
  bar count and leaves the chart alone.
- Making the tick-0 chip hittable in slice 1 let it swallow the tick-0 tempo
  marker's menu, because the two always share an x. The chip now answers only
  inside its own strip, which the drag path already required.

## What is left
- **Not yet verified in a browser.** The jsdom tests drive the real card,
  the real `TrackEditPage` and the real piano-roll menu, but nothing has run
  against real audio. The tick tolerance on the audio-position invariant is
  asserted, not measured on the okgo fixture.
- The discard is reported in the success message, not in a confirmation
  dialog. A song start set deep into a song can drop many markers with only
  an undo to recover.

## Risks

- Every recompute re-pads every stem. The `[-] [+]` control commits once on
  idle, but the debounce interval is unspecified.
- Undo of a pad-changing edit re-pads outside the worker's progress path,
  because the prebuilt claim will not match. It is the one place a user can
  meet a silent multi-second stall.
- The later-marker rule picks the wrong tempo on a chart whose music really
  changes tempo inside its first bar. The lead-in is then a few per cent off
  the song. Alignment is unaffected, and a tick-0 retype corrects it, but
  nothing warns the user.
- An imported chart with a human-written lead-in construct is read the same
  way. The census says human charters write these constructs, so this is not
  a rare input.
- Six review passes each found faults below the last, and three premises of
  revision 1 were false. Assume the arithmetic needs its test before it is
  trusted, not after.
