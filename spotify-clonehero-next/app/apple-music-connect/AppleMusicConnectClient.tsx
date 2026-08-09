'use client';

import {useEffect, useState} from 'react';
import {Button} from '@/components/ui/button';
import {navigateToAppleMusicPath} from '@/lib/apple-music/navigation';
import {safeAppleMusicReturnPath} from '@/lib/apple-music/return-path';
import {
  prepareAppleMusicClient,
  type AppleMusicClient,
} from '@/lib/apple-music';

export default function AppleMusicConnectClient({
  returnTo,
}: {
  returnTo?: string;
}) {
  const [client, setClient] = useState<AppleMusicClient | null>(null);
  const [authorizationRestored, setAuthorizationRestored] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [setupAttempt, setSetupAttempt] = useState(0);
  const destination = safeAppleMusicReturnPath(returnTo ?? null);
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        setError(null);
        const {client: configured} = await prepareAppleMusicClient();
        if (!active) return;
        setAuthorizationRestored(configured.isAuthorized());
        setClient(configured);
      } catch {
        if (!active) return;
        setError('MusicKit could not be prepared. Try again.');
      }
    })();
    return () => {
      active = false;
    };
  }, [setupAttempt]);

  async function continueWithAppleMusic() {
    if (!client) return;
    try {
      if (!client.isAuthorized()) await client.authorize();
      navigateToAppleMusicPath(destination);
    } catch {
      setError(
        'Apple Music authorization did not complete. You can try again.',
      );
    }
  }
  return (
    <section
      className="w-full max-w-xl"
      aria-labelledby="apple-music-connect-title">
      <h1 id="apple-music-connect-title" className="text-xl font-semibold">
        Connect Apple Music
      </h1>
      <p role="status" aria-live="polite">
        {client
          ? authorizationRestored
            ? 'Apple Music authorization was restored in this browser.'
            : 'MusicKit is ready.'
          : error
            ? 'MusicKit needs attention.'
            : 'Preparing MusicKit…'}
      </p>
      {error && <p role="alert">{error}</p>}
      {error && (
        <Button
          type="button"
          variant="outline"
          onClick={() => setSetupAttempt(attempt => attempt + 1)}>
          Retry setup
        </Button>
      )}
      {client && (
        <Button type="button" onClick={() => void continueWithAppleMusic()}>
          {authorizationRestored
            ? 'Return to Find Music'
            : 'Continue with Apple Music'}
        </Button>
      )}
      <Button
        type="button"
        variant="link"
        onClick={() => navigateToAppleMusicPath(destination)}>
        Cancel
      </Button>
    </section>
  );
}
