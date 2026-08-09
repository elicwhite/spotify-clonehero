import {
  normalizeAppleMusicSearchText,
  readCatalogSearchSongs,
  readCatalogSong,
  readLibraryPage,
  responseBody,
  type AppleMusicCatalogSong,
  type AppleMusicLibrarySong,
} from './parser';

export const MUSICKIT_CDN_URL =
  'https://js-cdn.music.apple.com/musickit/v3/musickit.js';

type MusicKitResponse = Record<string, unknown>;
type MusicKitParameters = Record<string, string | number>;

type MusicKitInstance = {
  readonly isAuthorized: boolean;
  authorize(): Promise<string | void>;
  unauthorize(): Promise<void>;
  api: {
    music(path: string, parameters?: MusicKitParameters): Promise<unknown>;
  };
};

type MusicKitGlobal = {
  configure(configuration: {
    developerToken: string;
    app: {name: string; build: string};
  }): Promise<MusicKitInstance>;
};

export type AppleMusicClient = {
  isAuthorized(): boolean;
  authorize(): Promise<void>;
  unauthorize(): Promise<void>;
};

export type AppleMusicLibraryProgress = {
  total: number | null;
  fetchedCount: number;
  usableCount: number;
  catalogAssociatedCount: number;
  pagesFetched: number;
};

export type AppleMusicLibraryScan = AppleMusicLibraryProgress & {
  storefront: string | null;
  songs: AppleMusicLibrarySong[];
};

export type AppleMusicLibraryFetchOptions = {
  signal?: AbortSignal;
  onProgress?: (progress: AppleMusicLibraryProgress) => void;
};

export type AppleMusicCatalogSearch = {
  artistName: string;
  title: string;
};

export type AppleMusicCatalogResolveOptions = {signal?: AbortSignal};

/** The richer browser-only surface used by the Find Music integration. */
export type AppleMusicLibraryClient = AppleMusicClient & {
  fetchLibrarySongs(
    options?: AppleMusicLibraryFetchOptions,
  ): Promise<AppleMusicLibraryScan>;
  resolveCatalogSong(
    catalogId: string,
    options?: AppleMusicCatalogResolveOptions,
  ): Promise<AppleMusicCatalogSong | null>;
  searchCatalogSong(
    query: AppleMusicCatalogSearch,
    options?: AppleMusicCatalogResolveOptions,
  ): Promise<AppleMusicCatalogSong | null>;
};

export type AppleMusicErrorCode =
  | 'aborted'
  | 'unauthorized'
  | 'rate_limited'
  | 'transient'
  | 'malformed_response'
  | 'unknown';

/** An intentionally payload-free error suitable for deciding UI recovery. */
export class AppleMusicError extends Error {
  readonly code: AppleMusicErrorCode;

  constructor(code: AppleMusicErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'AppleMusicError';
    this.code = code;
  }
}

function asRecord(value: unknown): MusicKitResponse | null {
  return value !== null && typeof value === 'object'
    ? (value as MusicKitResponse)
    : null;
}

function getMusicKitGlobal(): MusicKitGlobal {
  const candidate = (window as Window & {MusicKit?: unknown}).MusicKit;
  const musicKit = asRecord(candidate);
  if (typeof musicKit?.['configure'] !== 'function') {
    throw new AppleMusicError('unknown', 'MusicKit did not load');
  }
  return musicKit as unknown as MusicKitGlobal;
}

function abortError(): AppleMusicError {
  return new AppleMusicError('aborted', 'Apple Music request was cancelled');
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw abortError();
}

function errorStatus(value: unknown): number | null {
  const record = asRecord(value);
  const direct = record?.['status'] ?? record?.['statusCode'];
  if (typeof direct === 'number') return direct;
  const response = asRecord(record?.['response']);
  const nested = response?.['status'];
  return typeof nested === 'number' ? nested : null;
}

/** Maps transport shapes from MusicKit without retaining error bodies. */
export function classifyAppleMusicError(error: unknown): AppleMusicError {
  if (error instanceof AppleMusicError) return error;
  if (asRecord(error)?.['name'] === 'AbortError') return abortError();
  const status = errorStatus(error);
  if (status === 401 || status === 403) {
    return new AppleMusicError(
      'unauthorized',
      'Apple Music authorization expired',
    );
  }
  if (status === 429) {
    return new AppleMusicError(
      'rate_limited',
      'Apple Music is rate limiting requests',
    );
  }
  if (status !== null && status >= 500) {
    return new AppleMusicError(
      'transient',
      'Apple Music is temporarily unavailable',
    );
  }
  return new AppleMusicError('unknown', 'Apple Music request failed');
}

function validNextPath(path: string | null): string | null {
  if (!path) return null;
  // Apple's API sends a relative route. Refusing other forms prevents a bad
  // response from turning MusicKit into a general-purpose request client.
  return path.startsWith('/v1/') ? path : null;
}

function storefrontFromResponse(response: unknown): string | null {
  const body = responseBody(response);
  const data = Array.isArray(body['data']) ? body['data'] : [];
  const first = asRecord(data[0]);
  const id = first?.['id'];
  return typeof id === 'string' && id.trim() ? id.trim() : null;
}

function assertPageResponse(response: unknown): void {
  const body = responseBody(response);
  if (!Array.isArray(body['data'])) {
    throw new AppleMusicError(
      'malformed_response',
      'Apple Music returned an invalid library page',
    );
  }
}

function assertStorefrontResponse(response: unknown): void {
  const storefront = storefrontFromResponse(response);
  if (!storefront) {
    throw new AppleMusicError(
      'malformed_response',
      'Apple Music returned an invalid storefront',
    );
  }
}

/** Keeps MusicKit's hosted SDK and user token behind a small client surface. */
export async function configureAppleMusicClient(
  developerToken: string,
): Promise<AppleMusicLibraryClient> {
  const instance = await getMusicKitGlobal().configure({
    developerToken,
    app: {name: 'Music Charts Tools', build: 'find-music'},
  });
  const catalogCache = new Map<string, Promise<AppleMusicCatalogSong | null>>();
  const searchCache = new Map<string, Promise<AppleMusicCatalogSong | null>>();
  let storefrontPromise: Promise<string> | null = null;

  async function request(path: string, parameters?: MusicKitParameters) {
    try {
      return parameters === undefined
        ? await instance.api.music(path)
        : await instance.api.music(path, parameters);
    } catch (error) {
      throw classifyAppleMusicError(error);
    }
  }

  async function storefront(signal?: AbortSignal): Promise<string> {
    throwIfAborted(signal);
    if (!storefrontPromise) {
      const pending = request('/v1/me/storefront').then(response => {
        assertStorefrontResponse(response);
        return storefrontFromResponse(response)!;
      });
      storefrontPromise = pending;
      // Share one in-flight request, but let a later scan or media action retry
      // after either a transport failure or a malformed storefront response.
      void pending.catch(() => {
        if (storefrontPromise === pending) storefrontPromise = null;
      });
    }
    const value = await storefrontPromise;
    throwIfAborted(signal);
    return value;
  }

  async function resolveCatalogSong(
    catalogId: string,
    options: AppleMusicCatalogResolveOptions = {},
  ): Promise<AppleMusicCatalogSong | null> {
    throwIfAborted(options.signal);
    const id = catalogId.trim();
    if (!id) return null;
    const market = await storefront(options.signal);
    throwIfAborted(options.signal);
    const key = `${market}:${id}`;
    let pending = catalogCache.get(key);
    if (!pending) {
      pending = request(
        `/v1/catalog/${encodeURIComponent(market)}/songs/${encodeURIComponent(id)}`,
      ).then(response => readCatalogSong(response));
      catalogCache.set(key, pending);
      // Failed transports are retryable; do not poison the session cache.
      void pending.catch(() => catalogCache.delete(key));
    }
    const resolved = await pending;
    throwIfAborted(options.signal);
    return resolved?.catalogId === id ? resolved : null;
  }

  return {
    isAuthorized: () => instance.isAuthorized,
    async authorize() {
      await instance.authorize();
    },
    unauthorize: () => instance.unauthorize(),
    async fetchLibrarySongs(options = {}) {
      const {signal, onProgress} = options;
      throwIfAborted(signal);
      const market = await storefront(signal);
      let path = '/v1/me/library/songs';
      let parameters: MusicKitParameters | undefined = {limit: 100};
      let total: number | null = null;
      let fetchedCount = 0;
      let usableCount = 0;
      let catalogAssociatedCount = 0;
      let pagesFetched = 0;
      const songs: AppleMusicLibrarySong[] = [];
      const visited = new Set<string>();

      while (path) {
        throwIfAborted(signal);
        if (visited.has(path)) {
          throw new AppleMusicError(
            'malformed_response',
            'Apple Music repeated a library page',
          );
        }
        visited.add(path);
        const response = await request(path, parameters);
        throwIfAborted(signal);
        assertPageResponse(response);
        const page = readLibraryPage(response);
        total ??= page.total;
        fetchedCount += page.fetchedCount;
        usableCount += page.songs.length;
        catalogAssociatedCount += page.catalogAssociatedCount;
        pagesFetched += 1;
        songs.push(...page.songs);
        onProgress?.({
          total,
          fetchedCount,
          usableCount,
          catalogAssociatedCount,
          pagesFetched,
        });

        const nextPath = validNextPath(page.nextPath);
        if (page.nextPath !== null && nextPath === null) {
          throw new AppleMusicError(
            'malformed_response',
            'Apple Music returned an invalid library page link',
          );
        }
        path = nextPath ?? '';
        parameters = undefined;
      }
      if (total !== null && total !== fetchedCount) {
        throw new AppleMusicError(
          'malformed_response',
          'Apple Music returned an incomplete library scan',
        );
      }
      return {
        storefront: market,
        total,
        fetchedCount,
        usableCount,
        catalogAssociatedCount,
        pagesFetched,
        songs,
      };
    },
    resolveCatalogSong,
    async searchCatalogSong(query, options = {}) {
      throwIfAborted(options.signal);
      const artistName = query.artistName.trim();
      const title = query.title.trim();
      if (!artistName || !title) return null;
      const market = await storefront(options.signal);
      throwIfAborted(options.signal);
      const normalizedArtist = normalizeAppleMusicSearchText(artistName);
      const normalizedTitle = normalizeAppleMusicSearchText(title);
      const key = JSON.stringify([market, normalizedArtist, normalizedTitle]);
      let pending = searchCache.get(key);
      if (!pending) {
        pending = request(`/v1/catalog/${encodeURIComponent(market)}/search`, {
          term: `${artistName} ${title}`,
          types: 'songs',
          limit: 10,
        }).then(searchResponse => {
          const matches = readCatalogSearchSongs(searchResponse).filter(
            song =>
              normalizeAppleMusicSearchText(song.artistName) ===
                normalizedArtist &&
              normalizeAppleMusicSearchText(song.title) === normalizedTitle,
          );
          return matches.length === 1 ? matches[0] : null;
        });
        searchCache.set(key, pending);
        void pending.catch(() => searchCache.delete(key));
      }
      const resolved = await pending;
      throwIfAborted(options.signal);
      return resolved;
    },
  };
}

export type {AppleMusicCatalogSong, AppleMusicLibrarySong} from './parser';
