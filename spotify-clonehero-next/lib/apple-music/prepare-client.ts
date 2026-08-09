import {
  AppleMusicError,
  configureAppleMusicClient,
  type AppleMusicLibraryClient,
} from './client';
import {loadMusicKitScript} from './loader';

type DeveloperTokenResponse = {developerToken?: unknown; expiresAt?: unknown};

export type AppleMusicClientPreparationDependencies = {
  configureAppleMusicClient: typeof configureAppleMusicClient;
  loadMusicKitScript: typeof loadMusicKitScript;
};

const defaultDependencies: AppleMusicClientPreparationDependencies = {
  configureAppleMusicClient,
  loadMusicKitScript,
};

export type PreparedAppleMusicClient = {
  client: AppleMusicLibraryClient;
  developerTokenExpiresAt: number;
};

/** Loads MusicKit and configures one validated, renewable client instance. */
export async function prepareAppleMusicClient(
  dependencies: AppleMusicClientPreparationDependencies = defaultDependencies,
): Promise<PreparedAppleMusicClient> {
  await dependencies.loadMusicKitScript();
  const response = await fetch('/api/apple-music/developer-token', {
    cache: 'no-store',
  });
  if (!response.ok) throw new AppleMusicError('transient');

  const body = (await response.json()) as DeveloperTokenResponse;
  const expiresAt =
    typeof body.expiresAt === 'string' ? Date.parse(body.expiresAt) : NaN;
  if (
    typeof body.developerToken !== 'string' ||
    !body.developerToken ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= Date.now()
  ) {
    throw new AppleMusicError('malformed_response');
  }

  return {
    client: await dependencies.configureAppleMusicClient(body.developerToken),
    developerTokenExpiresAt: expiresAt,
  };
}
