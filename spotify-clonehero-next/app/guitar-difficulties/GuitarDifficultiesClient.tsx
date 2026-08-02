'use client';

import {useCallback, useEffect, useRef, useState} from 'react';
import {AlertTriangle, RotateCcw} from 'lucide-react';
import {toast} from 'sonner';
import LocalChartLoader, {
  type LocalChart,
} from '@/components/chart-picker/LocalChartLoader';
import type {LoadedFiles} from '@/components/chart-picker/chart-file-readers';
import {Button} from '@/components/ui/button';
import {AudioManager} from '@/lib/preview/audioManager';
import {getChartDelayMs} from '@/lib/chart-utils/chartDelay';
import {reduceGuitarDifficulties} from '@/lib/guitar-difficulty/reduce';
import {
  GUITAR_DIFFICULTIES,
  type GuitarDifficulty,
} from '@/lib/guitar-difficulty/snapshot';
import type {Track} from '@/lib/preview/highway/types';
import ExportChartDialog from './ExportChartDialog';
import GuitarDifficultyGrid from './GuitarDifficultyGrid';
import TransportBar from '@/app/difficulties/components/TransportBar';

type View =
  | {status: 'empty'}
  | {
      status: 'loading';
      localChart: LocalChart;
      id: number;
      message: string;
    }
  | {status: 'error'; message: string}
  | {
      status: 'ready';
      loaded: LoadedFiles;
      localChart: LocalChart;
      tracks: Record<GuitarDifficulty, Track>;
      id: number;
    };

function findExpertGuitarTrack(chart: LocalChart['chart']): Track | undefined {
  return chart.trackData.find(
    track => track.instrument === 'guitar' && track.difficulty === 'expert',
  ) as Track | undefined;
}

function countNotes(track: Track): number {
  return track.noteEventGroups.reduce((sum, group) => sum + group.length, 0);
}

export default function GuitarDifficultiesClient() {
  const [view, setView] = useState<View>({status: 'empty'});
  const [audioManager, setAudioManager] = useState<AudioManager | null>(null);
  const idRef = useRef(0);

  const onLoaded = useCallback(async (localChart: LocalChart) => {
    const id = ++idRef.current;
    try {
      const expertTrack = findExpertGuitarTrack(localChart.chart);
      if (!expertTrack) {
        setView({
          status: 'error',
          message: 'This chart does not contain an Expert guitar track.',
        });
        return;
      }
      if (expertTrack.noteEventGroups.length === 0) {
        setView({
          status: 'error',
          message: 'The Expert guitar track does not contain any notes.',
        });
        return;
      }

      setView({
        status: 'loading',
        localChart,
        id,
        message: 'Loading guitar reduction model…',
      });
      const tracks = await reduceGuitarDifficulties(
        localChart.chart,
        expertTrack,
        ({message}) => {
          setView(current =>
            current.status === 'loading' && current.id === id
              ? {...current, message}
              : current,
          );
        },
      );
      if (idRef.current !== id) return;
      setView({
        status: 'ready',
        loaded: localChart.loaded,
        localChart,
        tracks,
        id,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(message);
      setView({status: 'error', message});
    }
  }, []);

  useEffect(() => {
    const readyView = view.status === 'ready' ? view : null;
    if (!readyView) return;

    let cancelled = false;
    const manager = new AudioManager(readyView.localChart.audioFiles, () => {});
    manager.ready.then(() => {
      if (cancelled) {
        manager.destroy();
        return;
      }
      manager.setChartDelay(
        getChartDelayMs(readyView.localChart.chart.metadata) / 1000,
      );
      setAudioManager(manager);
    });

    return () => {
      cancelled = true;
      manager.destroy();
      setAudioManager(null);
    };
  }, [view]);

  function reset() {
    idRef.current += 1;
    setView({status: 'empty'});
  }

  return (
    <main className="mx-auto max-w-[1500px] px-4 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Guitar Difficulty Comparison</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Select a chart to compare Expert against reduced Hard, Medium, and
          Easy five-fret guitar reductions side by side, synchronized to the
          chart&apos;s audio.
        </p>
      </header>

      {view.status === 'empty' && (
        <div className="mx-auto max-w-xl">
          <LocalChartLoader
            onLoaded={onLoaded}
            id="guitar-difficulties-picker"
            requireDrums={false}
          />
        </div>
      )}

      {view.status === 'error' && (
        <div className="mx-auto max-w-xl space-y-4">
          <div className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
            <div className="text-sm">
              <p className="font-medium text-destructive">
                Can&apos;t reduce this chart
              </p>
              <p className="mt-1 text-muted-foreground">{view.message}</p>
            </div>
          </div>
          <Button variant="outline" onClick={reset}>
            <RotateCcw className="mr-2 h-4 w-4" />
            Try another chart
          </Button>
        </div>
      )}

      {view.status === 'loading' && (
        <div className="mx-auto max-w-xl rounded-lg border border-border bg-muted/20 p-6">
          <p className="text-sm font-medium">
            Reducing {view.localChart.metadata.name}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">{view.message}</p>
        </div>
      )}

      {view.status === 'ready' && (
        <div className="space-y-5">
          <section className="rounded-lg border border-border bg-muted/20 p-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-base font-semibold">
                  {view.localChart.metadata.artist} —{' '}
                  {view.localChart.metadata.name}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {view.localChart.metadata.charter} ·{' '}
                  {view.localChart.chart.resolution} ticks per beat
                </p>
              </div>
              <div className="flex gap-2">
                <ExportChartDialog loaded={view.loaded} tracks={view.tracks} />
                <Button variant="outline" size="sm" onClick={reset}>
                  <RotateCcw className="mr-2 h-4 w-4" />
                  New chart
                </Button>
              </div>
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-4">
              {GUITAR_DIFFICULTIES.map(difficulty => (
                <div
                  key={difficulty}
                  className="rounded-md border border-border/70 bg-background/60 px-3 py-2">
                  <p className="text-xs capitalize text-muted-foreground">
                    {difficulty}
                  </p>
                  <p className="mt-1 font-mono text-lg">
                    {countNotes(view.tracks[difficulty])}
                  </p>
                  <p className="text-[11px] text-muted-foreground">notes</p>
                </div>
              ))}
            </div>
          </section>

          {audioManager ? (
            <TransportBar audioManager={audioManager} />
          ) : (
            <p className="text-sm text-muted-foreground">Loading audio…</p>
          )}

          {audioManager && (
            <GuitarDifficultyGrid
              key={view.id}
              chart={view.localChart.chart}
              tracks={view.tracks}
              audioManager={audioManager}
            />
          )}
        </div>
      )}
    </main>
  );
}
