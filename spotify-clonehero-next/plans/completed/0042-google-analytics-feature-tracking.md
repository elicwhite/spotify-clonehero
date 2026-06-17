# Plan 0042: Google Analytics feature-usage tracking

> **Scope:** Wire GA4 events for the questions Eli actually asks of the data — feature usage and conversions on `/spotify`, `/spotifyhistory`, `/sheet-music/[slug]`, `/add-lyrics`. No backend.
> **Pages touched:** `app/layout.tsx`, `app/SpotifyTableDownloader.tsx`, `app/spotify/app/Spotify.tsx`, `app/spotifyhistory/SpotifyHistory.tsx`, `app/sheet-music/[slug]/SongView.tsx`, `app/add-lyrics/AddLyricsClient.tsx`, `lib/local-songs-folder/index.ts`, `proxy.ts`.
> **New files:** `lib/analytics/track.ts`, `lib/analytics/consent.ts`, `app/ConsentBanner.tsx`.

## Context

Today the site emits exactly two GA events: `charts_scanned` (post local-folder scan) and `download_song` (one inline call in `lib/local-songs-folder/index.ts`). GA only knows pageviews otherwise. There's no way to answer:

- How many chart downloads happened from `/spotify` vs `/spotifyhistory`?
- Are people using the instrument filters on those pages?
- Add-lyrics: how many songs run through it, by how many people, what % then exported, and how much manual movement happens before export?
- Sheet music: how many songs loaded, time actually playing, which features get used?

Plus there's no consent gating — fine globally but a GDPR risk for EEA/UK visitors.

## Goal

A small, typed analytics facade with feature-usage events that map directly to those questions, plus EEA/UK consent gating via Consent Mode v2 and a Supabase-backed `user_id` for cross-device stitching.

## Non-goals

- No new analytics provider (stays GA4 via `@next/third-parties`).
- No third-party CMP (Cookiebot/OneTrust).
- No autoinstrumented click/scroll heatmaps.
- No drum-transcription, drum-edit, karaoke, or chart-review tracking in this plan.

## Design

### 1. Typed facade — `lib/analytics/track.ts`

A discriminated union of every event with its parameters. One `track()` entrypoint that wraps `sendGAEvent` from `@next/third-parties/google`. Centralizes naming and lets us migrate backends later.

```ts
export type AnalyticsEvent =
  // Library scan / downloads
  | {event: 'charts_scanned'; value: number}
  | {
      event: 'chart_downloaded';
      source:
        | 'spotify'
        | 'spotify_history'
        | 'sheet_music'
        | 'karaoke'
        | 'unknown';
      format: 'sng' | 'chart';
      md5?: string;
    }

  // Spotify pages
  | {
      event: 'spotify_instrument_filter_changed';
      instruments: string;
      count: number;
    }
  | {event: 'spotify_hide_downloaded_toggled'; enabled: boolean}

  // Sheet music
  | {
      event: 'sheet_music_loaded';
      slug: string;
      instrument: string;
      difficulty: string;
      hasAudio: boolean;
      hasVideo: boolean;
    }
  | {event: 'sheet_music_play'}
  | {event: 'sheet_music_pause'}
  | {event: 'sheet_music_speed_changed'; speed: number}
  | {event: 'sheet_music_zoom_changed'; zoom: number}
  | {event: 'sheet_music_difficulty_changed'; difficulty: string}
  | {event: 'sheet_music_clone_hero_toggled'; enabled: boolean}
  | {event: 'sheet_music_click_track_toggled'; enabled: boolean}
  | {event: 'sheet_music_show_lyrics_toggled'; enabled: boolean}
  | {event: 'sheet_music_show_bar_numbers_toggled'; enabled: boolean}
  | {event: 'sheet_music_enable_colors_toggled'; enabled: boolean}
  | {event: 'sheet_music_practice_section_saved'}
  | {event: 'sheet_music_favorited'}
  | {event: 'sheet_music_unfavorited'}
  | {event: 'sheet_music_playback_session'; playSeconds: number}

  // Add-lyrics
  | {event: 'add_lyrics_chart_loaded'; sourceFormat: 'chart' | 'sng' | 'zip'}
  | {event: 'add_lyrics_align_started'}
  | {event: 'add_lyrics_align_completed'; totalMs: number}
  | {event: 'add_lyrics_align_failed'; step: string}
  | {event: 'add_lyrics_realign'}
  | {
      event: 'add_lyrics_exported';
      format: 'sng' | 'zip';
      manualMoveCount: number;
    };

export function track(e: AnalyticsEvent): void;
```

The implementation just forwards to `sendGAEvent(e)`. Errors swallowed (analytics must never crash the app).

### 2. Consent — `lib/analytics/consent.ts` + `app/ConsentBanner.tsx`

GA4 Consent Mode v2 default: outside EEA/UK we set `analytics_storage: 'granted'` (current behavior, no banner). Inside EEA/UK we set `analytics_storage: 'denied'` and render a banner. On accept, call `gtag('consent', 'update', { analytics_storage: 'granted' })` and persist `eea_consent=granted` in `localStorage`.

**Geo detection.** Vercel attaches `x-vercel-ip-country` to incoming requests. Read it in `proxy.ts` (existing Next 16 proxy that already runs on every request) and forward via response header `x-region-eea: 1` when the country is EU/EEA/UK. The root layout reads that header (server-side, via `headers()`) and passes a single boolean to a client `ConsentBanner` component.

EEA list: 27 EU countries + Iceland, Liechtenstein, Norway, UK. (Switzerland is _not_ in EEA but enforces FADP — out of scope for v1; revisit if needed.)

**Default consent script.** Inject a tiny inline script before `<GoogleAnalytics>` that sets `dataLayer`/`gtag` and calls `gtag('consent', 'default', { analytics_storage: <value> })`. This must run _before_ the GA snippet to be respected.

### 3. User ID

`AuthProvider.tsx` already wraps the app and exposes the Supabase session. Add an effect: when session exists, call `window.gtag?.('config', 'G-LEE7EDJH14', { user_id: session.user.id })`; on sign-out, call with `user_id: undefined` to clear. UUID, no PII.

### 4. Per-flow event wiring

- **`lib/local-songs-folder/index.ts`** — keep `charts_scanned`. Replace `download_song` with a parameterized `chart_downloaded`. Plumb a `source` parameter through `downloadSong()`.
- **`SpotifyTableDownloader`** — accept a `source: 'spotify' | 'spotify_history'` prop; thread it to `downloadSong()` calls. Fire filter events from `Filters` component and the hide-downloaded checkbox.
- **`SongView.tsx`** — emit `sheet_music_loaded` once on mount (post-chart-load); fire toggle/value events from each existing handler. Track playback time: maintain `playStartTimestamp` on play, on pause/unmount/pagehide compute `playSeconds += (now - start) / 1000` and emit `sheet_music_playback_session { playSeconds }` if > 1.0.
- **`AddLyricsClient.tsx`** — emit `add_lyrics_chart_loaded` on `handleChartLoaded` (with detected `sourceFormat`); `add_lyrics_align_started` on Align click; `add_lyrics_align_completed { totalMs }` on success; `add_lyrics_align_failed { step }` on error. Emit `add_lyrics_realign` on the Re-enter-lyrics button.
- **Manual move counter** — extend `ChartEditorContext` with a counter that increments when `MoveEntitiesCommand` is executed against any entity whose handler key is `lyric` / `vocalPhrase` / `syllable`. Reset when alignment finishes (i.e. on entry into the editor view). Read counter on export and emit it as `manualMoveCount` on `add_lyrics_exported`.

## Non-events / explicitly skipped

- Auth flow events (login/sign-up). Out of scope; can add later.
- Chart-review, drum-edit, drum-transcription, karaoke. Out of scope.
- Per-feature events on flow pages we _aren't_ prioritizing (e.g. account, search inputs).

## Commit plan

1. **Plan + facade.** Add this file + `lib/analytics/track.ts`. Migrate the two existing `sendGAEvent` callsites in `lib/local-songs-folder/index.ts` to `track()`. No behavior change.
2. **Consent (EEA/UK only).** `lib/analytics/consent.ts`, `app/ConsentBanner.tsx`, geo header in `proxy.ts`, default-consent script + banner in `layout.tsx`.
3. **User ID.** Hook into `AuthProvider`. `gtag('config', …, { user_id })` on session change.
4. **Spotify pages.** Add `source` prop to `SpotifyTableDownloader`; thread to `downloadSong`. Filter + hide-downloaded events. `chart_downloaded` event becomes typed.
5. **Sheet music.** Load + per-feature events + playback session timer.
6. **Add-lyrics.** Load / align / export events + manual-move counter in `ChartEditorContext`.

Each commit is independently reviewable; no commit leaves the build broken.
