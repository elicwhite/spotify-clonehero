# Bug report: `simplify_roll` is a no-op in deployed HOPCAT (C3toolbox.py)

**Status**: confirmed against source, reproduced with a concrete example.
Not fixed upstream (this is a report, not a patch) — this repo's own
TypeScript port deliberately does NOT reproduce this bug (see "This repo's
handling" below).

**Affected file**: `scripts/C3toolbox.py` in the HOPCAT REAPER-script
distribution (checked out locally at `~/projects/HOPCAT/scripts/C3toolbox.py`).

**Functions**: `count_notes` (line 257) and `simplify_roll` (line 2423).

## Summary

Any drum chart region marked with a "Drum Roll" (MIDI pitch 126) or "Cymbal
Swell" (pitch 127) marker is supposed to be replaced, per tier, with a
simplified mechanical pattern (a single alternating 1/16 roll, or an
alternating two-lane swell) when HOPCAT's `reduce_5lane` difficulty reducer
runs. **In the actual deployed tool, this never happens.** Two chained bugs
cause `simplify_roll` to always bail out before doing anything, on every
roll/swell region, in every chart. The net effect: roll/swell-marked
regions are reduced to Hard/Medium/Easy completely unchanged from Expert —
the opposite of what the feature is supposed to do, and a meaningfully
worse (much harder) result for the player than the tool's own UI describes.

## Root cause

### Bug 1 — `count_notes` doesn't sort by note count at all

`C3toolbox.py:257-282`:

```python
def count_notes(array, start, end, notes, what, instrument):
    ...
    array_count = {}
    for x in range(0, len(array)):
        ...
        if (((start or end) and array[x][1] >= start and array[x][1] <= end) or (start == 0 and end == 0)) and ((what == 0 and array[x][2] in notes) or (what == 1 and notes_dict[array[x][2]][1] in notes)):
            if str(array[x][2]) in array_count:
                array_count[str(array[x][2])]+=1
            else:
                array_count[str(array[x][2])]= 1

    array_count = sorted(array_count, key=operator.itemgetter(1), reverse=True)
    return array_count
```

`array_count` is a **dict** keyed by the note's pitch **as a string** (e.g.
`"97"`, `"100"`), with the note's occurrence count as the value. The
function name and every caller's usage implies "return the pitches sorted
by how often they occur." But `sorted(array_count, ...)` iterates a dict's
**keys**, not `(key, value)` pairs — the count values are never even looked
at. `operator.itemgetter(1)` is then applied to each **string** key, which
returns that string's 2nd character (index 1). So `"97"` sorts by `"7"`,
`"100"` sorts by `"0"`, etc. The result is a list of pitch-strings sorted
by an essentially arbitrary character, not by frequency.

Verified directly: for a dict `{"97": 3, "98": 1, "96": 5, "100": 2}` (i.e.
pitch 96 is genuinely the most common, 5 occurrences), `count_notes` returns
`['98', '97', '96', '100']` — pitch 96 (the true most-common note) is
**third**, not first.

### Bug 2 — `simplify_roll` treats the first character of that string as a pitch

`C3toolbox.py:2483-2496` (the Drum Roll / pitch-126 path; the Cymbal Swell /
pitch-127 path at `:2511-2534` has the identical bug):

```python
note_count_array = count_notes(array_notesevents[0], start, end, [leveltext], 1, instrument)
if len(note_count_array) > 0:
    note_count = list(note_count_array[0])
    note_marker = int(note_count[0])          # <-- line 2486
    for j in range(0, len(array_notesevents[0])):
        note = array_notesevents[0][j]
        if note[1] >= start and note[1] <= end and note[2] == note_marker:
            if note_template == []:
                note_template = list(note)
            array_notestoremove.append([note[2], note[1]])
    ...
    if note_template == []:
        continue
```

`note_count_array[0]` is one of those pitch-strings (e.g. `"100"`).
`list(note_count_array[0])` splits it into characters: `['1', '0', '0']`.
`note_count[0]` is `'1'`, and `int('1')` is `1`. **`note_marker` is always a
single digit (0-9) taken from the first character of whichever pitch-string
happened to sort first** — never a real MIDI pitch. Real drum gem pitches
are all ≥60 (Expert gems are 96-100; Hard/Medium/Easy after cascade are
84-88/72-76/60-64). A single digit 0-9 can never equal any of them, so the
`note[2] == note_marker` check on line 2489 never matches for any note,
`note_template` stays `[]`, and the function hits `continue` at line 2496
(swell path: line 2534) — **skipping the entire "add a substitute pattern"
step**. Nothing is added, and — critically — nothing was removed either
(the removal loop above also depends on `note[2] == note_marker` matching,
which it never does), so the original notes are left completely untouched.

This is not mitigated elsewhere: `remove_notes` (`C3toolbox.py:1469-1667`,
the grid-quantization thinning pass every tier runs) **explicitly exempts**
any note covered by a roll/swell marker span from quantization
(`C3toolbox.py:1532-1553`, the `roll_note_ticks` check). That exemption
exists on the assumption that `simplify_roll` will handle those notes
separately with its own mechanical substitution. Because `simplify_roll` is
a no-op, roll/swell regions are exempted from thinning AND never
substituted — they pass through every tier at full Expert density.

## Concrete reproduction

Using an anonymized fixture from this repo's own parity-test corpus
(`lib/drum-difficulty/__fixtures__/reduction-06/notes.mid` — 18 Drum Roll
markers, 1 Cymbal Swell marker; see that directory's `MANIFEST.md`).

First Drum Roll marker in that file: **ticks 395520–401880** (480
ticks/beat). Inside that span, the Expert track contains **107 consecutive
sixteenth-note gems, all on the same pitch (100 = Expert green)**:

```
tick 395520, pitch 100, dur 60
tick 395580, pitch 100, dur 60
tick 395640, pitch 100, dur 60
...  (every 60 ticks)
tick 401880, pitch 100, dur 60
```

**What deployed HOPCAT actually produces** (per the bug above — roll notes
exempted from `remove_notes`, never substituted by `simplify_roll`):

| Tier | Notes in this span |
|------|---------------------|
| Hard | 107 (unchanged, same 16th-note density as Expert) |
| Medium | 107 (unchanged) |
| Easy | 107 (unchanged) |

An "Easy" chart with a 107-note unbroken 16th-note stream on one pad is
obviously not what the feature is supposed to produce — it's the same
density as Expert, in the tier meant for beginners.

**What `simplify_roll` is supposed to produce** (per its own visible logic
once the `note_marker`/`note_count` bug is fixed — i.e. what a correct
implementation of the function's evident intent does): a substitute pattern
on the correctly-identified most-common pitch (100, i.e. genuinely the sole
pitch here), spaced by `LEVEL_DIVISION[tier]` (`C3toolbox.py`'s
`leveldvisions_array`: Hard→1/8, Medium→1/4, Easy→1/2):

| Tier | Spacing | Notes in this span |
|------|---------|---------------------|
| Hard | every 240 ticks (1/8) | 27 |
| Medium | every 480 ticks (1/4) | 14 |
| Easy | every 960 ticks (1/2) | 7 |

(Counts derived from the source's own loop: `location = start; while location
< end + 20: ...; location += sequence`, `sequence = correct_tqn*4*DIVISIONS[level_division]`,
over the span's 6360-tick length + the 20-tick tail the loop always includes.)

## Suggested fix (for whoever maintains C3toolbox.py)

The minimal fix is entirely inside `count_notes`: sort the dict's
**items**, by **value**, not the dict's keys by a character slice:

```python
# current (broken):
array_count = sorted(array_count, key=operator.itemgetter(1), reverse=True)
return array_count   # -> list of pitch STRINGS, sorted by their own 2nd char

# fixed:
array_count = sorted(array_count.items(), key=operator.itemgetter(1), reverse=True)
return [pitch for pitch, count in array_count]   # -> list of pitch strings, sorted by count desc
```

With that one change, `note_count_array[0]` and its callers throughout the
file (not just `simplify_roll` — `count_notes` is also called elsewhere,
e.g. `C3toolbox.py:2116`) would receive the actual most-common pitch
string, and `simplify_roll`'s existing `int(note_count[0])` line would
still need a companion fix (it should be `int(note_count_array[0])`, i.e.
convert the whole pitch string to an int, not just its first character —
the current `list(note_count_array[0])` / `note_count[0]` character-split
is unnecessary and wrong regardless of the sort bug).

## This repo's handling

This TypeScript port (`lib/drum-difficulty/hopcat/reduceNotes.ts`,
`simplifyRoll`/`mostCommonPitches`) implements the **intended, working**
behavior shown in the "supposed to produce" table above, not the real
deployed no-op. This divergence from as-deployed HOPCAT was found via a
source-fidelity review (2026-07-22) and confirmed with Eli: **kept
deliberately**, on the reasoning that reproducing a dead-code no-op
produces a less useful product comparison than a working reduction. See
the doc comment directly above `simplifyRoll` in `reduceNotes.ts` for the
in-code record of this decision. Every other HOPCAT quirk this port
reproduces (the `unflip_discobeat` always-truthy companion-note check, the
asymmetric measure-relative/absolute-tick two-pass tolerance in
`remove_notes`, etc.) is preserved exactly as deployed — this is the one
intentional exception.
