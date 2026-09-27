# 0155 — Analytics: /auth/login as landing page, inflated sheet-music playSeconds

Status: completed

Two GA4 measurement complaints from the 28 days to 2026-09-27. The second one
had a bug in our code and has a fix. The first one is not a GA code defect; it
is failed sign-ins. This plan records the evidence, what is confirmed and what
is not, and the owner action.

## 1. `sheet_music_playback_session.playSeconds` (fixed)

GA showed 2,107,993 s over 726 events from 47 users.

### Cause

`SongView` measured a segment as `Date.now()` at the pause (or `pagehide`)
minus `Date.now()` at the play. The wall clock continues while the device
sleeps, or while the browser freezes the tab, with the page still in its
playing state. The next pause or page close then reports all of that time.

GA data (`raw`, event `sheet_music_playback_session` by city, date, device):

- One desktop user in one city on 2026-09-01: 4 events, 1,898,634 s (about 22
  days).
- One mobile user on 2026-08-30: 1 event, 101,693 s (about 28 hours).
- All other 720 events: 107,666 s in total, about 150 s per event. That is a
  normal song length.

Units were correct (seconds) and each event was a delta, not a running total.
There was no double count: the pause path and the flush path cleared the same
open segment.

### Change

- `AudioManager.renderedSeconds` returns the AudioContext clock. The clock
  advances only while audio renders, so it stops while paused, while the
  device sleeps, and while the page is frozen or interrupted. Seeks, loops and
  tempo do not move it.
- `usePlaybackAnalytics(audioManager, isPlaying)`
  (`app/sheet-music/[slug]/usePlaybackAnalytics.ts`) sends the play, pause
  and playback-session events. One effect keyed on `[audioManager, isPlaying]`
  measures a span on the rendered clock, and its cleanup keeps the span's
  seconds. React cleanup thus handles the pause, the AudioManager rebuild
  (the state goes to null and then to the new manager, whose clock starts at
  zero) and the unmount. `SongView` calls the hook and has no other
  analytics code for playback.
- Event names and parameters do not change. `playSeconds` now means seconds
  of audio heard.
- Tests: `usePlaybackAnalytics.test.ts` (one case has a day of wall-clock
  time and one minute of audio, and expects 60 s), and
  `audioManager.renderedSeconds.test.ts`.

Data before this change is not comparable. To read old data, exclude events
above a song length (for example 1,800 s).

### Known limit

A practice loop (`loop.confine` in `AudioManager.#handleTrackEnded`) restarts
playback and does not end the song. A loop left running on a machine that
does not sleep keeps the context rendering, so one segment can still report
hours. That time is real audio output. GA data cannot tell whether the
2026-09-01 outlier came from sleep or from a running loop. No cap is applied:
a cap would hide real long sessions, and a filter at query time does the same
job without data loss.

## 2. `/auth/login` as landing page

81 new users and 686 `chart_downloaded` events had `/auth/login` as the
landing page.

### What it is not

- Not a `page_view` from the OAuth return. `/auth/callback` and
  `/auth/confirm` are route handlers that return a redirect. They serve no
  HTML and load no gtag.js.
- Not a referral-caused session split. All of these sessions have
  `sessionSource = (direct)` and an empty `pageReferrer`, so an
  unwanted-referral list or gtag setting changes nothing.
- Not a mail-link scanner. 57 of the 64 error-landing sessions are engaged,
  they have real screen sizes, and they continue to `/`, `/find-music`,
  `/chart-editor`, `/chart` and `/account`.

### Landing pages

About 64 of the 75 sessions land on an error URL on `musiccharts.tools`
(landing-page query string, 28 days):

| Landing                                            | Sessions |
| -------------------------------------------------- | -------- |
| `/auth/login?error=invalid_token`                  | 55       |
| `/auth/login?error=flow_state_already_used&next=/` | 7        |
| `/auth/login?error=otp_expired&next=/`             | 2        |

Almost all are GA "new" users. Of the `invalid_token` landings, 42 are
desktop (Windows Chrome, Opera and Edge) and 13 are mobile (Android Chrome,
iOS Safari). No landing is in an in-app browser (`Safari (in-app)` or
`Android Webview`).

Which code makes each URL:

- `invalid_token`: `app/auth/callback/route.ts:60` when
  `exchangeCodeForSession` fails, and `app/auth/confirm/route.ts:26` when
  `verifyOtp` fails. Both drop `next`. So the absence of `next` on these URLs
  says nothing about the redirect URL that Supabase used.
- `flow_state_already_used`, `otp_expired`: `app/auth/callback/route.ts:18-23`
  forwards a Supabase error. That branch adds `next` with a default of `/`, so
  `next=/` means only that the callback URL had no `next`. A Supabase
  substitution of the redirect URL does that, but so do a login page opened
  with no `next` and the Spotify re-auth in `lib/spotify-sdk/ClientInstance.ts`,
  which calls `getAuthCallbackUrl()` with no argument. This is weak evidence
  and the conclusions below do not use it.

### Two hypotheses

The browser client (`@supabase/ssr` `createBrowserClient`) uses the PKCE
flow. The code verifier is a cookie on the origin where the sign-in started.
`exchangeCodeForSession` fails when the callback runs in a browser or on a
host that does not have that cookie. GA then records a new user, because
`_ga` is a cookie per host and per browser. Two paths fit that:

- **A. Cross-browser magic link.** `LoginForm.tsx` sends a PKCE magic link
  (`signInWithOtp` with `emailRedirectTo`). A user who opens the link in
  another browser, a mail app's browser or a phone has no verifier there.
  `otp_expired` and `flow_state_already_used` also come from email links
  (expired, opened twice, or pre-fetched).
- **B. Sign-in started on `cloneherocharts.vercel.app`.** The app is served
  on two hosts. `cloneherocharts.vercel.app` had 362 users in 28 days and no
  session with a signed-in user ID. A sign-in that starts there and returns to
  `musiccharts.tools/auth/callback` has no verifier cookie on that host.

The GA splits that tell them apart, and the results (28 days, `raw` requests
on `landingPagePlusQueryString`, `date`, `city`, `deviceCategory`, `browser`,
`hostName` and `pagePath`):

| Test                                                        | A predicts                     | B predicts                       | Result                                                                                                    |
| ----------------------------------------------------------- | ------------------------------ | -------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Device and browser of the landing vs. the page that started | different browser or device    | same browser and device          | 44 of 52 landing groups (date, known city, device, browser) have a vercel.app visit in the same group      |
| Base rate of that match                                     | —                              | much higher than for other users | 54 of 840 (6.4%) of the other new-user date/city/device/browser groups on musiccharts.tools              |
| The same match with the date moved ±3 or ±7 days            | —                              | near zero                        | 0 or 1 of 52                                                                                              |
| Page that started the sign-in                               | `/auth/login` (the email form) | any sign-in entry point          | the paired vercel.app visits are mostly `/` and `/find-music`; 11 of 44 include `/auth/login`             |
| In-app browser on the landing                               | common                         | rare                             | none                                                                                                      |

`/find-music` starts a Spotify OAuth sign-in (`FindMusicClient.tsx:426-434`),
not a magic link. So hypothesis B fits most of the landings. Hypothesis A can
explain at most the 8 unpaired groups (5 of them iOS Safari), the landings
with no known city, and the `otp_expired` ones.

The 686 downloads are about 10 users who then signed in again on
`musiccharts.tools` and used the site in that same session.

### Not confirmed

How a sign-in that starts on vercel.app returns to
`musiccharts.tools/auth/callback` is not confirmed. The Supabase dashboard
settings (Site URL, Redirect URLs) were not available to this investigation.
Supabase Auth replaces a `redirectTo` that is not on the allow list with the
Site URL. If the Site URL were the site root, users would land on
`/?code=...`, but GA has no page with `code=` in its query on any host in
28 days. So the observed URL needs a Site URL (or a matching allow-list
entry) that points at `musiccharts.tools/auth/callback`. Nobody has checked
that.

If the owner wants proof before a change, the smallest instrumentation is to
add the exchange error code to the failure redirect in
`app/auth/callback/route.ts:60` (for example
`?error=invalid_token&reason=<error.code>`), and a different `reason` in
`app/auth/confirm/route.ts`. A missing code verifier then shows as its own
landing URL, and a `verifyOtp` failure (a magic link) shows apart from a
PKCE exchange failure.

### Owner action (outside this repo)

Our GA code measures this correctly. The sign-in on `cloneherocharts.vercel.app`
is broken.

1. Read Supabase Auth → URL Configuration: the Site URL and the Redirect URLs.
2. Then either add `https://cloneherocharts.vercel.app/auth/callback` to the
   Redirect URLs, or choose one canonical host. OPFS data is per origin, so a
   redirect from vercel.app strands the data of users on that host.
3. To verify, repeat the pairing test above. Landings on
   `/auth/login?error=invalid_token` that pair with a vercel.app visit should
   go to near zero. What remains is hypothesis A.

### Header login link (fixed)

A small number of landings are `/auth/login?next=/auth/login?next=...`, from
a crawler-like client. The header "Log In" button built `next` from the
current path, and the login page shows that button too, so each follow nested
the URL one level deeper. `loginHref` (`lib/supabase/login-href.ts`) now keeps
the page's own `next` on `/auth/` pages. Test:
`lib/__tests__/login-href.test.ts`.
