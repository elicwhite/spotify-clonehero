'use client';

import {
  AccessToken,
  IAuthStrategy,
  IHandleErrors,
  IValidateResponses,
  SdkConfiguration,
  SpotifyApi,
} from '@spotify/web-api-ts-sdk'; // use "@spotify/web-api-ts-sdk" in your own project
import {signIn, useSession} from 'next-auth/react';
import {Session} from 'next-auth';
import {useMemo} from 'react';

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

class ReactNextAuthStrategy implements IAuthStrategy {
  session: Session;

  constructor(session: Session) {
    this.session = session;
  }

  public getOrCreateAccessToken(): Promise<AccessToken> {
    return this.getAccessToken();
  }

  public async getAccessToken(): Promise<AccessToken> {
    // const session: any = await getSession();
    if (!this.session) {
      return {} as AccessToken;
    }

    // @ts-ignore
    if (this.session?.error === 'RefreshAccessTokenError') {
      await signIn();
      return this.getAccessToken();
    }

    const {user} = this.session;

    if (!user) {
      throw new Error('No user found in session');
    }

    return {
      // @ts-ignore
      access_token: user.access_token,
      token_type: 'Bearer',
      // @ts-ignore
      expires_in: user.expires_in,
      // @ts-ignore
      expires: user.expires_at,
      // @ts-ignore
      refresh_token: user.refresh_token,
    } as AccessToken;
  }

  public removeAccessToken(): void {
    console.warn('[Spotify-SDK][WARN]\nremoveAccessToken not implemented');
  }

  public setConfiguration(configuration: SdkConfiguration): void {
    // console.log('config', configuration);
    // console.warn('[Spotify-SDK][WARN]\nsetConfiguration not implemented');
  }
}

export default class MyErrorHandler implements IHandleErrors {
  public async handleErrors(error: any): Promise<boolean> {
    if (error.message.includes('Bad or expired token')) {
      await signIn('spotify');
      return true;
    }

    return false;
  }
}

export function useSpotifySdk() {
  const {data, status} = useSession();

  const api = useMemo(() => {
    if (data == null) {
      return null;
    }

    const strategy = new ReactNextAuthStrategy(data);
    return new SpotifyApi(strategy, {
      responseValidator: new MyResponseValidator(),
      errorHandler: new MyErrorHandler(),
    });
  }, [data]);

  return api;
}
