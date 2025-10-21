'use client';
import {Button} from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {Icons} from '@/components/icons';
import Image from 'next/image';
import spotifyLogoBlack from '@/public/assets/spotify/logo_black.png';
import spotifyLogoWhite from '@/public/assets/spotify/logo_white.png';
import {SupabaseClient} from '@supabase/supabase-js';
import {SPOTIFY_SCOPES} from '@/app/auth/spotifyScopes';

export function SignInWithSpotifyCard({
  supabaseClient,
  needsToLink,
  redirectPath,
}: {
  needsToLink: boolean;
  supabaseClient: SupabaseClient;
  redirectPath: string;
}) {
  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader className="text-center">
        <CardTitle>
          Sign in with
          <Image
            src={spotifyLogoBlack}
            sizes="8em"
            className="inline dark:hidden px-2"
            priority={true}
            style={{
              width: 'auto',
              height: 'auto',
            }}
            alt="Spotify"
          />
          <Image
            src={spotifyLogoWhite}
            sizes="8em"
            className="hidden dark:inline px-2"
            priority={true}
            style={{
              width: 'auto',
              height: 'auto',
            }}
            alt="Spotify"
          />
        </CardTitle>
        <CardDescription>
          Sign in with your Spotify account for the tool to scan your playlists
          and find matching charts on Chorus.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button
          onClick={async () => {
            const redirectUrl = `${window.location.origin}/auth/callback?next=${encodeURIComponent(redirectPath)}`;

            let result;
            if (needsToLink) {
              result = await supabaseClient.auth.linkIdentity({
                provider: 'spotify',
                options: {redirectTo: redirectUrl, scopes: SPOTIFY_SCOPES},
              });
            } else {
              result = await supabaseClient.auth.signInWithOAuth({
                provider: 'spotify',
                options: {redirectTo: redirectUrl, scopes: SPOTIFY_SCOPES},
              });
            }

            const {data, error} = result;

            if (!error && data?.url) {
              window.location.href = data.url;
            }
          }}
          className="w-full">
          <Icons.spotify className="h-4 w-4 mr-2" />
          Login with Spotify
        </Button>
      </CardContent>
    </Card>
  );
}
