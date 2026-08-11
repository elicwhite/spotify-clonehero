export const INSTRUMENTS = [
  ['guitar', 'G', 'Guitar'],
  ['bass', 'B', 'Bass'],
  ['keys', 'K', 'Keys'],
  ['proDrums', 'D', 'Pro drums'],
] as const;

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

export const EMPTY_FILTERS: FindMusicFilters = {
  install: 'all',
  instruments: new Set(),
  query: '',
  exclusions: [],
  exclusionDraft: '',
};
