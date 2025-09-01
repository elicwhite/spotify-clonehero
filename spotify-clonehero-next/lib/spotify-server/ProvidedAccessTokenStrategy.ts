import {
  AccessToken,
  IAuthStrategy,
  SdkConfiguration,
} from '@spotify/web-api-ts-sdk';
import {ProtectedAccessToken} from './tokens.js';

/**
 * This strategy is used when you already have an access token and want to use it.
 * The authentication strategy will automatically renew the token when it expires.
 * Designed to allow a browser-based-app to post the access token to the server and use it from there.
 * @constructor
 * @param {string} clientId - Spotify application client id.
 * @param {string} accessToken - The access token returned from a client side Authorization Code with PKCE flow.
 */
export default class ProvidedAccessTokenStrategy implements IAuthStrategy {
  private refreshTokenAction: () => Promise<ProtectedAccessToken>;

  constructor(
    protected accessToken: ProtectedAccessToken,
    refreshTokenAction: () => Promise<ProtectedAccessToken>,
  ) {
    this.refreshTokenAction = refreshTokenAction;
  }

  public setConfiguration(_: SdkConfiguration): void {}

  public async getOrCreateAccessToken(): Promise<AccessToken> {
    if (this.accessToken.expires_at <= new Date()) {
      const refreshed = await this.refreshTokenAction();
      this.accessToken = refreshed;
    }

    return this.accessToken as unknown as AccessToken;
  }

  public async getAccessToken(): Promise<AccessToken | null> {
    return this.accessToken as unknown as AccessToken;
  }

  public removeAccessToken(): void {
    this.accessToken = {
      access_token: '',
      expires_at: new Date(0),
    };
  }
}
