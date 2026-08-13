import type {DrumType} from '@eliwhite/scan-chart';
import type {CoreInstrument} from '@/lib/chorusChartDb/types';

/**
 * Display metadata for the instruments this page renders: id, badge, label.
 *
 * "Drums" means four-lane pro throughout — presence, badge and filter alike.
 * Clone Hero drummers play pro, it is 23,912 of the 25,598 charted kits, and
 * carrying the other two types through the UI bought markers and filter
 * caveats that nobody was asking for. A five-lane or plain four-lane chart
 * simply has no drums here.
 */
export const INSTRUMENTS = [
  ['guitar', 'G', 'Guitar'],
  ['bass', 'B', 'Bass'],
  ['keys', 'K', 'Keys'],
  ['drums', 'D', 'Drums'],
] as const satisfies readonly (readonly [CoreInstrument, string, string])[];

export type InstrumentId = (typeof INSTRUMENTS)[number][0];
export type InstallFilter = 'all' | 'hide-installed';
export type FindMusicView = 'music' | 'radar';

export type FindMusicChart = {
  md5: string;
  artist: string;
  name: string;
  charter: string;
  modifiedTime: string;
  albumArtMd5: string | null;
  groupId: number;
  hasVideoBackground: boolean;
  hasOtherInstruments: boolean;
  /**
   * What scan-chart observed in the drums track, or null when there isn't one.
   * This is the pro-drums signal; the `pro_drums` ini flag disagrees with it on
   * roughly half the catalog and is not used.
   */
  drumType: DrumType | null;
  isInstalled: boolean;
  instruments: Record<InstrumentId, number | null>;
  instrumentPresence: Record<InstrumentId, boolean>;
};

export type FindMusicProviderAction =
  | {
      provider: 'spotify';
      trackId: string;
      url: string;
      artist: string;
      song: string;
    }
  | {
      provider: 'appleMusic';
      catalogId: string;
      artist: string;
      song: string;
    };

export type FindMusicSong = {
  key: string;
  artist: string;
  song: string;
  playCount: number;
  playlists: string[];
  albums: string[];
  spotifyUrl: string | null;
  providerActions: FindMusicProviderAction[];
  inAppleMusicLibrary: boolean;
  hasInstalledChart: boolean;
  charts: FindMusicChart[];
};

export type RadarSong = {
  key: string;
  artist: string;
  song: string;
  artistPlayCount: number;
  savedLibrarySongCount: number;
  // Carried from the candidate query so the score shown is the score that
  // ranked the row, rather than one recomputed from the hydrated charts.
  chartCount: number;
  availableInstrumentCount: number;
  spotifyUrl: string | null;
  hasInstalledChart: boolean;
  charts: FindMusicChart[];
};

export type FindMusicStats = {
  historySongs: number;
  playlists: number;
  albums: number;
  libraryTracks: number;
  spotifyLibraryTracks: number;
  appleMusicLibraryTracks: number;
  chorusCharts: number;
  localCharts: number;
  historyUpdatedAt: string | null;
  libraryUpdatedAt: string | null;
  spotifyLibraryUpdatedAt: string | null;
  appleMusicLibraryUpdatedAt: string | null;
  appleMusicStorefront: string | null;
  localUpdatedAt: string | null;
};

export type SourcePhase = 'idle' | 'loading' | 'ready' | 'error';

export type SourceStatus = {
  phase: SourcePhase;
  summary: string;
  progress?: number;
  detail?: string;
};

export type FindMusicFilters = {
  install: InstallFilter;
  instruments: Set<InstrumentId>;
  query: string;
  exclusions: string[];
  exclusionDraft: string;
};

export function chartHasInstruments(
  chart: FindMusicChart,
  instruments: Set<InstrumentId>,
): boolean {
  for (const instrument of instruments) {
    if (!chart.instrumentPresence[instrument]) return false;
  }
  return true;
}

export const EMPTY_FILTERS: FindMusicFilters = {
  install: 'all',
  instruments: new Set(),
  query: '',
  exclusions: [],
  exclusionDraft: '',
};
