/** @jest-environment jsdom */

import {AppleMusicError} from '../client';
import {prepareAppleMusicClient} from '../prepare-client';

const configuredClient = {
  isAuthorized: () => false,
  authorize: async () => {},
  unauthorize: async () => {},
  fetchLibrarySongs: jest.fn(),
  resolveCatalogSong: jest.fn(),
  searchCatalogSong: jest.fn(),
};

function dependencies() {
  return {
    loadMusicKitScript: jest.fn(async () => undefined),
    configureAppleMusicClient: jest.fn(async () => configuredClient),
  };
}

describe('prepareAppleMusicClient', () => {
  beforeEach(() => {
    global.fetch = jest.fn(async () =>
      Promise.resolve({
        ok: true,
        json: async () => ({
          developerToken: 'developer-token',
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        }),
      } as Response),
    );
  });

  it('loads MusicKit and configures a validated renewable client', async () => {
    const deps = dependencies();

    await expect(prepareAppleMusicClient(deps)).resolves.toMatchObject({
      client: configuredClient,
      developerTokenExpiresAt: expect.any(Number),
    });
    expect(deps.loadMusicKitScript).toHaveBeenCalledTimes(1);
    expect(deps.configureAppleMusicClient).toHaveBeenCalledWith(
      'developer-token',
    );
  });

  it.each([
    {},
    {
      developerToken: '',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    },
    {developerToken: 'token', expiresAt: 'invalid'},
    {developerToken: 'token', expiresAt: new Date(0).toISOString()},
  ])('rejects an unusable token response: %p', async body => {
    global.fetch = jest.fn(async () =>
      Promise.resolve({ok: true, json: async () => body} as Response),
    );

    await expect(prepareAppleMusicClient(dependencies())).rejects.toMatchObject<
      Partial<AppleMusicError>
    >({code: 'malformed_response'});
  });
});
