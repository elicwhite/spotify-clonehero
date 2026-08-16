# 0113 — Report errors from Find Music

Status: completed

## Why

A user reported that Find Music could not refresh their Chorus index. Sentry had
nothing, and never would have, for two reasons that stacked.

**The reporting call was deleted.** `9cff96d8` "Retire the two Spotify pages into
Find Music" removed `Sentry.captureException` from both `/spotify` and
`/spotifyhistory`, together with the test asserting a Chorus outage stays out of
Sentry. `FindMusicClient.tsx` never had an equivalent.

**The route was Sentry-free.** `lib/apple-music/private-route.ts:17` puts
`/find-music` on the taste-data-private list (`7b621ddc`, six days before the
retirement). `instrumentation-client.ts` skipped `Sentry.init` entirely on a
private first load, and `beforeSend` returned `null` for every event while on
one. `/spotify` was never on that list, which is why its call worked.

Diagnosing the report took a Discord thread, two screenshots, and a console dump.

## The decision

Find Music is not private for the purpose of error reporting. Errors from it are
reported like anywhere else, with no allow-list and no scrubbing layer.

An earlier draft of this plan built exactly that layer — a closed set of
operation labels, a per-error-shape allow-list, and a `beforeSend` escape hatch.
It was dropped. It solved the wrong problem: **Session Replay never passes
through `beforeSend`.** Replay ships its own envelope, so making `Sentry.init`
unconditional would have started a DOM buffer on `/find-music` holding the user's
songs, artists, and playlists, and no amount of care in the error path touches
that. The allow-list was elaborate protection on the door while the window was
open.

## What is and is not gated

`isTasteDataPrivateRoute` controls four separate policies. Only the first
changes:

| Consumer | Before | After |
| --- | --- | --- |
| `instrumentation-client.ts` — error reporting | off | **on** |
| `TasteDataPrivacyBoundary.tsx` — Session Replay | off | off |
| `RegionAwareAnalytics.tsx:39` — Google Analytics | off | off |
| `WebMCPTools.tsx:31`, `WebMCPInit.tsx:12` — WebMCP tools | off | off |

Replay is kept off by never registering the integration, rather than by stopping
it. `instrumentation-client.ts` passes `integrations: []` when the first load is
a taste-data route, and `TasteDataPrivacyBoundary` calls `Sentry.addIntegration`
on the first navigation to a route that may record. A buffer that was never
created cannot leak; `stop()` on an integration that loads a tick too late can.

## Call sites

| Site | Note |
| --- | --- |
| `FindMusicClient.tsx` — Chorus refresh | The deleted call. Generic branch only; the `ChorusUnavailableError` branch stays silent. |
| `FindMusicClient.tsx` — Spotify library refresh | Skipped when `controller.signal.aborted`. |
| `FindMusicClient.tsx` — history import | After the `isPickerCancel` early return, so a cancelled picker reports nothing. |
| `FindMusicClient.tsx` — local Songs folder scan | Where the `IDBDatabase` error in the second screenshot surfaced. |
| `useAppleMusicSource.ts` — refresh, disconnect | |
| `FindMusicTable.tsx` — chart install, recommendation dismiss | `console.error` only before this. |

Deliberately not reported: `loadCatalog`'s empty catch (the branch above owns and
reports the error), and the `localStorage` failures in `FindMusicClient.tsx` and
`filterPersistence.ts`, which are expected in a private window and degrade
correctly.

## Show the error to the user

`chorusError` held the real message and the degraded card rendered fixed copy
instead, so the reporter's screenshot could not show what broke. The card now
renders it, as the refreshing card already did.

## Verification

- Restored the test `9cff96d8` deleted: a Chorus outage reaches the user and not
  Sentry.
- A non-outage Chorus failure reports once and shows its message on the card.
- Replay is added on leaving a private route that started without it, and never
  added while one is open.

## Follow-ups, not in this plan

- `chorusChartDb/database.ts:121-130` — the scan-resume branch is dead. The
  session rows are written inside the same transaction that commits at the end,
  so `in_progress` can never be read and every interrupted scan restarts from
  zero. That transaction also wraps `fetchNewCharts` network I/O. Splitting it
  costs commit round-trips on the OPFS async VFS, so the fix needs a batching
  decision rather than per-page commits.
- `lib/local-db/client.ts` — `openAndMigrate` overwrites `sqlocalClient` without
  `destroy()`, leaking a worker per retry.
- A "Reset local database" control, reachable when `getLocalDb()` rejects.
