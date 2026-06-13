'use client';

import {useCallback, useEffect, useState} from 'react';
import {useRouter, useSearchParams} from 'next/navigation';
import {toast} from 'sonner';
import {Button} from '@/components/ui/button';
import {getGrooveClusterByKey, type GrooveCluster} from '@/lib/drum-fills/db';
import {useDrumFillsChrome} from '../../contexts/DrumFillsChromeContext';
import GrooveSession from '../../components/GrooveSession';

type SessionMode = 'rotate' | 'ladder';

function parseMode(raw: string | null): SessionMode {
  return raw === 'ladder' ? 'ladder' : 'rotate';
}

/**
 * Groove session (`/drum-fills/groove/[key]?mode=rotate|ladder`). Loads the
 * cluster by its similarity key (deep-link safe — the route carries only the
 * key) and feeds the requested mode. Re-fetches when a scan completes.
 */
export default function GrooveRoute({similarityKey}: {similarityKey: string}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const {scanVersion} = useDrumFillsChrome();
  const mode = parseMode(searchParams.get('mode'));

  const [cluster, setCluster] = useState<GrooveCluster | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing'>(
    'loading',
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setStatus('loading');
      try {
        const found = await getGrooveClusterByKey(similarityKey);
        if (cancelled) return;
        setCluster(found);
        setStatus(found ? 'ready' : 'missing');
      } catch (err) {
        if (cancelled) return;
        console.error('Failed to load groove', err);
        toast.error('Could not load this groove.');
        setStatus('missing');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [similarityKey, scanVersion]);

  const exit = () => {
    if (window.history.length > 1) router.back();
    else router.push('/drum-fills/grooves');
  };

  // Rotate ⇄ Ladder is deep-link-driven: replace `?mode=` (no history spam,
  // survives reload). GrooveSession is keyed on the mode so it remounts cleanly.
  // Stable identity so the header context slot it feeds doesn't re-publish each
  // render (which would loop the chrome-slot effect).
  const changeMode = useCallback(
    (next: SessionMode) => {
      router.replace(
        `/drum-fills/groove/${encodeURIComponent(similarityKey)}?mode=${next}`,
      );
    },
    [router, similarityKey],
  );

  if (status === 'loading') {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center text-muted-foreground">
        Loading groove…
      </div>
    );
  }

  if (status === 'missing' || !cluster) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 text-center">
        <p className="text-muted-foreground">
          That groove isn&apos;t in your library. Try rescanning or pick
          another.
        </p>
        <Button
          variant="outline"
          onClick={() => router.push('/drum-fills/grooves')}>
          Back to Grooves
        </Button>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <GrooveSession
        key={`${cluster.similarityKey}:${mode}`}
        cluster={cluster}
        initialMode={mode}
        onModeChange={changeMode}
        onExit={exit}
      />
    </div>
  );
}
