# 0110 — Capture the chart fields the mirror drops

Status: todo

This plan started as "use album for ranking in `/find-music`". The album
feature did not survive review. What survived is the thing the investigation
exposed: **`upsertCharts` silently drops eleven fields the dump already
carries, and the only way to get any of them is a full catalog re-ingest.**

Since a re-ingest is the price of one field, it is also the price of eleven.
This plan pays it once.

## The cost is the bump, not the columns

`getUpdatedCharts` (`lib/chorusChartDb/database.ts:120-158`) scans from
`lastScanSession.completed_at` through `fetchNewCharts` — an incremental
`modifiedAfter` crawl. A new column reaches only rows modified since the user's
last sync:

| window | charts modified | share of catalog |
| ------ | --------------- | ---------------- |
| 7d     | 266             | 0.28% |
| 30d    | 1,121           | 1.18% |
| 90d    | 3,269           | 3.45% |
| 365d   | 16,780          | 17.7% |

About 1.2% of rows per month. A column added without a re-ingest is null on
~99% of a user's catalog for a year.

The only path that touches all 94,720 rows is `replaceChorusCatalog`
(`lib/local-db/chorus/index.ts:265-281`), gated on `CHART_DB_DATA_VERSION`
(`lib/chorusChartDb/chartDbAssets.ts:41`). Bumping it makes every existing user
re-download the dump — 9.06 MB gzipped, measured — and re-ingest the catalog.

Nor can a migration heal this the way `017` healed a normalization change:
`017` re-derived from raw strings already in the table, and these fields are in
no table.

So the unit of work here is not a column. It is a bump. The failure mode this
plan exists to prevent is **taking album now and wanting `diff_vocals` in three
months**, which costs a second 9 MB re-download for every user.

## What the dump carries and the mirror discards

`ChorusChartDbRow` (`lib/chorusChartDb/types.ts:99-117`) against the
`chorus_charts` columns:

**Metadata (3):** `album`, `genre`, `year`.

**Difficulty ratings (8):** `diff_band`, `diff_guitar_coop`, `diff_rhythm`,
`diff_vocals`, `diff_guitarghl`, `diff_guitar_coop_ghl`, `diff_rhythm_ghl`,
`diff_bassghl`. The mirror keeps only the five the page renders.

Take all eleven. None is read on the day it lands, and that is the point: the
next question about the catalog gets answered from data instead of from a
re-ingest.

**Do not take `pro_drums` or `five_lane_drums.`** Those were removed on
purpose — migration `021` dropped `has_pro_drums`, because the `pro_drums` ini
flag disagrees with scan-chart's observed `drumType` on roughly half the
catalog. Restoring them re-opens a decided question.

## What this unblocks

Not speculative, in each case a written-down deferral:

- Plan 0100 deferred difficulty and length filters, "gated on measuring `diff_*`
  coverage." Eight of the fourteen ratings are not in the browser to measure.
- `diff_vocals` is the only catalog-wide signal for which charts have vocals,
  next to the lyrics and vocals work.
- `diff_guitar_coop` and `diff_rhythm` are the co-op and rhythm tracks that
  `hasOtherInstruments` currently collapses into a single boolean.
- `album` answers "is album a usable join key" without another re-ingest.

## Work

1. **Migration `022`** — eleven columns on `chorus_charts`: `album` (text),
   `album_normalized` (text), `genre` (text), `year` (integer), and the eight
   `diff_*` as integers. All nullable, no defaults. A default would make an
   unknown rating indistinguishable from a real one.
2. **`upsertCharts`** (`lib/local-db/chorus/index.ts:51-76`) — map all eleven,
   with `album_normalized` from `normalizeStrForMatching` beside the existing
   `artist_normalized` / `name_normalized` lines.
3. **Bump `CHART_DB_DATA_VERSION` to 7.** This is the whole cost of the plan,
   and it must be a deliberate line in the diff, not a consequence.
4. **Nothing reads the new columns.** No `ChartRow` field, no `toChart` line,
   no `FindMusicChart` change, no index. Each of those belongs to the plan that
   has a use for it, and can be added incrementally once the data is present.

`year` will be null more often than it looks: `parseChartYear` drops free-text
values (`Unknown Year`, `1969 (September 26)`, `2000s`) for ~712 charts. Note
that where the column is declared, so a future reader does not read null as
"the dump has no year".

Storage on 94,720 rows: `album` 1,536 KB, `album_normalized` 1,391 KB, `genre`
967 KB, `year` 740 KB, eight integer columns ~2.9 MB. Roughly 7.5 MB added to a
browser OPFS DB.

## What the user sees

A full re-ingest is not silent. `replaceChorusCatalog` runs in a transaction
that also deletes `spotify_track_chart_matches`, so a `/find-music` user loses
cached matches and re-derives them.

Verify the existing re-ingest path actually reports itself — the `fetching-dump`
progress state exists in `database.ts` — and that a user who opens
`/find-music` mid-ingest sees progress rather than an empty table. This is the
one part of the plan with a real chance of a bad first impression, and it is
the part with no test today.

## Verification

- After migration `022` and a re-ingest, all eleven columns are non-null for a
  chart the dump populates them for.
- A chart whose dump row omits `diff_vocals` stores null, not 0.
- `parseChartYear` rejects (`Unknown Year`) store null and do not throw.
- `album_normalized` is derived by the same `normalize` the other normalized
  columns use, so migration `017`-style renormalization keeps working.
- Sort and ranking output in `/find-music` is byte-identical before and after.
  Nothing reads these columns; assert it, because a re-ingest changing results
  would otherwise be blamed on the new data rather than on the re-ingest.
- `spotify_track_chart_matches` repopulates after the re-ingest.

## Why album is not a feature here

Recorded so it is not proposed again. Measured across all 94,720 rows:

- Grouping on `(artist_normalized, album_normalized)` gives 40,335 groups, and
  **74.2% contain exactly one charted song.** A "what else from this album is
  charted" control would display "1" three times in four; median for the rest
  is 3.
- **4.0% of rows** carry a placeholder album (`Single` ×1,400, `Unknown Album`
  ×940, `N/A` ×279). `single` alone spans 945 distinct artists, so any
  album-only key merges unrelated artists — a key must be artist **and** album.
- **11.5% of rows** have an album that normalizes to the song title: the
  charter typed the song name into the album field.
- `RE_EDITION_SUFFIX` (`lib/local-db/normalize.ts:33`) needs a literal ` - `
  delimiter, so bare suffixes do not merge — `Meteora 20th Anniversary Edition`
  stays separate from `Meteora`. **912 same-artist album pairs** fail to merge,
  against 2,113 groups where normalization merges anything at all.
  `normalize('The Wall (Deluxe Edition)') === normalize('The Wall')` passes, but
  only because parentheses are stripped wholesale — it is not evidence the
  edition logic works.

For ranking, artist affinity is already 55 of the radar's 100 points
(`app/find-music/model.ts:90-93`), and album is largely a function of artist. A
correlated term re-ranks little, and the string quality above rules album out
as a join key. Capturing the column is worthwhile; building on it is not, until
something proves otherwise from the captured data.
