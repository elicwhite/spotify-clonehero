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

- `getCacheRoot()` — the root new cache data is written to. Opens
  `navigator.storageBuckets.open('cache', {durability: 'relaxed'})`, not
  persisted, and falls back to the default root where `storageBuckets` does not
  exist (Firefox, Safari), so those browsers keep today's behavior.
- `getCacheRoots()` — every root a cache entry may be in, the written-to one
  first.
- `getCacheDir(path)` and `getCacheDirs(path)` — the write and read forms. Both
  caches use these rather than each holding its own copy of the two-root rule.
- Only the bucket is memoized, and only on success. A remembered failure would
  send every later write in the session into the bucket that must not be
  evicted, and this is the bucket the browser is expected to take, so failing
  to open it is a normal event.

Declare `StorageBucketManager` and `StorageBucket` in `types/navigator.d.ts`.
The DOM lib has no types for them. `Navigator` alone: `tsconfig`'s `lib` has no
`webworker`, so worker code is checked against `lib.dom` and augmenting
`WorkerNavigator` would declare an interface nothing uses.

**`getCacheDir` throws rather than falling back.** Writing cache data beside the
chart projects, silently, is the exact outcome the bucket exists to prevent. The
one recovery it does make is for its own hazard: a bucket evicted mid-session
leaves a dead handle, so a failed descent drops the memo and opens the bucket
again before giving up.

**Write new entries to the bucket; read old ones where they already are. Do not
copy.** Copying transiently doubles the footprint of a user who is by hypothesis
near the quota — the copy is most likely to fail, or to cause the eviction, for
exactly the users it is for. The repo already settled this twice:
`ROFORMER_SEPARATOR_ID` abandons superseded entries rather than migrating them
(`stem-cache.ts`), and `opfsProjectStore` reads `legacyNamespaces` in place.

The legacy fallback is in **every** entry point, not just the loaders. `hasStem`
and `hasStemOpus` are branch deciders — they choose whether a pipeline
re-separates (`lib/assist/tasks/add-lyrics.ts:212`,
`transcribe-drums-from-audio.ts:110`, `generate-tempo-map.ts:136`,
`roformer-separation.ts:146,180`). A probe that misses a legacy entry costs a
full GPU re-separation, which is the exact cost this phase exists to avoid.

**A usable payload picks the root, not a directory.** `getFileHandle(name,
{create: true})` materializes a zero-length file before anything is written, so
an interrupted store leaves a payload that exists and holds nothing. Choosing on
existence would let that placeholder in the bucket hide a complete copy in the
older root. Each payload resolves on its own, so an entry whose drums are in the
bucket and whose vocals are still in the older root works.

Phase 3's pruner walks both roots and deletes through the handle of the root
that holds the entry, so an old entry is reclaimed once it falls out of use.

## Phase 5 — tell the user what is protected

A `/storage` route, reachable without an account: a user who lost their charts
may never have made one. It shows the bytes used against the quota, the
separated stems and their size, the downloaded models and theirs, and whether
storage is persistent — plus a button that frees the stems, and one that asks
for persistence.

Both cache figures are shown, not just the stems. The models are ~336 MB and
the stems can be more; a readout that showed one and not the other would leave
the user unable to account for the difference, and the honest reading of that
gap is "my charts are enormous". Freeing still covers the stems only: dropping
a model costs a 336 MB download and buys a user nothing they asked for.

The persistence button appears whenever the data is not already kept and the
browser has not already refused — which includes a permission that is granted
but not yet taken, a state one silent call settles. Where the browser has
refused, the page says so rather than showing a button that cannot work.

`formatBytes` already exists in `lib/sng/file-utils.ts`, and `LandingProse` in
`components/landing/Prose.tsx`. The page shell and its primitives are owned by
`components/landing/`; the `design-system` skill governs this phase, and
forking the shell fails a test.

The link lives in `LandingFooter`, beside Privacy, so it is on every landing
page. A user whose projects have disappeared has no tool page left to find the
explanation on.

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
- In Chrome: new cache entries land under the `cache` bucket, the projects and
  the database do not, and `navigator.storage.persisted()` answers true. Not
  with the `check-opfs` skill — the `opfs_*` WebMCP tools read the default root
  only, so they cannot see the bucket. Use DevTools, or make those tools
  bucket-aware first.
- In Chrome: whether `navigator.storage.estimate()` counts a non-default
  bucket. If it does not, moving the caches into one makes the origin look
  emptier, and Phase 3's budget relaxes exactly when it should tighten.
- In Firefox: no `storageBuckets`, everything still works from the default root,
  the pruner still runs, and nothing prompts on load.
