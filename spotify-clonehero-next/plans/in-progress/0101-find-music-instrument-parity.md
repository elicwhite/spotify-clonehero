# 0101 — Find Music instruments: parity with Enchor

Status: in progress — code landed, awaiting the republish and deploy

## Requirement

The instruments and intensities `/find-music` shows for a chart must match what
enchor.us shows for that chart. Not "be defensible" — match. Enchor is the
source our mirror is derived from, so any disagreement is our bug.

Regenerating the published dump, bumping `chartsDataVersion`, and forcing every
client to clear and re-cache is sanctioned for this work.

## Problem

Two charts, wrong in two different ways.

**`03cba4fc0e615fbedcce013db030b6ef`** — Papa Roach, "Never Enough", SuperDott.
Enchor: drums only, intensity 3. We render guitar 0, bass 0, keys 0, pro drums ?.

```
song.ini:  diff_drums = 3   diff_guitar = 0   diff_bass = 0   diff_keys = 0
scan of the .sng:  notesData.instruments = ['drums']   drumType = 1 (fourLanePro)
                   noteCounts = [ drums/expert: 1389 ]
dump row:          pro_drums = false   five_lane_drums = false   diff_drums_real = -1
```

**`9eca6d4f815d5d9ddb5db3fe133a6d31`** — Red Hot Chili Peppers, "Can't Stop",
highfine. Enchor: drums only, intensity 2. We render one badge: pro drums ?.

```
song.ini:  diff_drums = 2      (the only diff_* line in the file)
scan of the .sng:  notesData.instruments = ['drums']   drumType = 1 (fourLanePro)
dump row:          pro_drums = false   five_lane_drums = false   diff_drums_real = -1
```

### Defect 1 — `diff_* >= 0` is used as a presence signal

`upsertCharts` sets `has_guitar` from
`(diff_guitar != null && diff_guitar >= 0) || trackInstruments.has('guitar')`
(`lib/local-db/chorus/index.ts:63-77`). Intensity 0 is legal, so this cannot
distinguish "charted at intensity 0" from "song.ini carries a leftover
`diff_guitar = 0` for a part nobody charted". Papa Roach is the second case.

Presence and intensity are independent facts. `diff_*` answers only intensity.

### Defect 2 — the drums badge is backed by the wrong column

`INSTRUMENTS` (`app/find-music/types.ts:1-6`) has no plain-drums entry. The only
drums slot is `proDrums`, whose intensity reads `diff_drums_real`. Charters
rarely set it, so the badge renders `?` while `diff_drums` — the number Enchor
displays — sits unused in the same row.

Mirror-wide: 26,076 charts show a drums badge, 12,473 render `?`, and 12,090 of
those (97%) already have `diff_drums` populated.

`/spotify` and `/spotifyhistory` have the same defect independently, reading
`diff_drums_real` as the drums difficulty (`app/spotify/app/Spotify.tsx:340`,
`app/spotifyhistory/SpotifyHistory.tsx:371`).

### Defect 3 — the mirror drops the track-level fields

~~`filterKeys` discards `notesData.instruments` and `notesData.drumType`.~~
**Wrong when written, or fixed before it was read.** The published dump carries
both on all 94,720 rows, and so does the live API. Nothing had to change here.

`pro_drums` and `five_lane_drums` *are* already mirrored (`saveKeys`,
`fetchNewCharts.ts:158-159`) and populated on all 94,609 rows — but
`upsertCharts` ignores them, and see the open question below about whether they
mean what we need.

## What the data says

`trackHashes` is genuine per-instrument-per-difficulty data, not a truncation
artifact: difficulties distribute expert 137,875 / hard 52,330 / medium 50,723 /
easy 50,109, and the 55,045 single-entry charts are 50,729 guitar+expert — the
GH-era expert-only library. Only 11 charts have an empty array.

Dropping the `diff_* >= 0` clause deletes 20,660 badge-instances across 7,806
charts and adds none:

| Instrument | Lost (diff ≥ 0, no track) | of those, diff ≥ 1 | Kept via track (diff = −1) |
| --- | --- | --- | --- |
| guitar | 329 | 124 | 4,474 |
| bass | 6,819 | 2,539 | 978 |
| keys | 7,439 | 2,564 | 55 |
| drums | 6,073 | 2,554 | 389 |

The stale-song.ini story cleanly explains the 12,879 `diff = 0` losses. It does
**not** explain the 7,781 losses where a charter declared an intensity of 1 or
more for a part with no track (e.g. `6bd03e89…`: `diff_bass = 4`,
`diff_keys = 4`, `diff_drums = 4`, only a guitar track). Those are probably
phantoms too — a charter copying a full ini into a guitar-only chart — but that
is an inference, and it is the largest cohort. Phase 0 must sample it.

## Open questions — resolved by decision, not by observing Enchor

Enchor was never sampled. These were settled on the merits instead, which is
worth knowing if a parity gap turns up later.

1. **What drives the pro-drums marker?** `notesData.drumType`, not `pro_drums`.
   The ini flag is charter-declared and wrong on half the catalog: of 23,912
   charts that scan as `fourLanePro` it marks 11,407, and it claims pro drums on
   2,550 charts with no drums track at all. `drumType` is scan-chart reading the
   notes, and it is non-null on exactly the 25,598 charts that have a drums
   track — zero disagreements. Badges show `PRO` and `5L`; four-lane is
   unmarked.
2. **Intensity 0?** Presence comes from tracks, intensity from `diff_drums`
   independently, so a charted-at-0 instrument renders `0`.
3. **GHL-only charts?** They render "Other instruments" rather than nothing.

### Defect 4 — 1,046 charts would render zero badges (confirmed: 1,046)

`INSTRUMENTS` covers four instruments; the mirror carries tracks for
`guitarghl` (4,525), `rhythm` (4,329), `guitarcoop` (1,674) and `bassghl` (438)
that it cannot display. Under the new presence rule, 1,046 charts have no core
track at all and would render nothing — e.g. `1beea35c…` "Moves Like Jagger",
tracks `[guitarghl]`, `diff_guitar = -1`. Today the `diff >= 0` clause
accidentally gives some of these a guitar badge.

A blank instrument column is a *new* parity failure, created by this plan. It
cannot be waved off as out of scope under a requirement that says "match".

## Phase 0 — establish the parity target (blocking)

Nothing downstream is final until this completes.

1. **Capture what Enchor renders** for a named list covering every open
   question: `03cba4fc…` and `9eca6d4f…` (pro marker on a `pro_drums: false` /
   `drumType: 1` chart), a chart with a real intensity 0 on a charted track, a
   `pro_drums: true` chart, a five-lane chart, `1beea35c…` (GHL-only), and a
   `diff ≥ 1`-with-no-track chart such as `6bd03e89…`. Record the rendered
   instrument set and intensity for each. Requires a browser; produces the
   answers to all three open questions.
2. **Widen `saveKeys` and run `pnpm update:db`.** The dump generator
   (`downloadDb.ts:3`) calls the same `fetchNewCharts`/`filterKeys` as the
   client, so keeping `notesData.instruments` and `notesData.drumType` is a
   one-line change that both fixes the pipeline and *answers whether the API
   sends those fields at all*. Then diff `drumType` against `pro_drums` across
   the full catalog to size the disagreement measured on the two example charts.
3. **Build the regression fixture.** ~30 charts spanning drums-only,
   guitar-only, full band, `diff = 0` with a track, `diff = 0` without,
   `diff = -1` with a track, **`diff ≥ 1` without a track** (several charters),
   GHL-only, five-lane, pro drums, and no `notesData`. Download each `.sng`,
   scan with `scanChartFolder`, and record the expected rendering.

   This fixture is a *regression harness*, not a parity oracle — Encore ran the
   same scan-chart over the same files, so validating against it partly
   re-derives our own assumption. Step 1 is the oracle. The fixture's job is to
   keep the answer from step 1 from silently regressing later, at test time,
   with no network.

## Phase 1 — carry the authoritative fields

4. Land the widened `filterKeys` from Phase 0.2.
5. Migration 019 adds `has_drums`, `has_other_instruments` and `drum_type`;
   `upsertCharts` populates them. 020 indexes the group-revision lookup. 021
   drops `has_pro_drums` once its last reader is gone.
6. Republish the dump and bump `chartsDataVersion` to 6 so every client clears
   and re-ingests. The `has_*` columns cannot be recomputed by migration — the
   source fields are not stored — so this is the only path that heals the back
   catalog. **The existing dump cannot simply be re-uploaded:** its rows carry
   free-text years that the publisher now rejects, so the release runs
   `pnpm update:db --incremental` first, which re-narrows the seeds.

## Phase 2 — one presence rule, one drums badge

7. **Presence from tracks only.** `has_*` becomes
   `instruments.includes(x) || trackHashes.some(t => t.instrument === x)`,
   dropping the `diff_* >= 0` clause. Add `has_drums` on the same basis.
8. **Replace `proDrums` with `drums` in `INSTRUMENTS`**, presence from
   `has_drums`, intensity from `diff_drums`. Whether a pro/five-lane marker
   rides along, and off which field, is decided by Phase 0.1.
9. **Handle the 1,046 blank rows** per Phase 0.1's answer — either add the
   6-fret/rhythm/coop instruments to `INSTRUMENTS`, or render an explicit
   "other instruments" state. Not "nothing".
10. **Retire `diff_drums_real`** from presence and display. It stays mirrored;
    nothing reads it.
11. **Migrate the persisted filter.** `filterPersistence.ts` validates saved
    instrument ids against `FILTER_INSTRUMENTS`, so renaming `proDrums` → `drums`
    silently drops a user's saved drums filter. Map the old id on load.

## Phase 3 — collapse the duplication

12. The `diff_* >= 0 || has_* = 1` test is copy-pasted into four places:
    `queries.ts:551-558` (radar instrument-coverage score), `model.ts:141-146`
    (instrument filter), `FindMusicTable.tsx:846-851` (badges), and
    `FindMusicTable.tsx:726-733` (evidence tooltip). Extract one predicate over
    `FindMusicChart`; all four call it.
13. Point `/spotify` and `/spotifyhistory` at `diff_drums` so the three pages
    agree.

## Sequencing against plan 0100

0100 is complete. Migrations 017/018 landed with it, so this plan's are 019-021.

0100 defers difficulty and length filters "gated on measuring `diff_*`
coverage". This plan produces that measurement; revisit them after, not before.

## Acceptance criteria

- Every chart in the Phase 0 fixture renders the instrument set and intensities
  recorded from Enchor in Phase 0.1.
- `03cba4fc…` renders exactly one badge: drums, intensity 3.
- `9eca6d4f…` renders exactly one badge: drums, intensity 2.
- Both show a `PRO` marker: they scan as `drumType: 1`.
- No chart renders a badge for an instrument with no charted track.
- No chart renders `?` when the corresponding `diff_*` is `>= 0`.
- No chart renders an empty instrument column.
- Presence is decided by one predicate, one call site per consumer.
- `/find-music`, `/spotify`, and `/spotifyhistory` show the same drums intensity.
- Tests cover: `diff = 0` with a track, `diff = 0` without, `diff = -1` with a
  track, `diff ≥ 1` without, each drum type, and the `proDrums` → `drums` filter
  migration.

## Out of scope

- Vocals. The mirror stores `diff_vocals` but no vocals track appears in
  `trackHashes`, so presence would have no signal under the new rule.
- Re-deriving a drum type for charts where the API omits one. Show drums with no
  marker rather than guessing.

## What is left

The code has landed. What remains is external:

1. `pnpm update:db --incremental` to regenerate the dump under the current row
   contract.
2. Publish it from CI and verify the manifest and checksum.
3. Only then deploy, so no client meets a manifest that predates generation 6.

Phase 0.3's ~30-chart regression fixture was never built. The unit tests cover
the presence rule and drum types, but nothing pins the rendering against real
`.sng` scans.
