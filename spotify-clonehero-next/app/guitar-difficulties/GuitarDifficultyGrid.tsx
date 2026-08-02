'use client';

import {useEffect, useMemo, useRef, useState} from 'react';
import {AlertTriangle} from 'lucide-react';
import type {AudioManager} from '@/lib/preview/audioManager';
import type {ParsedChart} from '@/lib/preview/chorus-chart-processing';
import {
  createHighwayGrid,
  type HighwayGrid,
} from '@/lib/preview/highway/multiCell';
import type {Track} from '@/lib/preview/highway/types';
import {
  GUITAR_DIFFICULTIES,
  type GuitarDifficulty,
} from '@/lib/guitar-difficulty/snapshot';

const LABELS: Record<GuitarDifficulty, string> = {
  expert: 'Expert',
  hard: 'Hard',
  medium: 'Medium',
  easy: 'Easy',
};

export default function GuitarDifficultyGrid({
  chart,
  tracks,
  audioManager,
}: {
  chart: ParsedChart;
  tracks: Record<GuitarDifficulty, Track>;
  audioManager: AudioManager;
}) {
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const cellRefs = useRef<Map<GuitarDifficulty, HTMLDivElement>>(new Map());
  const [gridError, setGridError] = useState<string | null>(null);

  const cells = useMemo(
    () =>
      GUITAR_DIFFICULTIES.map(difficulty => ({
        difficulty,
        track: tracks[difficulty],
      })),
    [tracks],
  );

  useEffect(() => {
    const host = canvasHostRef.current;
    if (!host) return;

    const gridCells = cells.flatMap(({difficulty, track}) => {
      const container = cellRefs.current.get(difficulty);
      return container
        ? [
            {
              container,
              chart,
              track,
              audioManager,
              // `showDrumLanes` is the legacy name for the shared lanes-on
              // switch. Keep it enabled here so the guitar track (including
              // its playline flames) is rendered; drum lanes remain untouched
              // because this route only supplies guitar tracks.
              config: {showDrumLanes: true, tomStyle: 'square' as const},
            },
          ]
        : [];
    });

    let grid: HighwayGrid | null = createHighwayGrid(host, gridCells);
    grid.ready.catch(error => {
      setGridError(error instanceof Error ? error.message : String(error));
    });

    return () => {
      grid?.destroy();
      grid = null;
    };
  }, [audioManager, chart, cells]);

  const setCellRef =
    (difficulty: GuitarDifficulty) => (element: HTMLDivElement | null) => {
      if (element) cellRefs.current.set(difficulty, element);
      else cellRefs.current.delete(difficulty);
    };

  if (gridError) {
    return (
      <div className="flex min-h-64 items-center justify-center rounded-lg border border-destructive/40 bg-destructive/10 p-6 text-center">
        <div>
          <AlertTriangle className="mx-auto h-6 w-6 text-destructive" />
          <p className="mt-2 text-sm font-medium text-destructive">
            Preview renderer failed to start
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{gridError}</p>
        </div>
      </div>
    );
  }

  return (
    <section aria-label="Guitar difficulty charts" className="relative">
      <div ref={canvasHostRef} />
      <div className="relative z-[1] grid gap-2 md:grid-cols-2 xl:grid-cols-4">
        {cells.map(({difficulty, track}) => (
          <div
            key={difficulty}
            className="relative min-w-0 overflow-hidden rounded-lg border border-border bg-transparent"
            style={{height: 320}}>
            <div className="pointer-events-none absolute inset-x-0 top-0 z-[2] flex items-center justify-between bg-black/70 px-3 py-2 text-xs text-white">
              <span className="font-semibold">{LABELS[difficulty]}</span>
              <span className="font-mono text-white/60">
                {track.noteEventGroups.reduce(
                  (sum, group) => sum + group.length,
                  0,
                )}{' '}
                notes
              </span>
            </div>
            <div ref={setCellRef(difficulty)} className="absolute inset-0" />
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        All four views share the chart audio and transport position.
      </p>
    </section>
  );
}
