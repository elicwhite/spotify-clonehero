import {sendGAEvent} from '@next/third-parties/google';

import type {AssistTaskKey} from '@/lib/assist/tasks/types';
import type {SourceFormat} from '@/lib/chart-files/chart-package';
import type {PackageFormat} from '@/lib/chart-export';
import type {ChartOrigin, ProjectOrigin} from '@/lib/project-storage/types';

/** The tools with a landing route of their own. The editor is where they all
 *  arrive, so it never fires a landing view. */
export type LandingTool = Exclude<ProjectOrigin, 'chart-editor'>;

/**
 * How this particular run was started. Distinct from `ChartOrigin`, which
 * says where the chart came from: a chart with `origin: 'tempo'` collecting
 * `assist-card` runs is the normal case, not a contradiction.
 */
export type AssistEntrypoint =
  | 'landing'
  | 'assist-card'
  | 'matrix-row'
  | 'dialog';

/** Why the editor refused a chart. A closed set the loader already branches
 *  on, so it can never degrade into the `"unknown"` that made
 *  `add_lyrics_align_failed` useless for 90 days. */
export type ChartOpenFailureReason =
  | 'no-supported-track'
  | 'no-audio'
  | 'parse-error'
  /**
   * The chart itself was accepted; preparing it on this device failed —
   * an OPFS write, the navigation, or starting the audio pipeline. Not a
   * property of the chart, so it must not be counted among the users who
   * arrive with charts a tool refuses.
   */
  | 'storage-error';

/** How a chart entered the editor: the package format it was loaded from, or
 *  the two ways one can be started from nothing. */
export type ChartOpenSource = SourceFormat | 'blank' | 'audio';

/**
 * Where a chart download came from. `downloadSong` takes this same type, so the
 * two stay in step. 'sheet_music' and 'karaoke' are forward-declared — those
 * flows can already trigger downloads but don't yet thread `source` through.
 * Wire them when the relevant pages start passing it.
 */
export type ChartDownloadSource =
  | 'find_music'
  | 'sheet_music'
  | 'karaoke'
  | 'unknown';

export type AnalyticsEvent =
  // Library scan / downloads
  | {event: 'charts_scanned'; value: number}
  | {
      event: 'chart_downloaded';
      source: ChartDownloadSource;
      format: 'sng' | 'chart';
      md5?: string | undefined;
    }

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
  // The funnel's terminal event. The page aligns and then hands the chart to
  // /chart-editor, so reaching the editor is the conversion; the export that
  // used to end the funnel now happens there, against a saved project.
  | {event: 'add_lyrics_handed_off'}

  // Chart-authoring funnel (plan 0105). One shape for every tool, keyed on
  // `origin`/`entrypoint`/`task` rather than on the route, so a tool keeps
  // reporting under its own name after its landing page becomes a redirect.
  //
  //   1. tool_landing_viewed   each landing route
  //   2. chart_opened          the editor accepted a chart
  //   3. assist_run_started    a task began
  //   4. assist_run_completed  it finished
  //   5. chart_exported        the chart was downloaded
  //
  // A run started from the sidebar is not a funnel of its own: the chart was
  // already open, so steps 1 and 2 belong to whatever opened it. Segment
  // `assist_run_*` by `entrypoint` instead of defining a second funnel.
  | {event: 'tool_landing_viewed'; tool: LandingTool}
  | {event: 'chart_opened'; origin: ChartOrigin; sourceFormat: ChartOpenSource}
  | {
      event: 'chart_open_failed';
      origin: ChartOrigin;
      reason: ChartOpenFailureReason;
    }
  | ({event: 'assist_run_started'} & AssistRunDimensions)
  | ({event: 'assist_run_completed'; durationMs: number} & AssistRunDimensions)
  // `step` is the planned step that was active when the run ended, which the
  // runner already tracks. The error message itself is never sent: it can
  // contain a file name, and file names are user data.
  | ({
      event: 'assist_run_failed';
      durationMs: number;
      step: string;
    } & AssistRunDimensions)
  | ({
      event: 'assist_run_cancelled';
      durationMs: number;
      step: string;
    } & AssistRunDimensions)
  | {
      event: 'chart_exported';
      origin: ChartOrigin;
      format: PackageFormat;
      /**
       * The `charter` credit from `song.ini`, trimmed and capped. A charter
       * writes this about themselves and publishes it inside every chart
       * they release, so it is a credit rather than personal data — and it
       * is the only field that can answer which charters use the tool.
       */
      charter: string;
      /**
       * An opaque hash of the song's identity, never its title. Two exports
       * of one chart share a key, so repeat exports collapse to a single
       * funnel run instead of reading as new charts.
       */
      songKey: string;
      /** Which assist tasks were applied to this chart before it shipped,
       *  sorted and comma-joined. Empty when the user only edited by hand. */
      tools: string;
    };

/** The three dimensions every assist-run event carries. Shared so a new
 *  terminal state cannot be added with only some of them. */
interface AssistRunDimensions {
  task: AssistTaskKey;
  origin: ChartOrigin;
  entrypoint: AssistEntrypoint;
}

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
