import {
  MyResponseValidator,
  SpotifyUnavailableError,
  getSpotifySdk,
} from '@/lib/spotify-sdk/ClientInstance';

describe('Spotify client expected outcomes', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns no SDK when the user has no token', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 401,
    } as Response);

    await expect(getSpotifySdk()).resolves.toBeNull();
  });

  it('classifies country unavailability separately from OAuth defects', async () => {
    const validator = new MyResponseValidator();
    const response = {
      status: 403,
      text: async () =>
        JSON.stringify({
          error: {
            status: 403,
            message: 'Spotify is unavailable in this country',
          },
        }),
    } as Response;

    await expect(validator.validateResponse(response)).rejects.toBeInstanceOf(
      SpotifyUnavailableError,
    );
  });

  it('keeps other authorization failures actionable', async () => {
    const validator = new MyResponseValidator();
    const response = {
      status: 403,
      text: async () => 'Insufficient client scope',
    } as Response;

    await expect(validator.validateResponse(response)).rejects.toThrow(
      'Insufficient client scope',
    );
  });
});
