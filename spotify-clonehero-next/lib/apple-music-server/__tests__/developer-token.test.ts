import {generateKeyPairSync, verify, type KeyObject} from 'node:crypto';
import {
  getAppleMusicDeveloperToken,
  resetAppleMusicDeveloperTokenCacheForTests,
} from '../developer-token';

const {privateKey, publicKey} = generateKeyPairSync('ec', {
  namedCurve: 'prime256v1',
});
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

function setConfiguration(overrides: Partial<Record<string, string>> = {}) {
  process.env['APPLE_MUSIC_TEAM_ID'] = overrides['teamId'] ?? 'TEAMID1234';
  process.env['APPLE_MUSIC_KEY_ID'] = overrides['keyId'] ?? 'KEYID12345';
  process.env['APPLE_MUSIC_PRIVATE_KEY'] =
    overrides['privateKey'] ?? privateKeyPem.replace(/\n/g, '\\n');
  process.env['APPLE_MUSIC_ALLOWED_ORIGINS'] =
    overrides['origins'] ?? 'https://charts.example.com, http://localhost:3000';
}

function restoreEnvironment(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

function decodeJwtPart<T>(token: string, index: number): T {
  return JSON.parse(
    Buffer.from(token.split('.')[index]!, 'base64url').toString('utf8'),
  ) as T;
}

describe('getAppleMusicDeveloperToken', () => {
  beforeEach(() => {
    resetAppleMusicDeveloperTokenCacheForTests();
    setConfiguration();
    jest.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
  });

  afterEach(() => {
    jest.restoreAllMocks();
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

  it('creates a verifiable ES256 developer token with the expected claims', () => {
    const token = getAppleMusicDeveloperToken();

    expect(token).not.toBeNull();
    const developerToken = token!.developerToken;
    expect(decodeJwtPart(developerToken, 0)).toEqual({
      alg: 'ES256',
      kid: 'KEYID12345',
      typ: 'JWT',
    });
    expect(decodeJwtPart(developerToken, 1)).toEqual({
      exp: 1_700_003_600,
      iat: 1_700_000_000,
      iss: 'TEAMID1234',
      origin: ['https://charts.example.com', 'http://localhost:3000'],
    });
    expect(token!.expiresAt).toBe('2023-11-14T23:13:20.000Z');

    const [header, payload, signature] = developerToken.split('.');
    expect(signature).toHaveLength(86);
    expect(
      verify(
        'sha256',
        new TextEncoder().encode(`${header}.${payload}`),
        {key: publicKey as KeyObject, dsaEncoding: 'ieee-p1363'},
        new Uint8Array(Buffer.from(signature!, 'base64url')),
      ),
    ).toBe(true);
  });

  it('reuses a token until five minutes before its expiry, then renews it', () => {
    const first = getAppleMusicDeveloperToken();
    jest.spyOn(Date, 'now').mockReturnValue(1_700_003_299_000);
    expect(getAppleMusicDeveloperToken()).toEqual(first);

    jest.spyOn(Date, 'now').mockReturnValue(1_700_003_300_000);
    const renewed = getAppleMusicDeveloperToken();
    expect(renewed).not.toEqual(first);
    expect(decodeJwtPart<{iat: number}>(renewed!.developerToken, 1).iat).toBe(
      1_700_003_300,
    );
  });

  it('does not reuse a token after the trusted configuration changes', () => {
    const first = getAppleMusicDeveloperToken();
    setConfiguration({origins: 'https://new-origin.example.com'});

    const second = getAppleMusicDeveloperToken();
    expect(second).not.toEqual(first);
    expect(
      decodeJwtPart<{origin: string[]}>(second!.developerToken, 1).origin,
    ).toEqual(['https://new-origin.example.com']);
  });

  it.each([
    ['missing team ID', {teamId: ''}],
    ['missing key ID', {keyId: ''}],
    ['missing private key', {privateKey: ''}],
    ['empty origins', {origins: ''}],
    ['an insecure remote origin', {origins: 'http://charts.example.com'}],
    ['an origin with a path', {origins: 'https://charts.example.com/music'}],
  ])('returns null for %s', (_description, overrides) => {
    setConfiguration(overrides);
    expect(getAppleMusicDeveloperToken()).toBeNull();
  });

  it('returns null when the configured private key cannot sign', () => {
    setConfiguration({privateKey: 'not a private key'});
    expect(getAppleMusicDeveloperToken()).toBeNull();
  });
});
