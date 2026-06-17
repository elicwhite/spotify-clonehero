'use client';

import {useEffect, useSyncExternalStore, type ReactNode} from 'react';
import Link from 'next/link';
import {usePathname} from 'next/navigation';
import {Card, CardContent, CardHeader, CardTitle} from '@/components/ui/card';
import {Button} from '@/components/ui/button';
import {Progress} from '@/components/ui/progress';
import {cn} from '@/lib/utils';
import {MidiProvider} from './contexts/MidiContext';
import {
  DrumFillsChromeProvider,
  useDrumFillsChrome,
} from './contexts/DrumFillsChromeContext';
import MidiPopover from './components/MidiPopover';

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
      fileSystem: typeof window['showDirectoryPicker'] === 'function',
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

const NAV: {key: NavKey; label: string; href: string}[] = [
  {key: 'home', label: 'Home', href: '/drum-fills'},
  {key: 'grooves', label: 'Grooves', href: '/drum-fills/grooves'},
  {key: 'library', label: 'Library', href: '/drum-fills/library'},
];

/**
 * The single drum-fills header `[H]`: "All tools" escape + wordmark + nav pills
 * (active from the pathname) + a route-supplied context slot + the scan/rescan
 * control + the MIDI popover. Sticky and slim; never grows (the MIDI control
 * floats rather than expanding inline).
 */
function DrumFillsHeader() {
  const pathname = usePathname();
  const {slot, scanning, scanProgress, runScan} = useDrumFillsChrome();

  // The top-level nav tab a session/practice surface "belongs" to, so the nav
  // stays highlighted while drilling into a session.
  const activeNav: NavKey =
    pathname.startsWith('/drum-fills/library') ||
    pathname.startsWith('/drum-fills/practice')
      ? 'library'
      : pathname.startsWith('/drum-fills/grooves') ||
          pathname.startsWith('/drum-fills/groove')
        ? 'grooves'
        : 'home';

  return (
    <header className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b pb-2">
      <Link
        href="/"
        className="text-xs text-muted-foreground hover:text-foreground">
        ← All tools
      </Link>
      <Link href="/drum-fills" className="text-lg font-bold hover:opacity-80">
        Drum Fills
      </Link>
      <nav className="flex items-center gap-1 rounded-lg border bg-card p-1">
        {NAV.map(item => (
          <Link
            key={item.key}
            href={item.href}
            className={cn(
              'rounded px-3 py-1.5 text-sm font-medium transition-colors',
              activeNav === item.key
                ? 'bg-primary text-primary-foreground'
                : 'hover:bg-muted',
            )}>
            {item.label}
          </Link>
        ))}
      </nav>

      {/* Route-supplied context slot (groove identity, "Rung n/N", queue n/N). */}
      {slot && (
        <div className="min-w-0 flex-1 text-sm text-muted-foreground">
          {slot}
        </div>
      )}

      <div className="ml-auto flex items-center gap-3">
        {scanning && scanProgress && (
          <div className="hidden w-40 sm:block">
            <Progress
              value={
                scanProgress.totalEstimate > 0
                  ? (scanProgress.songsScanned / scanProgress.totalEstimate) *
                    100
                  : undefined
              }
            />
            <p className="mt-1 text-xs text-muted-foreground">
              {scanProgress.songsScanned} songs · {scanProgress.fillsFound}{' '}
              fills
            </p>
          </div>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={runScan}
          disabled={scanning}>
          {scanning ? 'Scanning…' : 'Rescan'}
        </Button>
        <MidiPopover />
      </div>
    </header>
  );
}

/** Renders the shared header `[H]` above the active route's content. */
function DrumFillsShell({children}: {children: ReactNode}) {
  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-3">
      <DrumFillsHeader />
      {children}
    </div>
  );
}

export default function DrumFillsLayout({children}: {children: ReactNode}) {
  const caps = useCapabilities();
  const pathname = usePathname();

  // Reclaim the global site nav's height on every drum-fills surface. Toggled
  // via effect (never a render-time DOM write) and removed on cleanup / when the
  // pathname leaves /drum-fills, so other tools keep their nav.
  useEffect(() => {
    const inTool = pathname.startsWith('/drum-fills');
    document.body.classList.toggle('hide-site-nav', inTool);
    return () => {
      document.body.classList.remove('hide-site-nav');
    };
  }, [pathname]);

  if (!caps.fileSystem || !caps.midi) {
    return <UnsupportedGate fileSystem={caps.fileSystem} midi={caps.midi} />;
  }

  return (
    <MidiProvider>
      <DrumFillsChromeProvider>
        <DrumFillsShell>{children}</DrumFillsShell>
      </DrumFillsChromeProvider>
    </MidiProvider>
  );
}
