# 0114 — Serialize local database migrations across tabs

Status: completed

## The bug

A user opened Find Music and every source card failed at once: the Chorus index
card went degraded, and the Spotify Library card said the refresh failed. Their
console showed the cause:

```
Running database migrations...
Migration failed: Error: SQLITE_ERROR: sqlite3 result code 1: duplicate column name: artist_normalized
Failed to initialize local database: ...
Running database migrations...
Migrations completed: Array(21)
Local database initialized successfully
```

One migrator failed on a duplicate column. A second one then ran all 21
migrations and succeeded.

## Root cause

Kysely's SQLite adapter assumes one connection. Both assumptions it makes are
wrong for SQLocal over OPFS.

`node_modules/kysely/dist/cjs/dialect/sqlite/sqlite-adapter.js`:

- `supportsTransactionalDdl` returns `false`. So `#runMigrations` takes the
  `db.connection()` branch, not `db.transaction()`. Each migration commits on
  its own; a failure part-way leaves earlier ones committed.
- `acquireMigrationLock` and `releaseMigrationLock` are no-ops. The comment says
  why: *"SQLite only has one connection that's reserved by the migration system
  for the whole time between acquireMigrationLock and releaseMigrationLock."*

Every tab opens its own SQLocal connection to the same OPFS file, and
`initializeDatabase` in `lib/local-db/client.ts:50` runs `migrateToLatest` with
no lock of any kind. `getLocalDb()` guards against concurrent callers inside one
tab, but nothing guards across tabs.

With two migrators on one file:

1. Both read an empty `kysely_migration` table, so both start at `001`.
2. `001`–`003` use `.ifNotExists()`, so the trailing migrator passes through them
   with no error and no record that it did nothing.
3. `004_local_charts_normalized.ts:8` runs
   `ALTER TABLE local_charts ADD COLUMN artist_normalized`. `ALTER TABLE` has no
   `ifNotExists`. The leading migrator already committed that column, so the
   trailing one throws `duplicate column name: artist_normalized`.
4. The loser's `getLocalDb()` rejects. Every feature fails together, because they
   all go through it.
5. The winner completes all 21 migrations.

## What is confirmed, and what is not

Confirmed: the missing lock and the missing transaction are real, and any second
migrator on the same file breaks the run this way. That defect is worth fixing on
its own.

Not confirmed: what produced the second migrator for this user. Two facts limit
what can be concluded.

- Both the failure and the successful 21-migration run appear in **one console**,
  so both migrators ran in the same page context. A second browser tab would have
  its own console. The reporter also said they did not think they had another tab
  open, and only `/find-music` and `/test-sqlocal` open this database —
  `WebMCPTools` in the root layout touches it only inside a `navigator.modelContext`
  tool callback, so ordinary pages hold no connection.
- Restarting the browser cleared it, with no code change. So the bad state was a
  live connection or worker held in memory, not corruption written to disk.
  On-disk corruption would have survived the restart.

One same-tab path that fits both facts: a reload or a `Try again` while a
migration was in flight, where the previous page's SQLocal worker still held the
OPFS file as the new one opened. `getLocalDb()` also clears
`dbInitializationPromise` on failure (`client.ts:112`), so a later caller builds a
second client.

That path is unverified. Do not write it into a code comment as the cause. Plan
0113 supplies the reporting that would settle it.

The catalog install already protects itself this way — `withCatalogLock` in
`lib/chorusChartDb/database.ts:186` wraps it in a `navigator.locks` request.
Migrations never got the same treatment.

## The fix

Wrap the whole of `initializeDatabase` in a `navigator.locks` exclusive request,
on a lock name distinct from the catalog lock. The second tab then waits, reads
a fully migrated `kysely_migration` table, and has nothing to do.

The lock helper is currently private to `lib/chorusChartDb/database.ts`. Move it
to a shared module so both callers use one implementation, and update both
imports directly — no re-export shim.

`getCatalogLocks()` returns `undefined` when `navigator.locks` is missing. The
catalog path treats that as fatal. Decide the same question for migrations and
write the answer down: either fail with a clear message, or run unlocked and
accept the single-tab case.

### Not in this plan: making the ALTER migrations tolerant

An earlier draft also made every `ALTER TABLE ... ADD COLUMN` skip a column that
already exists. That is dropped. The lock explains the reported failure on its
own, and the reporter's database recovered by itself once the browser restarted,
so no persistently broken schema was ever observed. Guarding against a state with
no evidence behind it would also hide a real authoring mistake — two migrations
adding the same column would silently pass instead of failing loudly.

There is a separate, reachable hazard with a mechanism we can name: a
multi-statement migration interrupted part-way commits some statements and
records nothing, because `supportsTransactionalDdl` is `false`. Plan 0115 covers
that on its own evidence.

## A second bug, found while testing this

`getLocalDb` cached the in-flight open in `dbInitializationPromise` and cleared it
from `openAndMigrate`'s `catch`, so a later caller could retry. That ordering is
wrong. `openAndMigrate` runs its `catch` before `getLocalDb` has assigned the
promise, so the reset is immediately overwritten by the rejected promise. Every
later caller then receives that same first rejection, and only a reload clears
it.

This is why `Try again` did nothing for the reporter, and why reopening the
browser was what fixed it. Move the reset to after the `await` in `getLocalDb`,
keeping an identity check so a slow failure cannot discard a newer attempt.

## Verification

- A unit test that `getLocalDb` opens and migrates inside the lock, and one that
  it still opens the database when Web Locks are unavailable.
- A unit test that a failed open is retried rather than replaying its first
  rejection.
- In the browser: open `/find-music` in two tabs at the same time with a cleared
  OPFS, and confirm both reach a working state with no console error. Use the
  `check-opfs` skill to inspect the resulting database.
- In the browser, the same-tab case: clear OPFS, load `/find-music`, and reload
  hard while migrations are still running. Repeat several times. No reload may
  produce `duplicate column name`. This is the path that best fits the report, so
  it is the one that must be seen to pass.

## Out of scope

The `Failed to execute 'transaction' on 'IDBDatabase': The database connection
is closing` error in the same report. That comes from `idb-keyval`, used only by
`lib/local-songs-folder/index.ts` and `lib/spotify-sdk/SpotifyFetching.ts`. It
needs its own diagnosis, and plan 0113 is what will supply the data for it.
