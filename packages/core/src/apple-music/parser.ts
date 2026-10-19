type MusicKitResponse = Record<string, unknown>;

/** The small, non-personal subset of a library resource that may be stored. */
export type AppleMusicLibrarySong = {
  artistName: string;
  title: string;
  catalogId: string | null;
};

export type AppleMusicLibraryPage = {
  songs: AppleMusicLibrarySong[];
  fetchedCount: number;
  catalogAssociatedCount: number;
  total: number | null;
  nextPath: string | null;
};

export type AppleMusicCatalogSong = {
  catalogId: string;
  artistName: string;
  title: string;
  url: string;
  previewUrl: string | null;
};

function asRecord(value: unknown): MusicKitResponse | null {
  return value !== null && typeof value === 'object'
    ? (value as MusicKitResponse)
    : null;
}

/** MusicKit wraps API bodies in `data`; the REST body itself also has `data`. */
export function responseBody(value: unknown): MusicKitResponse {
  const response = asRecord(value);
  if (!response) return {};
  const nested = asRecord(response['data']);
  return nested ?? response;
}

function resources(value: unknown): MusicKitResponse[] {
  const body = responseBody(value);
  const data = Array.isArray(body['data']) ? body['data'] : [];
  return data.flatMap(item => {
    const record = asRecord(item);
    return record ? [record] : [];
  });
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function catalogIdFor(song: MusicKitResponse): string | null {
  const attributes = asRecord(song['attributes']);
  const playParams = asRecord(attributes?.['playParams']);
  const fromPlayParams = nonEmptyString(playParams?.['catalogId']);
  if (fromPlayParams) return fromPlayParams;

  const relationships = asRecord(song['relationships']);
  const catalog = asRecord(relationships?.['catalog']);
  const catalogResources = Array.isArray(catalog?.['data'])
    ? catalog['data']
    : [];
  for (const resource of catalogResources) {
    const record = asRecord(resource);
    const id = nonEmptyString(record?.['id']);
    if (id) return id;
  }
  return null;
}

/**
 * Extracts only usable matching data. Apple library IDs and all raw payload
 * fields deliberately stay out of this boundary.
 */
export function readLibrarySong(
  resource: unknown,
): AppleMusicLibrarySong | null {
  const song = asRecord(resource);
  if (!song) return null;
  const attributes = asRecord(song?.['attributes']);
  const artistName = nonEmptyString(attributes?.['artistName']);
  const title = nonEmptyString(attributes?.['name']);
  if (!artistName || !title) return null;
  return {artistName, title, catalogId: catalogIdFor(song)};
}

/** Parses one page without attempting to fabricate pagination offsets. */
export function readLibraryPage(value: unknown): AppleMusicLibraryPage {
  const body = responseBody(value);
  const pageResources = resources(value);
  const songs = pageResources.flatMap(resource => {
    const song = readLibrarySong(resource);
    return song ? [song] : [];
  });
  const catalogAssociatedCount = pageResources.filter(
    resource => catalogIdFor(resource) !== null,
  ).length;
  const meta = asRecord(body['meta']);
  const next = nonEmptyString(body['next']);

  return {
    songs,
    fetchedCount: pageResources.length,
    catalogAssociatedCount,
    total: numberValue(meta?.['total']),
    nextPath: next,
  };
}

function webUrl(value: unknown): string | null {
  const text = nonEmptyString(value);
  if (!text) return null;
  try {
    const url = new URL(text);
    return url.protocol === 'https:' || url.protocol === 'http:'
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function catalogSongFromResource(
  resource: unknown,
): AppleMusicCatalogSong | null {
  const song = asRecord(resource);
  const attributes = asRecord(song?.['attributes']);
  const catalogId = nonEmptyString(song?.['id']);
  const artistName = nonEmptyString(attributes?.['artistName']);
  const title = nonEmptyString(attributes?.['name']);
  const url = webUrl(attributes?.['url']);
  if (!catalogId || !artistName || !title || !url) return null;

  const previews = Array.isArray(attributes?.['previews'])
    ? attributes['previews']
    : [];
  let previewUrl: string | null = null;
  for (const preview of previews) {
    previewUrl = webUrl(asRecord(preview)?.['url']);
    if (previewUrl) break;
  }
  return {catalogId, artistName, title, url, previewUrl};
}

/** Parses a direct catalog-song response, accepting only complete actions. */
export function readCatalogSong(value: unknown): AppleMusicCatalogSong | null {
  return catalogSongFromResource(resources(value)[0]);
}

/**
 * Returns all complete candidates from a catalog search response. MusicKit
 * search nests resources under `results.songs.data`, unlike ordinary routes.
 */
export function readCatalogSearchSongs(
  value: unknown,
): AppleMusicCatalogSong[] {
  const body = responseBody(value);
  const results = asRecord(body['results']);
  const songs = asRecord(results?.['songs']);
  const data = Array.isArray(songs?.['data']) ? songs['data'] : [];
  const byId = new Map<string, AppleMusicCatalogSong>();
  for (const candidate of data) {
    const song = catalogSongFromResource(candidate);
    if (song) byId.set(song.catalogId, song);
  }
  return [...byId.values()];
}

/** Conservative equality for the explicit artist/title fallback lookup. */
export function normalizeAppleMusicSearchText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}
