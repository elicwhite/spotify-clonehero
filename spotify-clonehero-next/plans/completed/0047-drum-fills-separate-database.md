# 0047 — Drum fills: separate SQLite database

User direction (2026-06-12): drum-fills must not modify the shared local SQLite database
(`spotify-clonehero-local.sqlite3`). It gets its own database, and its migrations must run
only when the drum-fills tool is used — not on every page that touches the shared DB.

Scope note: the request named commit 1cbb5f0 (migrations 011/012), but plan 0044's commit
(c8f9f50) added the core tables via migration 010 to the shared DB. A separate tool DB
only makes sense if the whole drum-fills schema moves — migrate all of it.

## Design

- **New database**: `drum-fills.sqlite3` via SQLocalKysely, mirroring the shared client's
  setup (`lib/local-db/client.ts` — singleton, pragmas, ParseJSONResultsPlugin) but owned
  by the tool: `lib/drum-fills/db/` (client.ts, migrations/, types.ts, queries — move the
  contents of `lib/local-db/drum-fills/` here; update all imports directly, no shims).
- **Migrations**: fresh chain for the new DB — `001_initial` consolidating the schema of
  shared-DB migrations 010+011+012 (fills incl. groove/dedupe/difficulty columns,
  fill_attempts, fill_srs, scan_runs, groove_ladder_progress, all indexes). Migrations
  run lazily on first use of the drum-fills DB client, which only drum-fills code imports
  — so nothing runs unless you're on /drum-fills.
- **Shared DB rollback**: remove drum-fills migrations 010/011/012 and their tables/types
  from `lib/local-db/`. CAREFUL with migrator bookkeeping: the user's browser (and any
  existing user) has 010–012 recorded in the shared DB's migration table; Kysely's
  migrator errors when applied migrations are missing from the provided list. Verify
  actual behavior and pick the clean fix — e.g. keep 010–012 in the chain as no-op stubs
  (fresh DBs create nothing; existing DBs stay consistent) plus a new migration that
  drops the orphaned drum-fills tables from the shared DB, or prune the migration-table
  rows on init. The shared `types.ts` loses the drum-fills tables either way.
- **Data**: no migration of existing rows. Fills are rebuilt by a rescan (~30s); practice
  history/SRS state in the old shared DB is abandoned (user has minimal history —
  acceptable; the drop-tables migration removes it).
- The DB export/import helpers in lib/local-db (exportLocalDbFile etc.): check whether
  drum-fills needs equivalents; if trivial, mirror them for the new DB.

## Validation

- Jest: existing drum-fills DB query tests pass against the new client; migration-chain
  test if patterns allow.
- Browser: load a non-drum-fills page that uses the shared DB (e.g. whatever uses
  chorus_charts) → confirm via evaluate_script/OPFS listing that `drum-fills.sqlite3`
  was NOT created and shared-DB init succeeds with the stubbed/pruned chain. Then load
  /drum-fills → new DB created, rescan rebuilds fills, grooves/ladder/library all work.
  Console clean both places.
