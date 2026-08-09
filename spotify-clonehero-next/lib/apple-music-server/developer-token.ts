import {createHash, createPrivateKey, sign} from 'node:crypto';

const TOKEN_TTL_SECONDS = 60 * 60;
const CACHE_RENEWAL_SKEW_SECONDS = 5 * 60;

type DeveloperTokenConfiguration = {
  keyId: string;
  origins: string[];
  privateKey: string;
  teamId: string;
};

export type DeveloperToken = {
  developerToken: string;
  expiresAt: string;
};

let cachedToken: DeveloperToken | null = null;
let cachedTokenExpiresAtSeconds = 0;
let cachedConfigurationFingerprint: string | null = null;

function encodeBase64Url(value: string | Buffer) {
  if (typeof value === 'string') {
    return Buffer.from(value).toString('base64url');
  }
  return value.toString('base64url');
}

function configuredOrigins(value: string | undefined): string[] | null {
  if (!value) return null;

  const configuredValues = value
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);
  const origins: string[] = [];
  for (const origin of configuredValues) {
    try {
      const url = new URL(origin);
      const isLocalHttp =
        url.protocol === 'http:' &&
        (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
      if (url.protocol !== 'https:' && !isLocalHttp) return null;
      if (url.pathname !== '/' || url.search || url.hash) return null;
      if (url.origin === 'null' || url.username || url.password) return null;
      origins.push(url.origin);
    } catch {
      return null;
    }
  }

  if (!origins.length) return null;
  return [...new Set(origins)];
}

function readConfiguration(): DeveloperTokenConfiguration | null {
  const teamId = process.env['APPLE_MUSIC_TEAM_ID']?.trim();
  const keyId = process.env['APPLE_MUSIC_KEY_ID']?.trim();
  const privateKey = process.env['APPLE_MUSIC_PRIVATE_KEY']?.replace(
    /\\n/g,
    '\n',
  );
  const origins = configuredOrigins(process.env['APPLE_MUSIC_ALLOWED_ORIGINS']);

  if (!teamId || !keyId || !privateKey || !origins) return null;

  return {teamId, keyId, privateKey, origins};
}

function signDeveloperToken(
  configuration: DeveloperTokenConfiguration,
  nowSeconds: number,
): DeveloperToken | null {
  const expiresAtSeconds = nowSeconds + TOKEN_TTL_SECONDS;
  const header = encodeBase64Url(
    JSON.stringify({alg: 'ES256', kid: configuration.keyId, typ: 'JWT'}),
  );
  const payload = encodeBase64Url(
    JSON.stringify({
      iss: configuration.teamId,
      iat: nowSeconds,
      exp: expiresAtSeconds,
      origin: configuration.origins,
    }),
  );
  const signingInput = `${header}.${payload}`;

  try {
    const signature = sign('sha256', new TextEncoder().encode(signingInput), {
      key: createPrivateKey(configuration.privateKey),
      dsaEncoding: 'ieee-p1363',
    });
    return {
      developerToken: `${signingInput}.${encodeBase64Url(signature)}`,
      expiresAt: new Date(expiresAtSeconds * 1000).toISOString(),
    };
  } catch {
    return null;
  }
}

function configurationFingerprint(configuration: DeveloperTokenConfiguration) {
  return createHash('sha256')
    .update(configuration.teamId)
    .update('\u0000')
    .update(configuration.keyId)
    .update('\u0000')
    .update(configuration.privateKey)
    .update('\u0000')
    .update(configuration.origins.join('\u0000'))
    .digest('hex');
}

export function getAppleMusicDeveloperToken(): DeveloperToken | null {
  const configuration = readConfiguration();
  if (!configuration) return null;

  const nowSeconds = Math.floor(Date.now() / 1000);
  const fingerprint = configurationFingerprint(configuration);
  if (
    cachedToken &&
    fingerprint === cachedConfigurationFingerprint &&
    nowSeconds < cachedTokenExpiresAtSeconds - CACHE_RENEWAL_SKEW_SECONDS
  ) {
    return cachedToken;
  }

  const token = signDeveloperToken(configuration, nowSeconds);
  if (!token) return null;

  cachedToken = token;
  cachedTokenExpiresAtSeconds = nowSeconds + TOKEN_TTL_SECONDS;
  cachedConfigurationFingerprint = fingerprint;
  return token;
}

export function resetAppleMusicDeveloperTokenCacheForTests() {
  cachedToken = null;
  cachedTokenExpiresAtSeconds = 0;
  cachedConfigurationFingerprint = null;
}
