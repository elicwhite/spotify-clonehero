# 0130 — Reports that answer a question, and data that is not our own

Status: in-progress

## Why

`scripts/ga-query.ts` has five reports. Four of them (`pages`, `events`,
`retention`, `acquisition`) are dimension dumps: they say what happened, never
whether a tool works. `funnel` is `landingPage x eventName`, which its own
comment calls "the closest thing to a funnel available without a proper step
taxonomy". That taxonomy now exists — plan 0105 shipped
`tool_landing_viewed -> chart_opened -> assist_run_started ->
assist_run_completed -> chart_exported`, and all 19 custom dimensions and 10
custom metrics behind it are registered in GA4 admin. The reports never caught
up with the events.

The second half is worse. GA is mounted unconditionally at `app/layout.tsx:69`,
so `pnpm dev` reports into the production property. Over the 28 days to
2026-08-25:

| hostName                   | sessions | users | pageviews |
| -------------------------- | -------- | ----- | --------- |
| musiccharts.tools          | 1396     | 845   | 5759      |
| cloneherocharts.vercel.app | 370      | 272   | 1506      |
| localhost                  | 181      | 37    | 4482      |

38% of every pageview in the property is a developer refreshing a page. It put
`/guitar-difficulties/landing-preview/b` — a route that does not exist in
production — into the top-50 pages, and inflated `/chart-editor` engagement
time by 31% (54,223s reported, 37,328s real).

## Stage 1 — Reports keyed on the funnel, not on the route

Add named reports to `scripts/ga-query.ts`, each answering one question:

- `trend` — sessions, users and new users per day. This is what makes a traffic
  spike visible; nothing in the script showed one before.
- `hosts` — sessions per `hostName`. Keeps the pollution measurable rather than
  invisible.
- `scan-funnel` — `/find-music` reach -> `charts_scanned` -> `chart_downloaded`,
  split by `customEvent:source`.
- `authoring-funnel` — the five plan-0105 steps in step order, users per step,
  split by `customEvent:origin`.
- `assist-health` — `assist_run_*` per `customEvent:task`, with the terminal
  state and average `customEvent:durationMs`.
- `open-failures` — `chart_open_failed` per `customEvent:reason` and origin.
- `sheet-music` — loads, plays and `playSeconds` per instrument and difficulty.
- `lyrics-funnel` — `add_lyrics_*` four steps, plus the low-confidence rate.
- `exports` — `chart_exported` per format, origin and applied tools.

## Stage 2 — Stop measuring ourselves

Every report excludes `hostName == 'localhost'` unless `--include-local` is
given, so a stale local session can never again move a number a decision rests
on. A query-time filter is reversible; a GA data filter is not, which is why
the exclusion starts here.

In the app, `analyticsEnabled` in `lib/analytics/environment.ts` decides whether
a page reports at all, and `app/AnalyticsGate.tsx` applies it around
`RegionAwareAnalytics`, whose one concern stays the region cookie.

The gate reports from an unknown environment on purpose. `NEXT_PUBLIC_VERCEL_ENV`
went missing in production for 11 days once and took Sentry with it silently
(plan 0125); losing every production number is worse than dev noise, and the
hostname still keeps `localhost` out.

`cloneherocharts.vercel.app` keeps reporting. It carries 272 real users from 30
countries, most of them arriving from Google's index, so it is a live host and
not a staging one. That it is indexed at all is an SEO duplicate-domain bug —
`lib/site-url.ts:16` already points every canonical tag home — and wants a
Vercel domain redirect, not an analytics filter. Out of scope here.

That leaves the developer's own use of the real site, which no host filter can
see. Not solved in this plan: the candidate is a per-browser `internal_user`
flag set once from `?ga_internal=1`, pushed as a user-scoped custom dimension
beside the existing `user_id` in `lib/analytics/track.ts`, and excluded at query
time. It fails silently whenever site data is cleared — which is exactly what
testing OPFS does — so it needs a visible "internal sessions" count before it
can be trusted.

## Done when

- `pnpm ga trend hosts scan-funnel authoring-funnel assist-health` runs in one
  invocation and each table answers its question without further arithmetic.
- No report counts `localhost` unless asked.
- `pnpm test`, `pnpm typecheck` and `pnpm lint` pass.
