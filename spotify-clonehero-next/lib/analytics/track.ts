import {sendGAEvent} from '@next/third-parties/google';

export type AnalyticsEvent =
  // Library scan / downloads
  | {event: 'charts_scanned'; value: number}
  | {
      event: 'chart_downloaded';
      // 'sheet_music' / 'karaoke' are forward-declared — those flows can
      // already trigger downloads but don't yet thread `source` through.
      // Wire them when the relevant pages start passing it.
      source:
        | 'spotify'
        | 'spotify_history'
        | 'sheet_music'
        | 'karaoke'
        | 'unknown';
      format: 'sng' | 'chart';
      md5?: string | undefined;
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
  | {event: 'add_lyrics_chart_loaded'; sourceFormat: 'folder' | 'sng' | 'zip'}
  | {event: 'add_lyrics_align_started'}
  | {
      event: 'add_lyrics_align_completed';
      totalMs: number;
      lowConfidence: 0 | 1;
      lowConfidenceFrac: number;
    }
  | {event: 'add_lyrics_align_failed'; step: string}
  | {event: 'add_lyrics_realign'}
  | {
      event: 'add_lyrics_exported';
      format: 'sng' | 'zip';
      manualMoveCount: number;
    };

// Latest user_id passed to setAnalyticsUserId. AuthProvider's effect
// can resolve before gtag.js loads, in which case the immediate
// gtag('set', ...) call below is a no-op (window.gtag undefined).
// `track()` re-pushes on every event so the value lands as soon as
// gtag is available.
//   undefined → never set (don't push anything)
//   null      → explicitly cleared (push undefined to clear in GA)
//   string    → signed-in user UUID
let cachedUserId: string | null | undefined = undefined;

function applyUserId(): void {
  if (cachedUserId === undefined) return;
  if (typeof window === 'undefined' || !window.gtag) return;
  window.gtag('set', {user_id: cachedUserId ?? undefined});
}

// `sendGAEvent` is a thin wrapper that pushes `arguments` onto the
// dataLayer, so it must be called with gtag's positional form
// (gtag('event', name, params)) — passing a single object pushes
// `[{event, ...}]` which gtag rejects as "Invalid command name".
export function track(payload: AnalyticsEvent): void {
  try {
    applyUserId();
    const {event, ...params} = payload;
    sendGAEvent('event', event, params);
  } catch {
    // Analytics never throws into product code.
  }
}

// Stitches sessions across devices for logged-in users. Pass null on
// sign-out to clear. UUID only (no email/PII).
export function setAnalyticsUserId(userId: string | null): void {
  cachedUserId = userId;
  try {
    applyUserId();
  } catch {
    // ignore
  }
}
