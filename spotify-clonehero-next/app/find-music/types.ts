export const INSTRUMENTS = [
  ['drums', 'D', 'Drums'],
  ['guitar', 'G', 'Guitar'],
  ['bass', 'B', 'Bass'],
  ['keys', 'K', 'Keys'],
  ['proDrums', 'PD', 'Pro drums'],
] as const;

export type InstrumentId = (typeof INSTRUMENTS)[number][0];
export type InstallFilter = 'all' | 'hide-installed' | 'only-installed';
export type EvidenceFilter = 'history' | 'playlist' | 'album';
export type FindMusicView = 'music' | 'radar';

export type FindMusicChart = {
  md5: string;
  artist: string;
  name: string;
  charter: string;
  modifiedTime: string;
  songLength: number | null;
  albumArtMd5: string | null;
  groupId: number;
  hasVideoBackground: boolean;
  isInstalled: boolean;
  instruments: Record<InstrumentId, number | null>;
};

export type FindMusicSong = {
  key: string;
  artist: string;
  song: string;
  playCount: number;
  playlists: string[];
  albums: string[];
  hasInstalledChart: boolean;
  charts: FindMusicChart[];
};

export type RadarSong = {
  key: string;
  artist: string;
  song: string;
  artistPlayCount: number;
  hasInstalledChart: boolean;
  charts: FindMusicChart[];
};

export type FindMusicStats = {
  historySongs: number;
  playlists: number;
  albums: number;
  libraryTracks: number;
  chorusCharts: number;
  localCharts: number;
  historyUpdatedAt: string | null;
  libraryUpdatedAt: string | null;
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
  minPlays: number;
  evidence: Set<EvidenceFilter>;
};

export const EMPTY_FILTERS: FindMusicFilters = {
  install: 'all',
  instruments: new Set(),
  minPlays: 0,
  evidence: new Set(),
};
