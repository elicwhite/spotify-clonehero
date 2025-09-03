'use client';

import {useState, useEffect} from 'react';
import {createClient} from '@/lib/supabase/client';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {useRouter, useSearchParams} from 'next/navigation';

import {cn} from '@/lib/utils';
import {Icons} from '@/components/icons';
import {SPOTIFY_SCOPES} from '../spotifyScopes';

export function LoginForm({
  className,
  spotifyOnly,
  ...props
}: React.ComponentProps<'form'> & {spotifyOnly?: boolean}) {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState<
    null | 'email' | 'spotify' | 'discord'
  >(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const supabase = createClient();
  const searchParams = useSearchParams();

  useEffect(() => {
    const errorParam = searchParams.get('error');
    if (errorParam === 'invalid_token') {
      setError('Error when logging in. Please try logging in again.');
    } else if (errorParam === 'provider_email_needs_verification') {
      setMessage(
        'Please check your email and confirm your Spotify email address.',
      );
    }
  }, [searchParams]);

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading('email');
    setError('');
    setMessage('');

    try {
      // Get the next parameter from the URL
      const nextParam = searchParams.get('next');
      const redirectUrl = nextParam
        ? `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextParam)}`
        : `${window.location.origin}/auth/callback`;

      const {error} = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: redirectUrl,
        },
      });

      if (error) {
        setError(error.message);
      } else {
        setMessage('Check your email for the magic link!');
      }
    } catch {
      setError('An unexpected error occurred');
    } finally {
      setLoading(null);
    }
  };

  const handleOAuth = async (provider: 'spotify' | 'discord') => {
    try {
      setLoading(provider);
      setError('');
      setMessage('');

      // Get the next parameter from the URL
      const nextParam = searchParams.get('next');

      const redirectUrl = nextParam
        ? `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextParam)}`
        : `${window.location.origin}/auth/callback`;

      const scopes =
        provider === 'spotify'
          ? {
              scopes: SPOTIFY_SCOPES,
            }
          : {};

      const {data, error} = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: redirectUrl,
          ...scopes,
        },
      });

      if (error) {
        setError(error.message);
      } else if (data?.url) {
        window.location.href = data.url;
      }
    } catch {
      setError('An unexpected error occurred');
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className={cn('flex flex-col gap-6', className)}>
      <Card>
        <CardHeader className="text-center">
          <CardTitle className="text-xl">Login or Create an Account</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleEmailLogin} {...props}>
            <div className="grid gap-6">
              <div className="flex flex-col gap-4">
                <Button
                  variant="outline"
                  className="w-full"
                  type="button"
                  onClick={() => handleOAuth('spotify')}
                  disabled={!!loading}>
                  {loading === 'spotify' ? (
                    <Icons.spinner className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Icons.spotify className="h-6 w-6 mr-2" />
                  )}
                  {loading === 'spotify' ? 'Logging in' : 'Login with Spotify'}
                </Button>
                {!spotifyOnly && (
                  <Button
                    variant="outline"
                    className="w-full"
                    type="button"
                    onClick={() => handleOAuth('discord')}
                    disabled={!!loading}>
                    {loading === 'discord' ? (
                      <Icons.spinner className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Icons.discord className="h-6 w-6 mr-2" />
                    )}
                    {loading === 'discord'
                      ? 'Logging in'
                      : 'Login with Discord'}
                  </Button>
                )}
              </div>
              {!spotifyOnly && (
                <>
                  <div className="after:border-border relative text-center text-sm after:absolute after:inset-0 after:top-1/2 after:z-0 after:flex after:items-center after:border-t">
                    <span className="bg-card text-muted-foreground relative z-10 px-2">
                      Or continue with
                    </span>
                  </div>
                  <div className="grid gap-6">
                    <div className="grid gap-3">
                      <Label htmlFor="email">Email</Label>
                      <Input
                        id="email"
                        type="email"
                        placeholder="email@example.com"
                        value={email}
                        onChange={e => setEmail(e.target.value)}
                        required
                        disabled={!!loading}
                      />
                    </div>
                    <Button
                      type="submit"
                      className="w-full"
                      disabled={!!loading || !email}>
                      {loading === 'email' ? (
                        <span className="inline-flex items-center justify-center">
                          <Icons.spinner className="h-4 w-4 mr-2 animate-spin" />
                          Sending…
                        </span>
                      ) : (
                        'Send Magic Link'
                      )}
                    </Button>
                  </div>
                </>
              )}

              {message && (
                <div className="mt-2 p-3 bg-green-50 border border-green-200 rounded-md">
                  <p className="text-sm text-green-800">{message}</p>
                </div>
              )}

              {error && (
                <div className="mt-2 p-3 bg-red-50 border border-red-200 rounded-md">
                  <p className="text-sm text-red-800">{error}</p>
                </div>
              )}
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
