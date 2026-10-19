import {generateKeyPairSync} from 'node:crypto';
import {GET} from '../route';
import {resetAppleMusicDeveloperTokenCacheForTests} from '@/lib/apple-music-server/developer-token';

const {privateKey} = generateKeyPairSync('ec', {namedCurve: 'prime256v1'});
const privateKeyPem = privateKey.export({
  format: 'pem',
  type: 'pkcs8',
}) as string;
const originalEnvironment = {
  allowedOrigins: process.env['APPLE_MUSIC_ALLOWED_ORIGINS'],
  keyId: process.env['APPLE_MUSIC_KEY_ID'],
  privateKey: process.env['APPLE_MUSIC_PRIVATE_KEY'],
  teamId: process.env['APPLE_MUSIC_TEAM_ID'],
};

function restoreEnvironment(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

describe('GET /api/apple-music/developer-token', () => {
  beforeEach(() => {
    resetAppleMusicDeveloperTokenCacheForTests();
    delete process.env['APPLE_MUSIC_TEAM_ID'];
    delete process.env['APPLE_MUSIC_KEY_ID'];
    delete process.env['APPLE_MUSIC_PRIVATE_KEY'];
    delete process.env['APPLE_MUSIC_ALLOWED_ORIGINS'];
  });

  it('returns the token payload without HTTP caching', async () => {
    process.env['APPLE_MUSIC_TEAM_ID'] = 'TEAMID1234';
    process.env['APPLE_MUSIC_KEY_ID'] = 'KEYID12345';
    process.env['APPLE_MUSIC_PRIVATE_KEY'] = privateKeyPem.replace(
      /\n/g,
      '\\n',
    );
    process.env['APPLE_MUSIC_ALLOWED_ORIGINS'] = 'https://charts.example.com';

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({
      developerToken: expect.any(String),
      expiresAt: expect.any(String),
    });
  });

  it('returns a generic unavailable response when configuration is absent', async () => {
    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: 'Apple Music is not configured',
    });
  });

  afterAll(() => {
    restoreEnvironment(
      'APPLE_MUSIC_ALLOWED_ORIGINS',
      originalEnvironment.allowedOrigins,
    );
    restoreEnvironment('APPLE_MUSIC_KEY_ID', originalEnvironment.keyId);
    restoreEnvironment(
      'APPLE_MUSIC_PRIVATE_KEY',
      originalEnvironment.privateKey,
    );
    restoreEnvironment('APPLE_MUSIC_TEAM_ID', originalEnvironment.teamId);
    resetAppleMusicDeveloperTokenCacheForTests();
  });
});
