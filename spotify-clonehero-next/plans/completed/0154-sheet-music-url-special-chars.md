# 0154 — Keep chart URLs to one path segment, and recover split ones

Status: completed

## Why

GA4 showed one landing page of this shape (2026-09-21):

```
/sheet-music/<song>-<artist>-<md5>https:/musiccharts.tools/sheet-music/<song>-<artist>-<md5>
```

It is the page URL pasted onto the end of itself. Our code does not make it:

- `getSheetMusicUrl` makes a root-relative path and nothing else. No code
  prepends a path to an absolute URL, and there is no share or copy-link
  control on `/sheet-music`.
- The login links (`HeaderAuthControls`, `SongView`'s save button) put the
  pathname only in `?next=`. `/auth/callback` accepts only a `next` that
  starts with `/` and prepends the origin one time.
- The GA session had a `first_visit` with an empty referrer on the doubled
  page: a new browser profile with a typed or pasted URL. It had no
  `sheet_music_loaded` event, because the path has five segments and no route
  matches it (404). A minute later a second `first_visit` with an empty
  referrer loaded the correct URL.
- The single slash in `https:/` comes from Next: `base-server` answers 308 to
  a path with `//` in it and collapses each run of slashes.

So the doubled URL is a paste error outside the app. But the same audit found
that `getSheetMusicUrl` (and `getKaraokeUrl`) put the song and artist into the
path without encoding:

- a `/` in a name splits the slug into more segments (404);
- a `?` or `#` in a name moves the md5 into the query or fragment
  ("Invalid chart");
- a `%` in a name makes an invalid escape (400).

## Changes

1. `app/songSlug.ts`: `buildSongSlug` percent-encodes the song and the
   artist. `getMd5FromSlug` moves here from `app/getMd5FromSlug.ts`, beside
   the builder, and every import is updated. Both URL builders use
   `buildSongSlug`.
2. `app/sheet-music/[slug]/[...rest]/page.tsx`: a chart path with more than
   one segment redirects (307) to `/sheet-music/<last segment>` when the last
   segment ends in an md5, and answers 404 when it does not. This recovers the
   pasted-twice URL and links that a raw `/` in a name already split.
3. `app/__tests__/songSlug.test.ts`: names with `/`, `?`, `#`, `%`, accents,
   hyphens, `&` and `+` stay in one segment and give back the md5; the
   pasted-twice URL and a split slug give the right redirect target.

## Verification

- `pnpm test app/__tests__/songSlug.test.ts`, `pnpm typecheck`, eslint and
  prettier on the touched files.
- `next dev` probes: the pasted-twice URL answers 308 then 307 to the chart; a
  split slug answers 307; `/sheet-music/x/y` answers 404; an encoded slug with
  `?`, `/` and `%` in the names loads the chart; the `opengraph-image` route
  under `[slug]` still answers 200 `image/png`.

## Left for later

- Only `next dev` was probed. Before release, run `next build && next start`
  (and check the Vercel preview) with one `%2F` slug and the pasted-twice URL.
  The redirect needs the params to arrive percent-encoded, and a `%2F` slug
  needs the server to keep the encoded slash inside one segment.
- `/karaoke` gets the encoded slugs but no `[...rest]` recovery route.
