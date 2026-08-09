export {
  configureAppleMusicClient,
  MUSICKIT_CDN_URL,
  type AppleMusicClient,
  type AppleMusicCatalogResolveOptions,
  type AppleMusicCatalogSearch,
  type AppleMusicErrorCode,
  type AppleMusicLibraryClient,
  type AppleMusicLibraryFetchOptions,
  type AppleMusicLibraryProgress,
  type AppleMusicLibraryScan,
  AppleMusicError,
  classifyAppleMusicError,
} from './client';
export {loadMusicKitScript} from './loader';
export {
  prepareAppleMusicClient,
  type AppleMusicClientPreparationDependencies,
  type PreparedAppleMusicClient,
} from './prepare-client';
export {
  normalizeAppleMusicSearchText,
  readCatalogSearchSongs,
  readCatalogSong,
  readLibraryPage,
  readLibrarySong,
  type AppleMusicCatalogSong,
  type AppleMusicLibrarySong,
} from './parser';
