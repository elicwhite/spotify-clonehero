'use client';

import {
  IHandleErrors,
  IValidateResponses,
  SpotifyApi,
} from '@spotify/web-api-ts-sdk';
import {use, useMemo} from 'react';
import {ProtectedAccessToken} from '../spotify-server/tokens';
import ProvidedAccessTokenStrategy from '../spotify-server/ProvidedAccessTokenStrategy';
import {createClient} from '@/lib/supabase/client';

export class RateLimitError extends Error {
  public status: number;
  public retryAfter: number;

  constructor(message: string, status: number, retryAfter: number) {
    super(message);
    this.name = 'RateLimitError';
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

class MyResponseValidator implements IValidateResponses {
  public async validateResponse(response: Response): Promise<void> {
    switch (response.status) {
      case 401:
        throw new Error(
          'Bad or expired token. This can happen if the user revoked a token or the access token has expired. You should re-authenticate the user.',
        );
      case 403:
        const body = await response.text();
        throw new Error(
          `Bad OAuth request (wrong consumer key, bad nonce, expired timestamp...). Unfortunately, re-authenticating the user won't help here. Body: ${body}`,
        );
      case 429:
        if (!response.headers.get('Retry-After')) {
          // This is a bug in Spotify's API. This header is missing from Access-Control-Expose-Headers
          // for this request
          // https://community.spotify.com/t5/Spotify-for-Developers/retry-after-header-not-accessible-in-web-app/td-p/5433144
        }
        const retryAfterHeader = response.headers.get('Retry-After') ?? '5';

        throw new RateLimitError(
          'The app has exceeded its rate limits.',
          429,
          parseInt(retryAfterHeader, 10),
        );
      default:
        if (!response.status.toString().startsWith('20')) {
          const body = await response.text();
          throw new Error(
            `Unrecognised response code: ${response.status} - ${response.statusText}. Body: ${body}`,
          );
        }
    }
  }
}

export class MyErrorHandler implements IHandleErrors {
  public async handleErrors(error: any): Promise<boolean> {
    if (error.message.includes('Bad or expired token')) {
      const supabase = createClient();
      const redirectUrl = `${window.location.origin}/auth/callback}`;
      const {data, error} = await supabase.auth.signInWithOAuth({
        provider: 'spotify',
        options: {redirectTo: redirectUrl},
      });
      return true;
    }

    return false;
  }
}

async function fetchAccessToken(): Promise<ProtectedAccessToken | null> {
  const resp = await fetch('/api/spotify/access-token', {cache: 'no-store'});
  if (!resp.ok) {
    throw new Error('Not authenticated or no Spotify token');
  }
  const json = await resp.json();
  return json as ProtectedAccessToken;
}

let cachedSharedSdk: SpotifyApi | null = null;

export async function getSpotifySdk(): Promise<SpotifyApi | null> {
  if (cachedSharedSdk) {
    return cachedSharedSdk;
  }
  const maybeAccessToken = await fetchAccessToken();

  if (!maybeAccessToken) {
    return null;
  }

  const strategy = new ProvidedAccessTokenStrategy(
    maybeAccessToken,
    async () => {
      console.log('Refreshing Spotify access token!');
      const token = await fetchAccessToken();

      if (!token) {
        throw new Error('Failed to refresh Spotify access token');
      }

      return token;
    },
  );

  cachedSharedSdk = new SpotifyApi(strategy, {
    responseValidator: new MyResponseValidator(),
    errorHandler: new MyErrorHandler(),
  });

  return cachedSharedSdk;
}
