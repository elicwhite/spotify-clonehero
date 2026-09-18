# 0129 — Give a bricked local database a way out

Status: todo

Related: 0115. Not a dependency — see "What 0115 must record" below. Neither
plan waits on the other.

## The two failures are less alike than they look

Both are SQLite errors from the local database on `/find-music`, and it is
tempting to treat them as one bug. They are not, and the difference decides the
whole design.

**[FRONTEND-CZ](https://clone-hero-chart-tools.sentry.io/issues/FRONTEND-CZ)** —
`duplicate column name: artist_normalized`. 73 events since 2026-07-08, 51 on the
current release. `migrateToLatest` fails, so `getLocalDb()` rejects and every
feature that awaits it fails together. The half-applied `005` hazard; plan 0115
owns the cause.

**[FRONTEND-EY](https://clone-hero-chart-tools.sentry.io/issues/FRONTEND-EY)** —
`table chorus_scan_sessions has no column named scan_since_time`. 4 events. **The
database opens perfectly well.** `createScanSession` is reached from
`lib/chorusChartDb/database.ts:139`, inside a transaction taken after a
successful `getLocalDb()`. `FindMusicClient.tsx:250` catches it, sets
`catalogState = 'degraded'`, and shows the message on the Chorus card. The page
works; one source is dead.

So there is no single "wedged database" state. CZ is a dead page with no live
SQLocal client. EY is a healthy page, a live client, a worker holding the OPFS
file, and one broken table. Anything written as if one description covers both
will be wrong for one of them.

## Root cause of FRONTEND-EY

`migration_002_chorus_charts` was edited twice after it had shipped, so three
`chorus_scan_sessions` shapes exist in the wild:

- `517273af` (2025-09-20 20:38) — `session_id TEXT NOT NULL UNIQUE`,
  `data_version INTEGER NOT NULL`, `error_message`, three `total_*` columns.
- `59cc162a` (2025-09-20 21:46) — same, minus `data_version`.
- `f7e59e9f` (2025-09-21 00:59) — the current shape: those gone,
  `scan_since_time TEXT NOT NULL` in their place.

A browser that ran either earlier version has `002_chorus_charts` recorded in
`kysely_migration`, so the rewrite never runs, and the `.ifNotExists()` on the
`createTable` would no-op even if it replayed. `createScanSession`
(`lib/local-db/chorus/scanning.ts:11`) then writes `scan_since_time` into a table
that has no such column.

The window between first and last edit is about four hours on one night. The
affected population is tiny and may be one developer's own browser.

## Why patching the table in place does not work

Measured against the real `517273af` DDL:

```
after ALTER TABLE ADD COLUMN scan_since_time
  insert                          → NOT NULL constraint failed: session_id
  insert supplying session_id     → NOT NULL constraint failed: data_version
  ALTER TABLE DROP COLUMN session_id
                                  → cannot drop UNIQUE column
  DROP INDEX sqlite_autoindex_…_1 → index associated with UNIQUE or PRIMARY KEY
                                     constraint cannot be dropped
```

`createScanSession` writes neither `session_id` nor `data_version`. Adding the
missing column moves the failure two columns right, the blocking columns cannot
be dropped, and the implicit unique index cannot be dropped either.

That leaves two repairs, not one:

- **`DROP TABLE` then re-create** at the current shape. Simplest. Loses the rows,
  which is fine — it is scan bookkeeping. **It also loses
  `idx_chorus_scan_sessions_status` and `idx_chorus_scan_sessions_started_at`
  permanently** (`002_chorus_charts.ts:73,80`), because 002 never replays.
  Verified: after `DROP TABLE`, both indexes are gone from `sqlite_master`. Any
  drop-and-recreate must recreate the indexes too, or it trades a broken table
  for a slow one.
- **The 12-step rebuild** — new table at the current shape, `INSERT … SELECT`,
  drop, rename, recreate indexes. Preserves the rows and forces the indexes to be
  written down. More code for bookkeeping nobody reads.

Prefer the first, with the indexes recreated explicitly. Choose the second only
if the old rows turn out to matter, which they almost certainly do not — a real
production database holds 21 rows in this table against 94,971 charts and 30,231
history rows elsewhere. That ratio is also the argument for doing Phase 2 at all:
`022` discards 21 bookkeeping rows, where sending an EY user to the Phase 1 reset
discards their whole 95k-chart mirror.

## Phase 1 — a reset the user can reach — DONE

Shipped. `resetLocalDb` in `lib/local-db/client.ts`, the Reset row in
`app/storage/StoragePanel.tsx` (anchored at `#song-library-database`, named
once in `app/storage/routes.ts`), and the `/find-music` card that links to it
when `getLocalDb` rejects with a `LocalDbUnavailableError`.

Two bullets below were **not** built, and are still open:

- **The raw export.** A CZ user still cannot take a copy of the file before
  discarding it.
- **The cross-tab close signal.** A second tab holding a live client still
  blocks the delete. The confirmation says so in words instead, which is the
  weaker half of the choice the bullet offers.

One thing the design did not anticipate: the anchor alone does not work. Every
row is drawn from a reading taken after mount, so the browser processes the
fragment while the page is still empty and leaves the user at the top.
`StoragePanel` scrolls to the named row itself once the reading arrives.

What follows is the design as written; kept because Phase 2 and Phase 3 still
refer to it.

Put the action in `app/storage/StoragePanel.tsx`.

It is reachable in exactly the situation it must rescue: nothing in `app/storage`
or `lib/project-storage` calls `getLocalDb`. `storedProjects.ts` imports
`LOCAL_DB_PATH` only, which is why `lib/local-db/path.ts` exists as a separate
module, and `readStorage()` catches per-reading failures rather than rejecting.
The page already reports the database size and already has the confirm-then-delete
pattern (`deleteStoredProject`, `deleteStemEntry`, `deleteCachedModels`).

**Two entry points, because there are two failures:**

- CZ: `getLocalDb()` rejects, so `/find-music` needs a page-level error state
  that names the failure once and links to `/storage`, instead of six cards
  failing separately.
- EY: the page renders fine and only the Chorus card degrades. A page-level state
  keyed on `getLocalDb()` never fires. The link has to hang off the degraded
  Chorus card (`FindMusicClient.tsx:830`), or EY users never see it and **Phase 1
  moves EY's event count by zero.**

Mechanics, none of them free:

- **Export before discard.** The plan below deletes a file the user cannot
  otherwise retrieve: `overwriteLocalDbFile`, `exportLocalDbFile`, and
  `runRawSql` all `await getLocalDb()` first, so on a CZ database none of them
  run. A raw export needs no SQLocal at all — `root.getFileHandle(LOCAL_DB_PATH)`
  then `.getFile()`, the same call `localDbExists` already makes at
  `client.ts:24`. Offer it beside the reset.
- **Close the live client first.** On an EY database `sqlocalClient` is live and
  its worker holds the file. `closeSqlocalClient` (`client.ts:152`) is not
  exported, so Phase 1 needs an exported reset entry point in `client.ts` rather
  than reaching into OPFS from the storage page. On a CZ database the close is a
  no-op, because `openAndMigrate`'s catch already nulled and destroyed the
  client — but the reset cannot assume that, and must not be written as if it
  could.
- **Delete the sidecars.** A surviving WAL can fail the reset or resurrect the
  schema being discarded. They are not always present, though: a real production
  database reports `journal_mode=delete` with no `-wal` or `-shm` beside it, so
  the reset must treat an absent sidecar as success rather than as a failure.
- **Clear `dbInitializationPromise` in both states.** For CZ it holds a cached
  rejection that would replay. For EY it holds a *resolved* promise over a
  Kysely whose file no longer exists, which is the more dangerous of the two.
- **Other tabs are not covered by the lock.** `LOCAL_DB_MIGRATION_LOCK` is held
  only around open-and-migrate. A second tab sitting on a live client — the EY
  case exactly — holds the OPFS file and is not waiting on that lock. Either
  broadcast a close signal, or detect the failure and say plainly that other tabs
  must be closed. Do not let the lock bullet imply a protection it does not give.
- **Confirm whether OPFS will `removeEntry` a file a worker holds a sync access
  handle on.** Establish this before designing around it; it decides whether the
  close above is a courtesy or a precondition.
- **Say whether `drum-fills.sqlite3` is in scope.** The same page measures it
  (`storedProjects.ts:26`) and it has the same failure class. In or out, but
  stated.
- **Tag the reset in Sentry.** "Resolved, then watched for regression" needs
  something to watch.
- **Never automatic.** A migration bug that silently ate a multi-gigabyte mirror
  on every load would be worse than the bug it recovered from.

## Phase 2 — repair `chorus_scan_sessions`

Do this, do not hedge it. The previous draft made Phase 2 conditional on a
question nothing would ever answer, which is how work quietly disappears. Four
events is small, but Phase 1 does not fix them: EY users have a working page and
no reason to visit `/storage`, and telling someone to delete their whole Chorus
mirror to fix a table of scan bookkeeping is a bad trade.

Migration `022`: when `scan_since_time` is absent from
`pragma_table_xinfo('chorus_scan_sessions')`, drop the table, re-create it at the
current shape, and **re-create both indexes**. Guarding on the column covers the
`517273af` and `59cc162a` shapes at once, so `data_version` needs no separate
handling. Give it a `down()`, as every other migration has.

**Drop with `.ifExists()`.** `pragma_table_xinfo` returns zero rows for a table
that does not exist, which is indistinguishable from one that exists without the
column — so the guard fires on a database where `002` died before creating
`chorus_scan_sessions` at all, and a bare `dropTable` then throws `no such
table`. That would turn a degraded page into a dead one: the exact failure this
plan exists to end, caused by the plan's own repair. One word prevents it.

This design was written as `022`, run against synthetic `517273af` and
`59cc162a` databases and against a copy of a real 95k-chart production database.
Both synthetic shapes reproduce FRONTEND-EY before the repair and accept
`createScanSession` after it, both indexes return, a second run is a no-op, and
the guard correctly does **not** fire on the real database — its 21 scan-session
rows survive untouched. The design is verified; only the `ifExists` gap was
found.

The `NOT NULL` `ADD COLUMN` question does not arise once the table is rebuilt.
Recorded so nobody re-derives it: SQLite accepts `ADD COLUMN … NOT NULL` on an
empty table, and on a populated one needs a constant default — `DEFAULT ''`
works, `DEFAULT CURRENT_TIMESTAMP` does not.

## Phase 3 — stop shipped migrations from being edited

Not a content-hash manifest. Migration files are legitimately edited for
mechanical reasons — `3e179170` touched `004` for an unused-imports lint rule,
`bf544d15` rewrote `010`–`012` when drum-fills moved to its own database, and 8
of 21 migration files have more than one commit. A hash manifest would fail on
all of those and teach "just update the hashes," which is how the guard dies.

Commit a **schema snapshot** instead: run `migrateToLatest` against
better-sqlite3 — the harness at `migration-execution.test.ts:16` already exists —
dump `sqlite_master`, and compare to a golden file. It ignores formatting and
imports entirely, and turns a deliberate schema change into a reviewable diff.

Two things about it were checked against a real production database rather than
assumed:

- **The golden file describes what real users actually have.** A `sqlite_master`
  dump of a real 66 MB database created in 2026-08 is byte-identical to one from
  a fresh `migrateToLatest`, in natural order and sorted, across repeated runs.
  A snapshot taken from a fresh migration is not a fiction no user matches.
- **Dump `(type, name, tbl_name, sql)` and not `rootpage`.** `rootpage` matched
  too, but only because the statement order happened to agree. It is the one
  column that would make the test flaky.

State its limit honestly: it catches a shipped-migration edit that changes the
**final** schema. An edit a later migration erases produces no diff — `bf544d15`
rewrote `010`–`012` into no-op stubs that `013` then drops, and both the old and
new sets end at the same schema. That edit is one this guard should tolerate, so
the limit is acceptable; claiming the guard catches all edits would not be.

`migration-compatibility.test.ts` does not already cover this. It is specific to
migration `014`, which was reverted after shipping — the second instance of this
same mistake. 002 is the third.

## What 0115 must record

0115's two candidate fixes are not equivalent for databases that are already
broken:

- **Idempotent `ADD COLUMN`** repairs a half-applied `005` on the next load, and
  FRONTEND-CZ's existing population recovers by itself.
- **Transactional DDL** prevents new breakage and leaves that population bricked
  forever, recoverable only through Phase 1 here.

0115's `table_xinfo` claim is now tested rather than reasoned: on a real
database `table_info` reports 0 generated columns and `table_xinfo` reports 1
(`hidden=2`, VIRTUAL) on `chorus_charts`, `spotify_tracks` **and
`local_charts`** — a third table 0115 does not name. An idempotent `ADD COLUMN`
probing with `table_info` would fail on `duplicate column name: artist_bucket`
on all three, so the helper has to be table-agnostic and has to use `xinfo`.
0115's Phase 1 reproduction was also confirmed achievable: rewinding `005`'s
columns on a real database and replaying reproduces FRONTEND-CZ exactly.

Either fix is defensible; picking one without noticing the difference is not.
0115 must write down which it chose and why. Phase 1 here does not wait on that
decision — it is the escape hatch either way — but if 0115 picks transactions,
Phase 1 becomes the only fix those users will ever get.

## What is not yet measured

The counts above are events, not people. Six cities is IP geolocation, not six
users. Before sizing anything, pull distinct users per issue and check whether
current-release CZ events come from browsers first seen before or after
`beeab98d` (2026-08-16, the 0114 cross-tab lock). That distinguishes a legacy
cohort draining away from a population 0115's mechanism is still adding to — and
that mechanism is still live, since a tab closed mid-`005` bricks a database on
the current release.

The lock itself is not suspect. `SQLocalKysely` is constructed for
`LOCAL_DB_PATH` in exactly one place (`client.ts:96`), reached only through
`initializeDatabase`, which always takes `LOCAL_DB_MIGRATION_LOCK` where
`navigator.locks` exists. `lib/drum-fills/db/client.ts:39` opens a different
file. No worker opens this database.

## Effect on the Sentry numbers, stated honestly

- **EY (4 events)** — closed by Phase 2. Phase 1 alone does nothing for it unless
  the Chorus-card entry point above is built.
- **CZ (73 events)** — closed by 0115 if it picks idempotent `ADD COLUMN`. If it
  picks transactions, Phase 1 only lets each affected user recover once they find
  `/storage`, so the count declines slowly rather than stopping.

If neither of those holds, this plan has not earned its place. Check the numbers
after it ships rather than assuming.

## Verification

- A unit test that builds `chorus_scan_sessions` in the `517273af` shape and the
  `59cc162a` shape, runs `migrateToLatest`, and asserts `createScanSession` then
  succeeds in both — and that both indexes exist afterwards.
- A unit test that runs `022` twice and asserts the second run is a no-op.
- The schema-snapshot test failing on a deliberate edit to a shipped migration.
- The reset exercised against both states: a half-migrated database that will not
  open, and a healthy database with a live client. Assert it opens clean
  afterwards and that no `-wal` or `-shm` survives.
- Both Sentry issues resolved against the release that ships this, then watched.

## Note on `kysely_migration`

0115 says not to repair `kysely_migration` itself, and that is right. A full-file
delete is the sanctioned exception: it resets the table implicitly, and it is the
user's explicit choice rather than the app rewriting its own history.
