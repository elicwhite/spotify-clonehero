'use client';

import {useState, useSyncExternalStore} from 'react';
import {Card, CardContent, CardHeader, CardTitle} from '@/components/ui/card';
import {Button} from '@/components/ui/button';
import {MidiProvider} from './contexts/MidiContext';
import LibraryView from './components/LibraryView';
import PracticeView from './components/PracticeView';
import TodayQueue from './components/TodayQueue';
import RouletteSession from './components/RouletteSession';

type View =
  | {kind: 'library'}
  | {kind: 'practice'; fillId: string}
  | {kind: 'today'}
  | {kind: 'roulette'};

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

export default function ClientPage() {
  const caps = useCapabilities();
  const [view, setView] = useState<View>({kind: 'library'});

  if (!caps.fileSystem || !caps.midi) {
    return <UnsupportedGate fileSystem={caps.fileSystem} midi={caps.midi} />;
  }

  return (
    <MidiProvider>
      <div className="flex w-full max-w-screen-xl flex-1 flex-col gap-4">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Drum Fills Practice</h1>
            <p className="text-sm text-muted-foreground">
              Detect, browse, and master drum fills from your Clone Hero
              library.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {view.kind === 'library' && (
              <>
                <Button
                  variant="outline"
                  onClick={() => setView({kind: 'today'})}>
                  Today
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setView({kind: 'roulette'})}>
                  Roulette
                </Button>
              </>
            )}
            {view.kind !== 'library' && (
              <Button
                variant="ghost"
                onClick={() => setView({kind: 'library'})}>
                Library
              </Button>
            )}
          </div>
        </header>

        {view.kind === 'library' && (
          <LibraryView
            onPracticeFill={fillId => setView({kind: 'practice', fillId})}
          />
        )}
        {view.kind === 'practice' && (
          <PracticeView
            fillId={view.fillId}
            onExit={() => setView({kind: 'library'})}
          />
        )}
        {view.kind === 'today' && (
          <TodayQueue onExit={() => setView({kind: 'library'})} />
        )}
        {view.kind === 'roulette' && (
          <RouletteSession onExit={() => setView({kind: 'library'})} />
        )}
      </div>
    </MidiProvider>
  );
}
