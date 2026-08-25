# 0124 — Own the opening: one record, a signed anchor, no flag

**Revision 10.** Revisions 1–9 designed a song-start flag, a persisted
"real opening" record, and automatic re-padding whenever either changed.
That design shipped as far as browser testing and produced a class of bugs
where the chart jumped under the user and their notes came off the grid.
Revision 10 keeps what was right and deletes the rest. The history is in
"What revisions 1–9 got wrong" below, because two of those mistakes are easy
to make again.

## The problem

A Clone Hero chart pairs a sync track with an audio file. Human charts open
with whole bars of lead-in at the song's own tempo, with the song's first
downbeat on a bar line. A recording usually opens with an arbitrary amount of
silence, and a generated tempo map opens with whatever `buildSyncLayout` had
to invent to satisfy `ms(tick 0) = 0`.

We add the lead-in for the user. The stored audio is never modified: we pad a
decoded copy for playback and pad again on export.

The pad is

```
P = N * barMs - X
```

where `X` is where the music starts inside the stored audio, `barMs` comes
from the song's own opening tempo and meter, and `N` is a whole number of
bars.

Everything hard about this feature is the same question in different
clothes: **where is `X`, and what is the opening?**

## Three facts that decide the design

**1. A tick-0 tempo and time signature are required by the format.**
`Chart-File-Formats/chart-format/Format-Overview.md:242,261` states it twice,
with named fallbacks — 120 BPM and 4/4 — and the `.mid` side says the same
per meta event (`mid-format/Technical-Details.md:172,174`). Our scan-chart
fork's two `unshift` calls implement that fallback. They are not a hack, and
the corpus agrees: over the raw bytes of 78,453 chart folders, 100% of both
`.chart` and `.mid` carry a tempo at tick 0.

So the tick-0 event cannot be removed. It can only be made **true**.

**2. Provenance cannot survive a chart.** A user can open another author's
chart, or export ours and import it again. In neither case is there a session
that remembers which events we synthesized. Any behavior that depends on
telling our events from the charter's works once and then stops. So there is
no "synthesized" flag anywhere in this design, and none in scan-chart.

**3. `X` is computable in this repo.** `beatsToSynctrack` is ours
(`lib/tempo-map/converter.ts:497`), our worker calls it
(`lib/tempo-map/pipeline-worker.ts:330`), and it already receives `downbeats`
and holds `downbeatsMs` in local scope after the lag correction. The first
downbeat is right there. We do not need a change in another repo, and we must
not redefine `origin_ms`: `ks-warp.ts` reads it as tick-0 grid phase in three
places (`tempoArraysForBeta` forces `segMs[0] = originMs` at `:194`,
`anchoredBeats` guarantees `beats[0] === origin_ms` at `:225`), and its own
comment at `:175` records that `tempos[0].ms != origin_ms` is the normal case.

## The model

**One record: `songStartTick`.** The chart tick where the music begins.
That is the whole sidecar surface this feature adds, beside the `audioAnchor`
that plan 0064 already established.

Everything else is derived:

```
X        = tickToMs(songStartTick) - anchor.ms      // music inside stored audio
bars     = songStartTick / barTicks                 // lead-in bars
opening  = bpmAt(songStartTick), tsAt(songStartTick)
```

A tick is the right thing to persist because a tick does not move when the
meter changes; a bar count does. Revision 9 persisted the bar count and the
opening separately, and both could go stale against the chart they described.

**The anchor is signed.** `audioAnchor.ms < 0` means the decoded copy is
trimmed from the front by that much, not padded. This is what makes the
feature work on a chart that arrives already padded — imported, or exported
by us and opened again — and it deletes a bound rather than adding a branch
(see "The bounds" below).

Trimming does not modify the stored audio any more than padding does. Both
happen on the decoded copy and on the exported copy.

**Nothing recomputes on its own.** Editing the opening tempo or meter changes
the chart and nothing else. The card reports when the lead-in is no longer a
whole number of bars, and the user re-fits when they want to.

## What revisions 1–9 got wrong

Worth writing down, because both mistakes look like good ideas.

**The automatic re-pad.** When the user set the song start, or changed the
opening meter, the editor recomputed the pad and shifted the chart to match.
Every "the chart jumped and my notes fell off the grid" report traces to
this. A user statement about the chart is not a request to move the chart.

**The re-emit.** `planPad` drops every sync event at or before the song start
and writes a fresh opening at ms 0. Applied on a *recompute*, that deleted
the user's own markers at the song start and wrote the intro's values over
the top — a 3/4 168.4 intro ate a 4/4 150.5 song, on video. The emit is
correct when the pad is being applied and wrong every other time.

Revision 10 keeps the emit, on the pad path only, and deletes the recompute.

## The approach

### 1. `musicStartMs` on the synctrack

Add an optional `musicStartMs` to `Synctrack` (`lib/tempo-map/types.ts`) and
set it in `beatsToSynctrack` from `downbeatsMs[0]` after the lag correction.

Additive only. `origin_ms` keeps its meaning and every existing consumer —
`ks-warp`, `structural-correction`, `buildSyncLayout` — is untouched.

**Every grid transform goes through `withGrid`.** The warp, the reach revert
and the octave rescale each replace the origin, the tempos and the
signatures, and each used to rebuild the object with a literal. A literal
supplying the three REQUIRED fields satisfies `Synctrack`, so the compiler
says nothing and an optional field just disappears — which is what happened
to `musicStartMs`, on the data-dependent branch where the warp admits, with
no error anywhere. `withGrid(sync, grid)` makes the preservation structural,
and the next optional field cannot repeat it.

`specs/0001-tempo-map-song-start.md` drops from a blocking request to a note
for the Python side: "we added this field, you may want the same one." Its
own Status line still reads "request for comment" and should be updated
before it is sent.

### 2. Signed anchor: the audio can be trimmed

- `padPcmStart` becomes `shiftPcmStart`: negative counts return
  `pcm.slice(cut)`. The name has to change — a function called `pad` that
  trims is exactly the kind of thing that gets misread later. `slice`, not
  `subarray`: `subarray` shares the underlying buffer, and
  `shift-tracks-worker.ts` transfers the result, which would detach the
  caller's source PCM.
- `anchorPadSamples` returns a signed frame count instead of clamping at 0.
- `planExportAudio` returns `{kind: 'shifted', shiftSamples}` for any
  non-zero count, and `blocked` when the package has not decoded and the
  anchor is non-zero. Today it only blocks a positive one, so an unexported
  trim would ship silently misaligned audio.
- `padTracks`/`padTracksInWorker` pass the signed count through. The
  zero-count short circuit stays.

### 3. `songStartTick` replaces three records

Deleted: `SongStart`, `LeadIn`, `Opening`, `openingFromSync`, `getOpening`,
`setOpening`, `getLeadIn`, `setLeadIn`, `getSongStart`, `setSongStart`,
`barsForExistingPad`, `adoptLeadInPad`.

Added: `getSongStartTick` / `setSongStartTick`. `DocSidecars` becomes
`{audioAnchor, songStartTick}`. Both OPFS stores follow.

**One bar length, one source.** `openingBar(doc)` returns `{barMs, barTicks}`
from `resolveOpening`, and the planner, the card and the bar count all read
it. `leadInBars` measured tick 0 instead for a while: on a generated chart
that is a different meter from the song's, so 1440 ticks in front of a 4/4
song read as "1 bar" of the construct's 3/4 rather than 0.75 of a real one —
and the card called that whole and hid the re-fit.

**`applyDocSidecars` is the only way to restore.** A host that saves
`readDocSidecars` and re-attaches a shorter list by hand writes a field on
every autosave and drops it on every reload.

`resolveOpening` loses its record branch and its `getLeadIn === null` gate,
and becomes what it always should have been:

```ts
const tick = getSongStartTick(doc);
if (tick != null) return {bpm: bpmAt(tick, …), meter: tsAt(tick, …)};
// no record: tick 0, refusing a collapse marker as before
```

`keepSongOnItsAudio` loses its `songStart` lookup and its bar-count write —
`songStartTick` is the tick it was reconstructing, and the bar count is now
derived.

**Migration.** A project with the old `songStart`/`leadIn`/`opening` fields
converts on load: `songStartTick = msToTick(songStart.audioMs + anchor.ms)`.
The other two fields are dropped. Nothing about the chart moves.

### 4. The bounds

`planPad` keeps two lower bounds on `N` and drops one:

- `N >= 1`.
- No chart event before tick 0, measured in the stored-audio frame — over
  EVERY timed event, through the same `forEachTimedEvents` traversal that
  shifts them. Two hand-written lists is how the bound came to scan
  `noteEventGroups` while the shift moved twenty-odd arrays: harmless while
  the pad could not go negative, and a silent collapse onto tick 0 once it
  could.
- The two-second floor, **only** on a press with no bar count of its own —
  "Add leading silence". Add-a-bar and Remove-a-bar carry an explicit count,
  and that is the user's own choice about their own chart.
- ~~`N * barMs >= X`~~ — **dropped.** That bound existed only because the pad
  could not go negative. With a signed anchor the music is never trimmed
  anyway: `P + X = N * barMs >= barMs > 0`, so the music always sits at least
  one bar into the padded audio.

Dropping it is what makes "Remove a bar" work on a chart with 30 seconds of
leading silence, and on an imported chart we padded in a previous session.

**When `songStartTick` is unknown** — a chart imported with no metadata —
`X` is unknown, so trimming could cut into the music. There the pad is
bounded at `P >= 0` and "Remove a bar" disables at zero with that reason.
This is the one place the design admits it does not know something, and it
says so instead of guessing.

### 5. The card

Two buttons, none automatic. The first is labelled for the state:

- **Add leading silence** — no lead-in yet; the fewest whole bars giving at
  least ~2 s
- **Re-fit to whole bars** — the lead-in exists but is a fraction; same
  action, so it is the same button
- **Add a bar** — the lead-in is already whole bars
- **Remove a bar** — the second button, one bar down, no floor

Re-fit and Add-leading-silence are one action because they are one thing:
re-plan with no count of its own and let the planner choose. Giving them
separate buttons meant an explicit count, which skips the two-second floor,
so "Re-fit" could leave 0.4 s of lead-in.

**No sub-bar control.** A draft of this revision added a ±1 beat nudge, on
the reasoning that a song start off by a beat is unreachable from whole-bar
buttons. It is reachable, and by the controls that already exist: the song
start flag moves to any tick, and the opening tempo and meter are editable
where they sit. A second way to move the same relationship — one that slides
the audio under the grid rather than changing the chart — is a second mental
model for the user to hold, and the first one is enough.

The card also reports a lead-in that is no longer whole bars — "Lead-in: 2.67
bars — [Re-fit]" — which is how a meter edit surfaces without anything
jumping.

**With no song start it names the opening it would use.** A generated chart
opens on the writer's construct: for the "In Waves" run the map is 3/4 at
156.752 at tick 0 and 4/4 at 154.376 at tick 1440, and the 3/4 is arithmetic
— three quarters at 156.752 IS the 1148.31 ms gap before the music. Pressing
the button there would build a lead-in of a meter the song never plays. The
card is still enabled, because on a chart from somewhere else that behavior
is right, but it states the values first: "Lead-in will be whole bars of 3/4
at 156.8, the values at the start of the chart." The user sees the wrong
meter before the click, not after.

### 6. What stays that revision 10 first proposed to delete

**The writer's three tiers stay.** `buildSyncLayout` is not this feature's
writer; it is *the* writer. `swapSynctrack` has six non-test callers and only
one of them pads (`leading-silence.ts:722`). The /tempo export
(`app/tempo/TempoClient.tsx:265`), `build-chart.ts:23`,
`chart-builder.ts:225`, `repredict.ts:158` and every hand tempo edit
(`tempo-remap.ts:243`) go through it with an unpadded map. Deleting the tiers
would put every note in an okgo export 1623 ms early. The tiers stop firing
on the lead-in path because that path emits its own opening — that was always
the mechanism, and it needs no change to the writer.

**The promotions stay.** `removeTempo`/`removeTimeSignature` throw at tick 0
(`lib/chart-edit/helpers/tempo.ts:41,67`) because the format requires the
event. "Delete the tick-0 marker" therefore has to mean "the next marker's
value moves back", which is `PromoteOpeningTempoCommand` /
`PromoteOpeningMeterCommand`. They are also the only repair for an imported
collapse marker or partial `r/4` bar — the constructs this plan exists to be
rid of. They are behavior, not provenance, so they do not bring back what
fact 2 forbids.

**`SetSongStartCommand` stays**, recording only. It already does nothing but
record; revision 9's bug was the shift around it, which is already gone. It
now writes a tick, through `recordSongStart`.

**The song start snaps onto a coincident marker, within a 32nd note.** Not
the one-beat snap revision 9 had — that moved the flag somewhere the user had
not pointed. This one corrects a miss no user could have intended, and it is
not cosmetic: the emit keeps every event strictly after the song start, so a
song start a few ticks BEFORE the marker the user aimed at leaves that marker
alive a few milliseconds after the emitted opening. That is a segment far too
short to be music, which the writer then has to cover at an absurd BPM — and
the opening is read from the wrong side of the marker as well.

Every route that records a song start goes through `recordSongStart`: the
menu, the flag drag, the tempo map's own `musicStartMs`, and the migration of
an older project. A tick written by any other path would carry exactly the
near miss this exists to remove.

### 7. The UI

**Deferred with the piano-roll extraction:** the tempo lane now has four
overlapping pointer targets — flag, chip, marker, empty — resolved by
statement order inside the pointerdown handler, each with its own separately
declared y band. Gating the flag to its pennant took y ∈ [1, 9) out of the
signature chip's 14-pixel strip, so a chip that shares a tick with the song
start is a 6-pixel target. Nothing in the tests notices. One
`resolveTempoLaneTarget(x, yInLane, scene)` would give the pointer path the
same single definition `buildTempoMenu` got, and belongs in the same plan
that extracts the menu and the four drag state machines.

`SetOpeningMeterCommand` goes: with no recompute it is a wrapper around
`AddTimeSignatureCommand`, which already writes at tick 0. The tempo lane's
menu calls that directly.

**The song-start flag STAYS.** An earlier draft of this revision deleted it,
on the reasoning that the record was going away. The record did not go away —
tick 0 holds a writer construct until the first pad, so nothing in the chart
says where the music is, and `songStartTick` is the only place that knows.
Deleting the flag would leave that record invisible: the user could not see
where the editor thinks the song starts, or move it when it is wrong.

What the flag loses is the magic. It no longer snaps to a nearby tempo
marker, and planting it no longer adds one. Both existed to keep the song
start and a marker on the same tick, and both meant a click or a drop landed
somewhere the user had not pointed. It records the tick under the pointer,
and nothing else.

## Out of scope

- `buildSyncLayout` and its golden fixtures — untouched (§6).
- The scan-chart fork. Fact 2 removes the reason to change it.
- `[Song] Offset` / `song.ini` `delay`. They shift the whole chart, so they
  are an alternative to padding, not a way to mark a musical start. Worth
  revisiting as an export option; not this plan.

## Tests

Unit, `lib/chart-edit/__tests__/`:

- `song-start-tick.test.ts` — derived `X`, bars, opening; migration from the
  three old records.
- `lead-in-pad.test.ts` (update) — the two surviving bounds; the dropped one
  no longer clamps; a chart with 8 s of silence and `N = 1` produces a
  negative pad.
- `opening-at-song-start.test.ts` (update) — the opening is read at the song
  start, not at tick 0. Keep the 3/4-intro-eats-4/4-song regression.

Unit, `lib/drum-transcription/__tests__/`:

- `shift-pcm.test.ts` — negative counts trim, zero returns the same
  reference, a trim longer than the buffer empties it rather than throwing
  (the caller's bounds are what keep the music safe, and there is no useful
  audio left to defend at that point).

Command-level, `components/chart-editor/__tests__/`:

- `promote-keeps-audio.test.ts` (update) — the promotions keep the song on
  its audio with `songStartTick`.
- `round-trip-remove-bar.test.ts` (new) — pad, export-plan, reimport at
  anchor 0, remove a bar, and assert the export plan trims. This is the case
  revision 10's first draft got wrong.

## Sequencing

1. `musicStartMs` (§1) — self-contained, no consumers yet.
2. Signed anchor (§2) — audio layer only, no chart changes.
3. `songStartTick` (§3) + bounds (§4) — the large one. Delete first, then
   add; the deletions are most of the diff.
4. Card (§5) and UI deletions (§7).
5. Browser verification on a real chart.
