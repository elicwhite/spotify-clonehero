'use client';

import {useCallback, useEffect, useState, useSyncExternalStore} from 'react';
import {Card, CardContent, CardHeader, CardTitle} from '@/components/ui/card';
import {Button} from '@/components/ui/button';
import {cn} from '@/lib/utils';
import {getFillCount, type GrooveCluster} from '@/lib/drum-fills/db';
import {MidiProvider} from './contexts/MidiContext';
import {useLibraryScan} from './hooks/useLibraryScan';
import HomeView from './components/HomeView';
import LibraryView from './components/LibraryView';
import PracticeView from './components/PracticeView';
import TodayQueue from './components/TodayQueue';
import RouletteSession from './components/RouletteSession';
import GroovesView from './components/GroovesView';
import GrooveSession from './components/GrooveSession';
import MidiStatus from './components/MidiStatus';

type View =
  | {kind: 'home'}
  | {kind: 'library'}
  | {kind: 'grooves'}
  | {kind: 'practice'; fillId: string}
  | {kind: 'today'}
  | {kind: 'roulette'}
  | {kind: 'groove-session'; cluster: GrooveCluster; mode: 'rotate' | 'ladder'};

const noopSubscribe = () => () => {};

interface Capabilities {
  fileSystem: boolean;
  midi: boolean;
}

// Capabilities are static for the page lifetime; cache the snapshots so
// useSyncExternalStore's getSnapshot returns a stable reference (returning a
// fresh object each call triggers an infinite render loop).
const SERVER_CAPS: Capabilities = {fileSystem: true, midi: true};
let clientCaps: Capabilities | null = null;
const getClientCaps = (): Capabilities => {
  if (clientCaps === null) {
    clientCaps = {
      fileSystem: typeof window.showDirectoryPicker === 'function',
      midi: 'requestMIDIAccess' in navigator,
    };
  }
  return clientCaps;
};
const getServerCaps = (): Capabilities => SERVER_CAPS;

/**
 * Capability gate. The tool requires the File System Access API (to read the
 * Songs library) and the Web MIDI API (to score drum hits). Both are
 * Chromium-only today, and neither appears/disappears at runtime, so we read
 * them once. Render "supported" on the server to avoid a hydration flash.
 */
function useCapabilities() {
  return useSyncExternalStore(noopSubscribe, getClientCaps, getServerCaps);
}

function UnsupportedGate({
  fileSystem,
  midi,
}: {
  fileSystem: boolean;
  midi: boolean;
}) {
  const missing: string[] = [];
  if (!fileSystem)
    missing.push('File System Access (to read your Songs folder)');
  if (!midi) missing.push('Web MIDI (to score your drum hits)');

  return (
    <div className="flex flex-1 items-center justify-center p-4">
      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle>Browser not supported</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-muted-foreground">
            The Drum Fills Practice tool needs browser features your current
            browser doesn&apos;t provide:
          </p>
          <ul className="list-disc pl-6 text-sm text-red-700">
            {missing.map(m => (
              <li key={m}>{m}</li>
            ))}
          </ul>
          <p className="text-sm text-muted-foreground">
            Please use a recent Chromium-based browser (Chrome, Edge, Opera,
            Brave) on desktop.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

type NavKey = 'home' | 'grooves' | 'library';

const NAV: {key: NavKey; label: string}[] = [
  {key: 'home', label: 'Home'},
  {key: 'grooves', label: 'Grooves'},
  {key: 'library', label: 'Library'},
];

export default function ClientPage() {
  const caps = useCapabilities();
  const [view, setView] = useState<View>({kind: 'home'});
  // Bumped after a scan so data-dependent surfaces (Home, Grooves) reload.
  const [refreshKey, setRefreshKey] = useState(0);
  const [hasData, setHasData] = useState(false);
  const [loading, setLoading] = useState(true);

  // Re-read fill presence + bump the refresh key so data-dependent surfaces
  // (Home, Grooves) reload. Used as the scan hook's completion callback.
  const refreshData = useCallback(async () => {
    let n = 0;
    try {
      n = await getFillCount();
    } catch {
      // ignore — surfaces handle their own empty/error states
    }
    setHasData(n > 0);
    setLoading(false);
    setRefreshKey(k => k + 1);
  }, []);

  const scan = useLibraryScan(refreshData);

  // Initial data-presence read on mount (capability-gated). Inlined rather than
  // calling refreshData so the cancelled guard applies and the lint rule doesn't
  // see a synchronous setState call.
  const ready = caps.fileSystem && caps.midi;
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    (async () => {
      let n = 0;
      try {
        n = await getFillCount();
      } catch {
        // ignore
      }
      if (cancelled) return;
      setHasData(n > 0);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [ready]);

  if (!caps.fileSystem || !caps.midi) {
    return <UnsupportedGate fileSystem={caps.fileSystem} midi={caps.midi} />;
  }

  // The active top-level nav tab a session/practice surface "belongs" to, so the
  // nav stays highlighted while drilling.
  const activeNav: NavKey =
    view.kind === 'library'
      ? 'library'
      : view.kind === 'grooves' || view.kind === 'groove-session'
        ? 'grooves'
        : 'home';

  const goHome = () => setView({kind: 'home'});

  // Practice surfaces (highway + notation side by side) use the full viewport
  // width; browse/list views stay centered at the site width.
  const isPracticeSurface =
    view.kind === 'practice' ||
    view.kind === 'today' ||
    view.kind === 'roulette' ||
    view.kind === 'groove-session';

  return (
    <MidiProvider>
      <div
        className={cn(
          'flex min-h-0 w-full flex-1 flex-col gap-4',
          !isPracticeSurface && 'max-w-screen-xl',
        )}>
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-6">
            <button
              onClick={goHome}
              className="text-left text-xl font-bold hover:opacity-80">
              Drum Fills
            </button>
            <nav className="flex items-center gap-1 rounded-lg border bg-card p-1">
              {NAV.map(item => (
                <button
                  key={item.key}
                  onClick={() => setView({kind: item.key})}
                  className={cn(
                    'rounded px-3 py-1.5 text-sm font-medium transition-colors',
                    activeNav === item.key
                      ? 'bg-primary text-primary-foreground'
                      : 'hover:bg-muted',
                  )}>
                  {item.label}
                </button>
              ))}
            </nav>
          </div>
          <MidiChip />
        </header>

        {/* Home / list views scroll normally; practice surfaces fill the
            bounded viewport height and manage their own internal scroll. */}
        {view.kind === 'home' && (
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            <HomeView
              key={refreshKey}
              hasData={hasData}
              loading={loading}
              scanning={scan.scanning}
              scanProgress={scan.progress}
              onScan={() => void scan.runScan()}
              onStartReview={() => setView({kind: 'today'})}
              onStartRoulette={() => setView({kind: 'roulette'})}
              onBrowseGrooves={() => setView({kind: 'grooves'})}
              onStartGroove={cluster =>
                setView({kind: 'groove-session', cluster, mode: 'ladder'})
              }
            />
          </div>
        )}
        {view.kind === 'library' && (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <LibraryView
              onPracticeFill={fillId => setView({kind: 'practice', fillId})}
            />
          </div>
        )}
        {view.kind === 'grooves' && (
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            <GroovesView
              key={refreshKey}
              onStartSession={cluster =>
                setView({kind: 'groove-session', cluster, mode: 'rotate'})
              }
              onRescan={() => void scan.runScan()}
              scanning={scan.scanning}
            />
          </div>
        )}
        {view.kind === 'practice' && (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <PracticeView
              fillId={view.fillId}
              onExit={() => setView({kind: 'library'})}
              enableInstanceSwitcher
            />
          </div>
        )}
        {view.kind === 'today' && (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <TodayQueue onExit={goHome} />
          </div>
        )}
        {view.kind === 'roulette' && (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <RouletteSession onExit={goHome} />
          </div>
        )}
        {view.kind === 'groove-session' && (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <GrooveSession
              cluster={view.cluster}
              initialMode={view.mode}
              onExit={() => setView({kind: 'grooves'})}
            />
          </div>
        )}
      </div>
    </MidiProvider>
  );
}

/**
 * Compact MIDI/calibration status in the header — reachable from every surface,
 * primary on none. Expands to the full MidiStatus controls on click.
 */
function MidiChip() {
  const [open, setOpen] = useState(false);
  if (open) {
    return (
      <div className="flex items-center gap-2">
        <MidiStatus />
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Done
        </Button>
      </div>
    );
  }
  return (
    <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
      MIDI &amp; calibration
    </Button>
  );
}
