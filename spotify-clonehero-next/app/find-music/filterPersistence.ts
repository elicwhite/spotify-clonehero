import {
  EMPTY_FILTERS,
  type FindMusicFilters,
  type InstallFilter,
  type InstrumentId,
} from './types';

export const FIND_MUSIC_FILTERS_STORAGE_KEY = 'find-music:filters:v1';

const FILTER_INSTRUMENTS: InstrumentId[] = [
  'guitar',
  'bass',
  'keys',
  'proDrums',
];

export function freshEmptyFilters(): FindMusicFilters {
  return {
    ...EMPTY_FILTERS,
    instruments: new Set(),
    exclusions: [],
  };
}

export function loadFindMusicFilters(
  storage: Pick<Storage, 'getItem'>,
): FindMusicFilters {
  try {
    const raw = storage.getItem(FIND_MUSIC_FILTERS_STORAGE_KEY);
    if (!raw) return freshEmptyFilters();

    const saved: unknown = JSON.parse(raw);
    if (!isObject(saved)) return freshEmptyFilters();

    const install: InstallFilter =
      saved['install'] === 'hide-installed' ? 'hide-installed' : 'all';
    const query = typeof saved['query'] === 'string' ? saved['query'] : '';
    const exclusionDraft =
      typeof saved['exclusionDraft'] === 'string'
        ? saved['exclusionDraft']
        : '';
    const exclusions = normalizeExclusions(saved['exclusions']);
    const instruments = new Set<InstrumentId>();
    if (Array.isArray(saved['instruments'])) {
      for (const instrument of saved['instruments']) {
        if (
          typeof instrument === 'string' &&
          FILTER_INSTRUMENTS.includes(instrument as InstrumentId)
        ) {
          instruments.add(instrument as InstrumentId);
        }
      }
    }

    return {install, instruments, query, exclusions, exclusionDraft};
  } catch {
    return freshEmptyFilters();
  }
}

export function saveFindMusicFilters(
  storage: Pick<Storage, 'setItem'>,
  filters: FindMusicFilters,
): void {
  try {
    storage.setItem(
      FIND_MUSIC_FILTERS_STORAGE_KEY,
      JSON.stringify({
        install: filters.install,
        instruments: [...filters.instruments],
        query: filters.query,
        exclusions: filters.exclusions,
        exclusionDraft: filters.exclusionDraft,
      }),
    );
  } catch {
    // Filtering should continue to work when storage is blocked or full.
  }
}

function normalizeExclusions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  const exclusions: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const exclusion = item.trim();
    const normalized = exclusion.toLocaleLowerCase('en-US');
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    exclusions.push(exclusion);
  }
  return exclusions;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
