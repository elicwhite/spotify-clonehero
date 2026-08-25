# Spec: the tempo map should say where the song starts

**To:** the owner of the tempo-map generator (`~/projects/drum-to-chart`
`autoresearch-tempo/train.py` `beats_to_synctrack`, and its TypeScript port
`spotify-clonehero-next/lib/tempo-map/converter.ts`)
**From:** the chart editor's leading-silence feature (plan 0124)
**Status:** request for comment, then implementation
**Date:** 2026-08-24

## What we are building, in one paragraph

The chart editor adds leading silence so a chart opens the way human charts
do: whole bars of lead-in at the song's own tempo, and the first downbeat on
a bar line. The audio at rest is never modified — we pad a decoded copy for
playback and pad again on export. To size that pad we need one number:

> **Where does the music start, in the original audio?**

Everything else follows from it. With the song start at `X` ms and a bar
length `barMs` taken from the song's own opening tempo and meter, the pad is

```
P = N * barMs - X      // N = whole bars of lead-in, at least ~2 s
```

One invariant governs the whole feature: **a chart must behave the same
whichever way it arrived.** Generated here, opened from another author, or
exported by us and imported again — the editor cannot tell the three apart,
so no behavior may depend on telling them apart. Anything we know only
inside one session is not allowed to matter.

## What we need from the generator

**Do not fabricate anything at tick 0, and state the musical start.**

Concretely, one of these two, whichever you prefer:

**Option A — first event at the first downbeat.** The emitted
`tempos[0]` and `timeSignatures[0]` sit at the song's first downbeat, not at
`ms = 0`. Consumers read `tempos[0].ms` as the song start. Nothing is emitted
for the audio before it.

**Option B — keep a separate field, but make it mean the musical start.**
`origin_ms` stays, and is defined as *the first downbeat of the music* — the
point a listener would call the start of the song.

We slightly prefer **A**, because it leaves one fewer thing to keep in sync,
and because the position and the tempo that governs it are then the same
object. Either works for us.

The `Synctrack` object is the subject here. Both options are about the
in-memory map, not about the bytes of a `.chart` or `.mid` file. See
"What this does not remove" below.

## Why this is a change, and not what happens today

`origin_ms` today is **grid phase, not the musical start**. In the shipped
port, `anchorOriginToAudioStart` advances it "by whole BARS to the first
downbeat at/after t=0" (`lib/tempo-map/converter.ts:417-421`), so it always
lands within one bar of audio sample 0. Our okgo fixture has
`origin_ms = 51` with `tempos[0].ms = 1623`
(`lib/tempo-map/__tests__/fixtures/okgo/synctrack_shipping.json`). A file
with eight seconds of silence in front still reports an origin near zero.

So a consumer that reads `origin_ms` as "where the music starts" is wrong by
however much silence the file carries, and a consumer that reads
`tempos[0].ms` gets the first *fitted beat*, which is a different quantity
again.

Downstream of that, our writer (`lib/tempo-map/synctrack-ticks.ts`
`buildSyncLayout`) must satisfy two non-musical constraints — `ms(tick 0) =
0`, and the origin on a bar line — so it manufactures an opening: a
stretched lead-in segment, a partial `r/4` bar at tick 0, or a near-instant
collapse marker at thousands of BPM. Those constructs are the direct cause
of every hard bug in this feature. The editor cannot tell the writer's
invention from the charter's music, so code that reads "the opening" off
tick 0 reads the invention.

## What the format says, and what this does not remove

A tick-0 tempo and a tick-0 time signature are **required by the format**,
with named defaults:

> A tempo marker must exist at tick 0 in the chart to set the initial tempo.
> If one is not present, a tempo of 120 BPM is assumed.
> — `Chart-File-Formats/chart-format/Format-Overview.md:261` (and `:242`
> for the 4/4 signature default)

The `.mid` side states the same per meta event: set-tempo absent → 120 BPM,
time signature absent → 4/4
(`Chart-File-Formats/mid-format/Technical-Details.md:172,174`).

Two consequences.

**Our scan-chart fork is not doing anything unusual.** Its
`unshift({tick: 0, beatsPerMinute: 120})` and `unshift({tick: 0, numerator:
4, denominator: 4})` implement the format's stated fallback, with the
format's exact values. That is also why there is no issue type for a missing
tick-0 event: by the format there is no "missing", only "defaulted".

**Option A does not delete the synthesized opening. It moves it.** The
`Synctrack` object can honestly begin at the first downbeat, but a written
`.chart` or `.mid` without a tick-0 tempo and signature is read as 120 BPM
and 4/4 by every conforming reader. So the tick-0 event moves from the
generator to the writer.

That is still the change worth making, but not because it lets us mark the
event. **A mark cannot survive a chart.** A user can open a chart another
author made, or export ours and import it again, and in neither case is
there a session that remembers what was synthesized. A feature built on such
a mark works once and then stops.

The reason to make the change is that it removes the need for a mark. Once
the generator states the musical start, the writer pads with whole bars at
the song's own opening tempo and meter — so the tick-0 event it writes IS
the song's opening tempo and meter. That is true for us, for the game, for
another editor, and for us again after a round trip. Nothing has to know
where the event came from, because there is nothing to know.

## Three format mechanisms, and why none of them answers this

We looked for an existing place to put "the music starts here". There is
none, but these are adjacent and you should know we considered them.

**`Offset` / `delay`.** `[Song] Offset` in `.chart` is the "Start time of
the audio, in seconds" (`Format-Overview.md:154`); `delay` in `song.ini`
"Delays the chart relative to the audio by the specified number of
milliseconds" (`song-ini/Standard-Tags.md:107`). These are the format's
lever for chart-versus-audio alignment, and they shift the **whole** chart.
They do not mark a musical start. They do bear on our padding, because
padding the audio and setting `delay` are two routes to the same alignment.

**Tempo anchors (`A` type code).** `.chart` can lock a tempo marker to an
absolute audio time in microseconds (`Format-Overview.md:271-280`):

```
768 = A 2250000 // 2.25 seconds
768 = B 60000   // 60 BPM
```

This is the closest thing in the format to the relation Option A wants — a
tempo marker at a stated point in the audio. But the format says it "is
typically only used for chart editing, and should be ignored otherwise", so
it can carry the song start between editors, not to the game.

**The `BEAT` track (`.mid` only).** Note 12 is "Measure beat", a downbeat,
and the track "marks where beats in the song are, separately from the tempo
and time signature" (`mid-format/Tracks/Beats.md`). This is the one place the
format agrees that the downbeat grid and the tempo map are distinct objects,
which is the premise of this spec. It has no `.chart` equivalent.

## Evidence: the format requires tick 0, practice does not put the song there

Measured over the raw bytes of 78,453 chart folders (62,697 `.chart`,
15,814 `.mid`) in `~/Desktop/chart-sources/enchor-songs` and
`~/Desktop/remaining-charts`, parsed independently of scan-chart:

| | `.chart` | `.mid` |
| --- | --- | --- |
| Tempo event at tick 0 | 100% | 100% |
| Time signature at tick 0 | 99.997% (2 missing) | **93.4%** (1,044 missing) |
| Exactly one signature, at tick 0, whole song | 46% | 54% |
| Constant tempo (one event, tick 0) | 9.3% | 17.0% |
| Tempo event exactly at the first note (sparse maps, ≤8 events) | 60% | 40% |

The first row is the format requirement, confirmed: a raw chart with no
tick-0 tempo is a spec violation, and there are none. The `.mid` signature
row is the 4/4 default in use — those 1,044 files rely on it.

But a *marker where the song starts* is not universal at all. 9–17% of
charts are constant-tempo with no second event anywhere, and roughly half
carry a single signature for the whole song. "The song starts at a marker"
is a convention we would be inventing, not one we would be following.

That is why we are not asking you to place a marker at the song start as
such. We ask you not to place one at tick 0 **in the `Synctrack`**, and to
tell us where the music begins.

## The contract we would consume

```ts
interface Synctrack {
  /** Option B only: the first downbeat of the MUSIC, in original-audio ms. */
  origin_ms: number;
  /** Option A: tempos[0].ms IS the song start. Nothing before it. */
  tempos: {ms: number; bpm: number}[];
  timeSignatures: {ms: number; numerator: number; denominator: number}[];
}
```

Unchanged: everything after the first downbeat, the beat tracking, the
piecewise fit, the meter picker, the ×2/÷2 correction. We ask about the
first event only.

## What we will do on our side

1. **Stop writing an opening we then have to detect.** When we pad, we emit
   the song's own tempo and meter at ms 0 and whole bars of lead-in, so the
   writer's tiers never fire and no construct is created.
2. **Delete the workarounds** the constructs forced on us: a persisted song
   start, a persisted "real opening" record, and the rules for telling an
   authored tick-0 event from a synthesized one.
3. **Write a tick-0 event that is true.** The event is mandatory, so we
   write one — the song's own opening tempo and meter, with the lead-in as
   whole bars of it. We attach no provenance and need none: a chart we
   export and import again behaves as it did before the round trip, and a
   chart from another author reads the same way as one of ours.

## Acceptance

A generated map for a song with `S` seconds of silence before the first
downbeat should satisfy:

1. No tempo or signature event before the first downbeat, in the
   `Synctrack` object.
2. Option A: `tempos[0].ms ≈ S * 1000` within one beat. Option B:
   `origin_ms ≈ S * 1000` within one beat.
3. On a song whose music starts at sample 0, the same values are `≈ 0` —
   the change is a no-op there, which is the case today's behavior is
   already correct for.
4. The existing accuracy metrics (beat/downbeat placement after the first
   downbeat) are unchanged. This is a change to what is emitted before the
   first downbeat, not a change to the fit.

A fixture we can both test against: the okgo chart already in our repo, whose
music starts about 1.6 s in.

## Open questions for you

1. Does anything else consume `origin_ms` in a way that Option B would break?
   We can see `ks-warp.ts` and `structural-correction.ts` read it on our
   side; we do not know the Python side's consumers.
2. Is the first downbeat available at that point with the accuracy this
   needs, or is it only as good as the bar-phase pick? If the latter, say so
   — we would rather have a stated confidence than a confident wrong number.

We withdraw a third question we had drafted — whether we should strip the
tick-0 construct on our side and leave the generator alone. The format
answers it: the tick-0 event is mandatory, so stripping it changes the
file's meaning to 120 BPM and 4/4. A consumer cannot remove it — and it
cannot ask where the event came from either, because provenance does not
survive a file.

That is the whole reason we want the values at tick 0 to be the real
opening. It is the only answer that is still correct after a round trip.
