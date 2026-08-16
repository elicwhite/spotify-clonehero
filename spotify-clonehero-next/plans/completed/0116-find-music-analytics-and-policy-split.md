# 0116 — Restore Find Music analytics, and split the taste-data policy

Status: completed

Depends on: 0113

## Why

`isTasteDataPrivateRoute` is one predicate standing in for four unrelated
policies. `7b621ddc` added `/find-music` to it to keep Session Replay away from
the user's library, and three other behaviours switched off as a side effect.

Plan 0113 already separated the first of them. This finishes the job.

| Consumer | Before 0113 | After this plan | Why |
| --- | --- | --- | --- |
| Sentry error reporting | off | **on** (0113) | Logins failing, a dead sidebar button, a failed download — all of it matters. |
| Google Analytics | off | **on** | Funnel data was flowing before `7b621ddc` and stopped without anyone deciding to stop it. |
| Session Replay | off | off | Replay records the DOM, and on `/find-music` the DOM *is* the user's songs, artists and playlists. |
| WebMCP tools | off | off | `runRawSql` over the local music database. A debug tool; nobody asked for it here. |

The rule underneath: **what the user did is useful, which songs they did it to is
not.** Replay is the one mechanism that cannot honour that distinction, because
it captures the page rather than an event we chose to send.

## Analytics is safe by construction, not by care

`track()` accepts only `AnalyticsEvent` (`lib/analytics/track.ts`), a closed
union. No member carries a song, artist, album or playlist name. The download
event is `{event: 'chart_downloaded', source, format, md5?}` — an md5 is a chart
hash, not a title. A call site cannot widen this without editing the union.

So enabling GA on `/find-music` needs no scrubbing layer, and it stays inside
what `app/privacy/page.tsx` already documents: standard pageviews, plus the
custom event list it points at `lib/analytics/track.ts` for. The claim under
"What we don't collect" — no content of files you load — is unaffected.

The region gate is untouched. EEA/UK/CH visitors, and any visitor whose region
cookie is missing or unreadable, still load no `gtag.js` at all.

Two funnel events already fire from Find Music actions and have been going
nowhere: `charts_scanned` and `chart_downloaded`
(`lib/local-songs-folder/index.ts:175`, `:464`). Re-enabling GA restores them
with no new instrumentation. New Find Music events are out of scope; plan 0105
covers funnel design.

## Work

1. Remove the taste-data gate from `RegionAwareAnalytics.tsx`. The region check
   and the `shouldLoad` logic stay exactly as they are.
2. Rename `isTasteDataPrivateRoute` to `rendersPersonalTasteData`. The old name
   claims a page-wide secrecy that is no longer true and would mislead the next
   reader into thinking errors and analytics are still gated. Update all callers
   directly — no re-export shim.
3. Update the stale example on the privacy page: it cites "a chart was downloaded
   from the Spotify page", and that page was retired in `9cff96d8`.

## Verification

- `RegionAwareAnalytics` renders GA on `/find-music` and `/find-music/...`, and
  still renders nothing when the region cookie is absent or `eea`.
- The Replay and WebMCP tests keep asserting those stay off on Find Music.
- Full suite, typecheck, lint.
