# 0120 — Keep chart projects when Chrome runs out of room

Status: in-progress

## The problem

Chrome evicts this origin under storage pressure, and users lose their chart
projects. Everything is in one place — the default storage bucket — so
eviction is all-or-nothing: Chrome does not delete the stems and keep the
charts. There is no event before eviction and no API that announces it, so the
fix is structural, not a listener.

Today the default bucket holds, at the OPFS root:

| Directory                         | Written by                                | Regenerable |
| --------------------------------- | ----------------------------------------- | ----------- |
| `spotify-clonehero-local.sqlite3` | `lib/local-db/client.ts`                  | no          |
| `{editor namespace}/`             | `lib/project-storage/opfsProjectStore.ts` | no          |
| `drum-transcription/`             | `lib/drum-transcription/storage/opfs.ts`  | no          |
| `audio-pipeline/stem-cache/`      | `lib/audio-pipeline/stem-cache.ts`        | yes         |
| `model-cache/`                    | `lib/lyrics-align/model-cache.ts`         | yes         |
| `previews/`, `backups/`           | `lib/local-songs-folder/index.ts`         | —           |

The two regenerable directories are the large ones: separated stems per song,
plus ~336 MB of ONNX models. They are what fills the quota, and they are the
only data the user loses nothing by losing.

## What is known, and what is not

Two evictions are confirmed by report: one on a maintainer's own machine, one
from a user. So the failure is real and it is not a single bad machine.

What no one has is a number. Nothing in the repo records a quota, a usage
figure, or a `persisted()` answer from either event, so how close to the quota
the origin was, and whether persistence had ever been granted, are both unknown.
Three other paths also destroy the same data and look the same to the user, and
cannot be ruled out for any individual report:

- the cross-tab migration race in `plans/completed/0114-serialize-local-db-migrations.md`,
  where one user saw every feature fail at once;
- the half-applied migration in `plans/todo/0115-interrupted-migration-recovery.md`,
  whose only escape is clearing site data — which deletes every project;
- `opfs_delete` (`app/WebMCPTools.tsx:301`), a WebMCP tool that recursively
  deletes any OPFS path on a model's say-so.

Phase 1 is therefore instrumentation, and it comes first: it is cheap, it makes
the next eviction arrive with a quota reading attached, and it is what tells a
user near the quota that they are.

## The approach

Four defenses, cheapest and most diagnostic first:

1. **Measure** — find out whether the quota is anywhere near full, and whether
   storage is already persistent. Without this the rest is a guess.
2. **Persistence** — ask Chrome to exempt the default bucket, which holds the
   charts, the project audio and the database.
3. **Self-pruning** — keep the caches small, so the origin does not approach the
   pressure threshold. The only part that also protects Firefox and Brave, which
   have no Storage Buckets API.
4. **Storage buckets** — put the regenerable caches in a non-persisted bucket,
   so Chrome has something to take that is not the user's charts.

**The default bucket stays the persisted one; user data does not move.** Two
reasons:

1. SQLocal resolves its database path against `navigator.storage.getDirectory()`
   and offers no bucket option
   (`node_modules/sqlocal/dist/lib/parse-database-path.js`), so the SQLite
   database cannot leave the default bucket without patching SQLocal.
2. `navigator.storage.persist()` sets persistence on the default bucket, and a
   named bucket's `persisted: true` asks for the same permission. There is no
   durability gained by copying gigabytes of project audio into a named bucket.

The result is what is wanted — charts, project audio and the database in the
persisted bucket, caches in the evictable one — with no migration of the data
that must not be lost.

**What the bucket split does and does not give.** If persistence is granted, the
projects cannot be evicted at all and the split is what keeps the caches
reclaimable. If persistence is refused, the split does not make the projects
safe; the honest win is then only that the origin is smaller and that the caches
are the least-recently-used bucket. Phase 3 delivers the smaller origin by
itself, in every browser. That is why buckets come last.

## Phase 1 — see the truth

New `lib/browser-storage.ts`:

- `getStoragePressure()` over `navigator.storage.estimate()` — `usageBytes`,
  `quotaBytes`, and the ratio between them.
- `isStoragePersisted()` over `navigator.storage.persisted()`.

Both answer for a browser that supports neither, and for a call that throws,
without the caller handling it: this is a reading, and a failed reading must
never take a feature down with it.

Attach both to Sentry as context and a tag, once, from
`instrumentation-client.ts`. Every later event then carries the quota state, so
the next report of a lost project arrives with the number this plan does not
have. The module itself stays free of Sentry; `lib/sentry/storage-context.ts`
joins them.

There is no user-facing panel in this phase. It needs a button that empties the
caches, and nothing can empty them until Phase 3 exists, so it is Phase 5.

## Phase 2 — ask for persistence

`requestPersistentStorage()` in `lib/browser-storage.ts`, over
`navigator.storage.persist()`, and `collectEarnedPersistence()`, which is the
one that is safe to call on load.

**Do not call `persist()` unconditionally on load.** Some browsers answer it
with a permission prompt, and an unexplained "store data permanently?" before
the visitor knows what the site is would be a regression — for Firefox users
above all, whom `plans/todo/0116-find-music-firefox-brave.md` is courting.

The gate is the permission state, not the browser name:
`permissions.query({name: 'persistent-storage'})` reports `'granted'` only where
the decision is already made and nobody will be interrupted. This removes the
need to verify which browsers prompt, since a browser that would prompt reports
`'prompt'`. Everywhere else the ask belongs behind the Phase 5 button. Until
that panel exists, those browsers are not asked.

The gate assumes no browser decides inside `persist()` what `query()` called
undecided. If one does, users it would have granted silently are never asked.
Phase 1's context therefore carries the permission state, so that shows up in
the reports rather than staying an assumption.

## Phase 3 — prune the caches before Chrome does

The stem cache has no delete function and no record of when an entry was last
used. Add both, in `lib/audio-pipeline/stem-cache.ts`:

- **Last-use time.** Every load that decodes touches the payload's `.ok` marker
  with the existing `touchFile`; `getFile().lastModified` reads it back. A read
  leaves no trace of its own, so the marker carries the time. An entry holds
  several payloads — `/tempo` reads the drums, `/add-lyrics` the vocals — so an
  entry's time is the **newest** marker in its directory. An entry with no
  marker counts as oldest. Probes stay metadata-only: a probe is not a use.
- **`deleteStemEntry(fingerprint)`** — removes the entry, and reports whether it
  is gone. OPFS refuses to remove a directory holding an open file, and a prune
  that counted a refused deletion as freed bytes would stop early and overstate
  the room it recovered.
- **`pruneStemCache({targetBytes, keep, keepRoomForLargest})`** — deletes whole
  entries, least recently used first. `keep` is the set of fingerprints the
  caller is using. `keepRoomForLargest` is the anti-thrash floor: a cache that
  cannot hold two songs makes a user working across two of them re-separate on
  every switch. It defaults to 0, so Phase 5's "empty the cache" still empties
  it.

**Size the target against the cache, not the origin.** A high-water mark over
`estimate().usage / quota` is the wrong scope: if the projects alone exceed the
low-water mark, the pruner empties the whole cache on every run and still
reports failure. The budget is cache bytes, in `stem-cache-budget.ts`, and the
origin ratio only chooses between a relaxed and a tight one. Keeping the policy
in its own module also lets a test prune a few hundred bytes instead of
fabricating a gigabyte.

**The trigger is the store, not the separator.** `separateStems` is not the only
thing that writes here: `lib/tempo-map/pipeline-worker.ts` separates and stores
on its own, and so does `roformer-separation.ts` for a project with no stored
original. `storeStemBytes` and `storeStemOpus` are the one place all five write
paths pass through, so the prune goes there, protecting the fingerprint just
written.

Two tabs must not walk and delete the same directory at once, so the prune takes
`STEM_CACHE_PRUNE_LOCK`. It takes it with `ifAvailable`: an exclusive request has
no timeout, and a prune is never worth making another tab's separation wait.

Two known limits, accepted rather than solved:

- **Another tab.** `keep` covers the calling context only. Pruning an entry a
  second tab is about to read costs that tab a re-separation; it does not
  corrupt anything, because `loadStem` returns null for every failure.
- **Disk pressure below the quota.** Chrome can evict while the origin is far
  under its quota, in which case no threshold this pruner watches will ever
  fire. Phase 1's telemetry is what would show this.

The model cache is not pruned. It is one entry per model, it is needed by the
next run, and dropping it costs a 336 MB download.

## Phase 4 — move the caches into an evictable bucket

`lib/browser-storage.ts` gains:

- `getCacheRoot(): Promise<FileSystemDirectoryHandle>` — opens
  `navigator.storageBuckets.open('cache')` and returns its `getDirectory()`.
  Falls back to `navigator.storage.getDirectory()` where `storageBuckets` does
  not exist (Firefox, Safari), so those browsers keep today's behavior.
- The resolved promise is the cache, as in `lib/local-db/client.ts`.
- Must work in a worker: `stem-cache.ts` is called from `pcm-worker` and the
  tempo worker. `navigator.storageBuckets` is on `WorkerNavigator` too.

Declare `StorageBucketManager` and `StorageBucket` in `types/navigator.d.ts`, on
both `Navigator` and `WorkerNavigator`. The DOM lib has no types for them.

`getCacheEntryDir` (`lib/audio-pipeline/stem-cache.ts:244`) and the two
directory lookups in `lib/lyrics-align/model-cache.ts` (lines 100 and 153) then
resolve from `getCacheRoot()`.

**Write new entries to the bucket; read old ones where they already are. Do not
copy.** Copying transiently doubles the footprint of a user who is by hypothesis
near the quota — the copy is most likely to fail, or to cause the eviction, for
exactly the users it is for. The repo already settled this question twice:
`ROFORMER_SEPARATOR_ID` abandons superseded entries rather than migrating them
(`stem-cache.ts:80`), and `opfsProjectStore` reads `legacyNamespaces` in place
(`opfsProjectStore.ts:152-195`).

So the lookup takes a legacy fallback, and it must be in **every** entry point,
not just the loaders. `hasStem` and `hasStemOpus` are branch deciders — they
choose whether a pipeline re-separates
(`lib/assist/tasks/add-lyrics.ts:212`, `transcribe-drums-from-audio.ts:110`,
`generate-tempo-map.ts:136`, `roformer-separation.ts:146,180`). A probe that
misses a legacy entry costs a full GPU re-separation, which is the exact cost
this phase exists to avoid. The probes stay metadata-only: a second
`getDirectoryHandle` and `getFile().size`, no payload read, no copy.

Phase 3's pruner reaps the legacy tree over time, so the old location empties
itself.

## Phase 5 — tell the user what is protected

A storage panel, reachable without an account (a user who lost their charts may
never have made one), showing: bytes used against the quota from
`getStoragePressure()`, whether storage is persistent from
`isStoragePersisted()`, what the caches hold, a button that empties them
(Phase 3's `deleteStemEntry`), and the button that asks for persistence on the
browsers Phase 2 does not ask silently.

`formatBytes` already exists in `lib/sng/file-utils.ts`. The page shell and its
primitives are owned by `components/landing/`; the `design-system` skill governs
this phase, and forking the shell fails a test.

## Out of scope

- `previews/` and `backups/` stay in the default bucket. They are small, and
  `backups/` is not regenerable.
- Patching SQLocal to open a database inside a named bucket.
- `opfs_delete` in `app/WebMCPTools.tsx:301`. It is a plausible cause of the
  reported loss, but it is a separate question from the quota.

## Coordination

`lib/audio-pipeline/stem-cache.ts` is the canonical shared module claimed by
in-progress plan `0066-unified-stem-cache-and-audio-session.md`. Phases 3 and 4
both change it. Check that plan's state before starting either.

`lib/browser-storage.ts` is a new module rather than an addition to
`lib/fileSystemHelpers.ts`: that file holds three handle-level helpers
(`writeFile`, `readJsonFile`, `readTextFile`) and takes handles it is given,
while this one decides which root a handle comes from. Different jobs.

## Verify

- The fake OPFS needs work before any of this is testable:
  `FakeFile` (`lib/drum-transcription/storage/__tests__/fake-opfs.ts:33`) has no
  `lastModified`, so every LRU test would compare `undefined`. Add an injectable
  clock; same-tick touches would otherwise order nondeterministically.
- Unit tests for the pruner: least-recently-used order, newest-marker-wins
  inside an entry, an unmarked entry treated as oldest, the `keep` set
  respected, and a stop as soon as the target is met.
- Unit tests over a fake bucket manager: the bucket root is used when
  `storageBuckets` exists, the default root when it does not, and a legacy entry
  is found by `hasStem`, `hasStemOpus`, `loadStem` and `loadStemOpus` alike,
  without being copied.
- In Chrome, with the `check-opfs` skill: new cache entries land under the
  `cache` bucket, the projects and the database do not, and
  `navigator.storage.persisted()` answers true.
- In Firefox: no `storageBuckets`, everything still works from the default root,
  the pruner still runs, and nothing prompts on load.
