import { SpotifyApi } from "@spotify/web-api-ts-sdk";
import { getSpotifyAccessToken } from "./tokens";
import ProvidedAccessTokenStrategy from "./ProvidedAccessTokenStrategy";

export default async function getSpotifyApi(userId: User["id"]): Promise<SpotifyApi | null> {
  const maybeAccessToken = await getSpotifyAccessToken(userId)

  if (process.env.SPOTIFY_CLIENT_ID == null) {
    return null;
  }

  if (!maybeAccessToken) {
    return null;
  }

  try {
    return new SpotifyApi(new ProvidedAccessTokenStrategy(process.env.SPOTIFY_CLIENT_ID, maybeAccessToken, async () => {
      const token = await getSpotifyAccessToken(userId)

      if (!token) {
        throw new Error('Failed to refresh Spotify access token')
      }

      return token
    }))
  }
  catch (e) {
    console.error(e)
  }

  return null;
}