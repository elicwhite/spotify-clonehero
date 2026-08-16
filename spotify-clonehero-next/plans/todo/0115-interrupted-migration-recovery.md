# 0115 — Survive a migration interrupted part-way

Status: todo

Depends on: 0114

## The hazard

Kysely's SQLite adapter reports `supportsTransactionalDdl: false`
(`node_modules/kysely/dist/cjs/dialect/sqlite/sqlite-adapter.js`), so
`#runMigrations` takes the `db.connection()` branch rather than
`db.transaction()`. Nothing rolls a migration back.

Several migrations run many statements. `005_add_normalized_columns.ts` adds
seven columns across two tables in seven separate `ALTER TABLE` statements. If
the tab closes, the browser is killed, or OPFS errors after the third, then:

- three columns exist,
- `kysely_migration` has no row for `005`,
- the next load replays `005`, which fails on
  `duplicate column name: artist_normalized`.

`ALTER TABLE ... ADD COLUMN` has no `ifNotExists`, so the replay cannot succeed.
Unlike the race in 0114, a browser restart does not clear this: the half-applied
schema is on disk. The database is bricked until the user clears site data.

## What is not known

No user has been observed in this state. The report that produced 0114 recovered
by itself after a browser restart, which rules that instance out — a persisted
half-migration would have survived it.

So this plan starts by establishing whether the state is reachable in practice,
not by writing the fix. If it is not reachable, the right outcome is to close
this plan and write down why.

## Phase 1 — establish reachability

- Read how SQLocal commits a statement against OPFS, and whether a worker
  terminated mid-migration can leave a partial write. The OPFS access handle and
  SQLite's own journalling both matter here.
- Reproduce deliberately: run migrations against a database and kill the worker
  between two `ALTER TABLE` statements of `005`. Inspect the file afterwards with
  the `check-opfs` skill.
- If the state is reachable, record exactly how. If it is not, close the plan
  with that finding and stop.

## Phase 2 — only if Phase 1 reproduces it

Two candidate fixes. Choose on the evidence Phase 1 produces, do not assume.

**Wrap each migration in an explicit transaction.** Addresses the cause rather
than the symptom: a migration then either applies fully or not at all, and the
replay problem disappears. Needs a check that SQLite really does support
transactional DDL through SQLocal, and that Kysely's `disableTransactions` and
the adapter flag can be worked with rather than around.

**Make `ALTER TABLE ... ADD COLUMN` skip an existing column**, reading
`pragma_table_xinfo` — `table_info` omits VIRTUAL generated columns, so
`artist_bucket` would read as missing and fail as a duplicate. Simpler, but it
lets a migration silently no-op, which would also hide two migrations adding the
same column. If this is chosen, add a test that catches that authoring mistake by
another route.

Do not repair `kysely_migration` itself under either option. A migration that
no-ops is one thing; rewriting migration history is another.

## Verification

Whichever fix is chosen, the test is the Phase 1 reproduction: put a database
into the half-migrated state, then assert the next `migrateToLatest` succeeds and
leaves the full schema.
