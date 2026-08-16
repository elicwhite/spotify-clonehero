# 0113 — Report infrastructure errors from Find Music without uploading taste data

Status: todo

## Why

A user reported that Find Music could not refresh their Chorus index. Sentry had
nothing. It never will, for two reasons that stack.

**The reporting call was deleted.** `9cff96d8` "Retire the two Spotify pages into
Find Music" removed `Sentry.captureException` from both `/spotify` and
`/spotifyhistory`, together with the test that asserted a Chorus outage stays out
of Sentry. `FindMusicClient.tsx` never had an equivalent. The old code was:

```js
toast.error(error instanceof Error ? error.message : 'Library refresh failed');
Sentry.captureException(error);
```

**The route is Sentry-free.** `lib/apple-music/private-route.ts:17` puts
`/find-music` on the taste-data-private list, added by `7b621ddc` on 2026-08-08,
six days before the retirement. On that list:

- `instrumentation-client.ts:20` skips `Sentry.init` entirely when the first page
  load is a private route.
- `beforeSend` and `beforeSendTransaction` return `null` for every event while on
  a private route (lines 47-49).
- `TasteDataPrivacyBoundary` stops Replay.

So `/spotify` reported errors because it was never private. Putting the same call
back in `FindMusicClient.tsx` would be a no-op.

The privacy gate is correct and stays. Song, artist, playlist, and chart names
must not leave the browser — that is a user-facing promise, not a preference.
This plan adds a narrow, audited channel for errors that carry none of that.

## Design

### `lib/sentry/infra-error.ts`

One entry point:

```ts
export function reportInfraError(operation: InfraOperation, error: unknown): void
```

`InfraOperation` is a closed union of labels, one per call site below. A closed
union, not a free string, so no call site can pass a song name as the label.

The reporter never sends the caught error. It builds a new `Error` from an
allow-list, because caught messages can embed taste data — `downloadSong`
failures name the chart, and SQLite errors can quote row values.

Drop entirely, report nothing:

- `ChorusUnavailableError` — their outage, not our bug. This rule already exists
  in `lib/chorus-errors.ts` and must survive.
- `DOMException` with name `AbortError` — a cancelled picker or an aborted
  controller.
- `DOMException` with name `NotAllowedError` — the user declined a permission.

Otherwise derive a safe descriptor:

| Error shape | What is sent |
| --- | --- |
| `DOMException` | `name` only, never `message` |
| Error our code raised with an HTTP status | the status number |
| Message matching `/^SQLITE_[A-Z]+: /` | the full message — schema text, no row values |
| Anything else | `name` only; **the message is dropped** |

Then `Sentry.captureException` on a synthetic `Error` whose message is
`` `${operation}: ${descriptor}` ``, tagged `infra_only: 'true'` and
`infra_operation: operation`.

Keep the original `stack`. It names our own bundle frames and is what makes a
report actionable. It holds no user data.

### Gate change in `instrumentation-client.ts`

```ts
beforeSend: event =>
  !isCurrentTasteDataPrivate()
    ? event
    : isInfraOnlyEvent(event)
      ? stripToInfraFields(event)
      : null,
```

`stripToInfraFields` deletes `breadcrumbs`, `user`, `request`, and any attached
replay, and keeps only the exception, the two tags, and the release. Strip at
send time even though the reporter already builds a clean event — defence in
depth, because the SDK's default integrations attach breadcrumbs on their own.

Also set `beforeBreadcrumb` to drop console and fetch breadcrumbs while on a
private route, so taste data is never held in the buffer at all.

`beforeSendTransaction` keeps returning `null` on private routes. Performance
data is not worth any risk here.

**`Sentry.init` must stop being skipped.** Line 20 means a user landing directly
on `/find-music` never initialises the SDK, so nothing reports no matter what
`beforeSend` says. Always initialise; let `beforeSend` be the only gate. Replay
must still never start on a private route — verify `TasteDataPrivacyBoundary`
covers the direct-load case, not only client-side navigation into it.

## Call sites

Audited across the whole tool. **Report:**

| Site | Operation | Note |
| --- | --- | --- |
| `lib/local-db/client.ts:109` | `local-db-init` | Highest value. It fired for this report and is upstream of every other failure. |
| `FindMusicClient.tsx:292-306` | `chorus-refresh` | The deleted call. Generic branch only; the `ChorusUnavailableError` branch stays silent. |
| `FindMusicClient.tsx:384` | `opfs-probe` | `localDbExists` failure is currently swallowed whole. |
| `FindMusicClient.tsx:492` | `spotify-history-import` | Skip picker cancel. |
| `FindMusicClient.tsx:526` | `spotify-library-refresh` | Skip when `controller.signal.aborted`. |
| `FindMusicClient.tsx:572` | `local-songs-scan` | Where the `IDBDatabase` error in the second screenshot surfaced. |
| `useAppleMusicSource.ts:95` | `apple-music-refresh` | |
| `useAppleMusicSource.ts:128` | `apple-music-disconnect` | |
| `FindMusicTable.tsx:127` | `recommendation-dismiss` | `console.error` only today. |
| `FindMusicTable.tsx:165` | `chart-install` | `console.error` only today. The caught message names the chart, so the message must be dropped. |

**Do not report:**

- `FindMusicClient.tsx:324` — `loadCatalog`'s empty catch. The branch above owns
  the error and reports it; reporting here would double-count.
- `FindMusicClient.tsx:336`, `:350`, `filterPersistence.ts:53`, `:73` —
  `localStorage` unavailable. Expected in private windows, and the feature
  degrades correctly.

Also check the error path behind `spotifyProgress.updateStatus === 'error'`
(`FindMusicClient.tsx:626`). The status is surfaced on the card, but confirm the
underlying error reaches a reporting call rather than being dropped in the hook.

## Show the error to the user

Independent of Sentry, and the reason this report took so long to diagnose:
`chorusError` holds the real message, the refreshing card renders it
(`FindMusicClient.tsx:852-860`), but the degraded card at lines 864-882 renders
fixed copy and throws it away. Render `chorusError` there, as the refreshing card
already does.

## Verification

- Unit tests for `reportInfraError`: a `ChorusUnavailableError`, an `AbortError`,
  and a `NotAllowedError` each report nothing. A SQLite error keeps its message.
  An arbitrary `Error` with a song name in its message reports the name only, and
  the assertion checks the song name is absent from the payload.
- A unit test that `beforeSend` returns `null` for an untagged event on a private
  route, and a stripped event for a tagged one.
- Restore the deleted test from `9cff96d8`: a Chorus outage reaches the user but
  not Sentry.
- Confirm in the browser that a forced failure on `/find-music` produces one
  event with no breadcrumbs, no replay, and no taste data.
