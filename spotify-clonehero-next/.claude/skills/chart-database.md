---
name: chart-database
description: How the Chorus chart catalog is crawled, published to R2, and loaded by clients. Use when touching downloadDb, the chart dump manifest, chartsDataVersion, first-visit chart loading, or the update-chart-db workflow.
user_invocable: true
---

# Chart Database

The app needs every chart on Chorus/Encore available locally. It gets there in
two steps:

1. **A first-time visitor downloads a dump** — a snapshot of the catalog built
   by CI and hosted on R2.
2. **After that, each client updates itself** — it scans the Encore API from the
   browser for charts modified since its last scan and writes them to its own
   SQLocal database.

So the dump only ever matters to visitors with no local data. Refreshing it does
not push data to existing clients, and it must not try to.

## R2 layout

Published to the bucket behind `assets.musiccharts.tools`, alongside `models/`:

```
charts/manifest.json                     mutable pointer, Cache-Control: no-cache
charts/dumps/<version>/charts.json.gz    immutable, cached for a year
```

`<version>` is the run's start time with `:` and `.` replaced by `-`.

The manifest is the only mutable object and is **written last**, so a publish
that dies partway leaves clients on the previous dump. It carries both the dump
key and `lastRun`; read them together from one manifest snapshot. Fetching the
dump and the cutoff as two separate mutable objects can pair a dump with a newer
cutoff, which leaves a permanent hole in that client's database.

### Retention

Nothing in this repo deletes from the bucket — the publishing credentials have
no delete permission, and a failed delete after the manifest was written would
red-flag an otherwise good publish. Superseded dumps are expired by an R2
**bucket lifecycle rule** scoped to the `charts/dumps/` prefix.

That prefix exists for exactly this reason. A rule on `charts/` would also match
the manifest, and a bucket-wide rule would delete the ONNX models. Keep dumps
and the pointer in separate namespaces.

Retention has to comfortably exceed the publish interval: the rule expires by
age, so if publishing stops for longer than the window, the live dump is deleted
while the manifest still points at it and cold start breaks. 30 days against a
daily schedule is ~30 objects (~255MB, cents per year) and gives a month of
slack to notice a broken workflow.

## Code map

| Concern                                   | Location                                             |
| ----------------------------------------- | ---------------------------------------------------- |
| Keys, URLs, manifest type, client loading | `lib/chorusChartDb/chartDbAssets.ts`                 |
| Manifest construction, cache headers      | `lib/chorusChartDb/chartDbPublish.ts`                |
| Crawl + merge + paging                    | `lib/chorusChartDb/fetchNewCharts.ts`                |
| Crash-resume bookkeeping                  | `lib/chorusChartDb/rawRunFiles.ts`                   |
| CLI that builds a dump                    | `downloadDb.ts`                                      |
| CLI that publishes it                     | `scripts/uploadChartDb.ts`                           |
| Client cold start                         | `lib/chorusChartDb/database.ts` → `fetchInitialDump` |
| Schema version endpoint                   | `app/api/data/route.ts`                              |

## Commands

```bash
pnpm update:db                 # full crawl, ~400 paged requests
pnpm update:db --incremental   # seed from the published dump, fetch only changes
pnpm update:db --fresh         # ignore an interrupted run and start over
pnpm publish:db --dry-run      # gzip and print the manifest, no credentials needed
pnpm publish:db                # upload; requires the R2 secrets, so CI only
```

A crashed run resumes automatically: each run owns a `raw_db_files/run-<ts>/`
directory of per-response batch files plus a state file, and the next invocation
picks up the newest incomplete one.

## CI

`.github/workflows/update-chart-db.yml` — daily incremental at 08:00 UTC,
monthly full crawl on the 1st, plus `workflow_dispatch` with a mode picker.
Requires the repo secrets `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`,
`R2_SECRET_ACCESS_KEY`. Those live only in Actions — publishing is not a local
operation, and the deployed app needs no credentials because it reads the public
custom domain.

## Rules

- **`chartsDataVersion` is a schema version, not a data version.** Bump it only
  when the dump's _shape_ changes; every client wipes its database and
  re-downloads when it moves. A refreshed dump must never bump it.
- **Incremental runs only add and replace.** Charts deleted from Chorus survive
  until the monthly full crawl. Don't treat incremental output as authoritative
  for deletions.
- **Upload pre-gzipped with an explicit `Cache-Control`.** R2 compresses nothing
  on its own, and the manifest must never be served stale.
- **Don't add deletes to the publish path.** Retention is the bucket's job; see
  Retention above.
- **Never make the paging loop depend on how many charts were new.** A page can
  be entirely updates to songs already seen and still be followed by more pages;
  paging follows the chart id cursor.

## Pending cleanup

`loadChartDbDump` still falls back to the committed `public/data/charts.json`
when the manifest can't be read. That fallback, and the 74MB file itself, come
out once the workflow has published successfully at least once.
