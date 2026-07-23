'use client';

import {useEffect, useRef} from 'react';
import {AlertTriangle, Loader2} from 'lucide-react';
import type {AudioManager} from '@/lib/preview/audioManager';
import type {ParsedChart} from '@/lib/preview/chorus-chart-processing';
import type {Track} from '@/lib/preview/highway/types';
import {
  createHighwayGrid,
  type HighwayGrid,
  type HighwayGridCell,
} from '@/lib/preview/highway/multiCell';
import {cn} from '@/lib/utils';
import type {Tier} from '@/lib/drum-difficulty/toRenderableTrack';

/**
 * A reducer x tier slot: a renderable track, a per-cell error, still-loading
 * (Ours' models are being fetched), or paused.
 */
export type ReducerCell =
  | {kind: 'highway'; track: Track}
  | {kind: 'error'; message: string}
  | {kind: 'loading'}
  | {kind: 'paused'};

export interface ReductionGridProps {
  parsedChart: ParsedChart;
  audioManager: AudioManager;
  expertTrack: Track;
  /** Row order top-to-bottom: Ours, then (for a Harmonix-charted upload
   * only) Harmonix's own authored tiers, then HOPCAT, then Onyx. Row count
   * is otherwise unconstrained — the grid layout below sizes itself off
   * `rows.length`. */
  rows: {name: string; cells: Record<Tier, ReducerCell>}[];
}

const TIERS: Tier[] = ['hard', 'medium', 'easy'];
const TIER_LABEL: Record<Tier, string> = {
  hard: 'Hard',
  medium: 'Medium',
  easy: 'Easy',
};
const CELL_HEIGHT = 240;

function cellId(rowName: string, tier: Tier): string {
  return `${rowName}:${tier}`;
}

export default function ReductionGrid({
  parsedChart,
  audioManager,
  expertTrack,
  rows,
}: ReductionGridProps) {
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const cellRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  useEffect(() => {
    const host = canvasHostRef.current;
    if (!host) return;

    const specs: {id: string; track: Track}[] = [
      {id: 'expert', track: expertTrack},
    ];
    for (const row of rows) {
      for (const tier of TIERS) {
        const cell = row.cells[tier];
        if (cell.kind === 'highway') {
          specs.push({id: cellId(row.name, tier), track: cell.track});
        }
      }
    }

    const gridCells: HighwayGridCell[] = [];
    for (const spec of specs) {
      const container = cellRefs.current.get(spec.id);
      if (!container) continue;
      gridCells.push({
        container,
        chart: parsedChart,
        track: spec.track,
        audioManager,
        config: {showDrumLanes: true, tomStyle: 'square'},
      });
    }

    let grid: HighwayGrid | null = createHighwayGrid(host, gridCells);
    grid.ready.catch(e => {
      console.error('ReductionGrid: highway grid failed to start', e);
    });

    return () => {
      grid?.destroy();
      grid = null;
    };
    // Mounted once per upload — the parent remounts this via `key` when a new
    // chart is loaded, so the reduced tracks are fixed for the component's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ref-callback map: the callback runs at commit, not during render, so the
  // ref writes are safe. react-hooks/refs can't see that through the closure.
  /* eslint-disable react-hooks/refs */
  const setCellRef = (id: string) => (el: HTMLDivElement | null) => {
    if (el) cellRefs.current.set(id, el);
    else cellRefs.current.delete(id);
  };
  /* eslint-enable react-hooks/refs */

  return (
    <div className="relative">
      {/* Fixed, full-viewport canvas the grid renders every cell into. */}
      <div ref={canvasHostRef} />

      <div
        className="relative z-[1] grid gap-2"
        style={{
          // Expert spans every reducer row, so it is ~rows.length times taller
          // than a single tier cell. Give it a matching share of the width so
          // its highway keeps roughly the same aspect ratio (and camera FOV) as
          // the near-square 3x3 tier cells, instead of a tall, pinched sliver.
          gridTemplateColumns: `${rows.length}fr 1fr 1fr 1fr`,
          gridTemplateRows: `auto repeat(${rows.length}, ${CELL_HEIGHT}px)`,
        }}>
        {/* Column headers (row 1, tier columns). */}
        <div className="flex items-end pb-1 pl-1 text-sm font-semibold text-muted-foreground">
          Expert
        </div>
        {TIERS.map(tier => (
          <div
            key={`head-${tier}`}
            className="flex items-end justify-center pb-1 text-sm font-semibold text-muted-foreground">
            {TIER_LABEL[tier]}
          </div>
        ))}

        {/* Expert: tall left column spanning every reducer row. */}
        <div
          ref={setCellRef('expert')}
          className="relative overflow-hidden rounded-lg border border-border"
          style={{gridColumn: '1', gridRow: `2 / span ${rows.length}`}}>
          <CellLabel>Expert</CellLabel>
        </div>

        {/* Reducer rows. */}
        {rows.map(row =>
          TIERS.map(tier => {
            const cell = row.cells[tier];
            const id = cellId(row.name, tier);
            return (
              <CellShell key={id} label={`${row.name} · ${TIER_LABEL[tier]}`}>
                {cell.kind === 'highway' ? (
                  <div ref={setCellRef(id)} className="absolute inset-0" />
                ) : cell.kind === 'loading' ? (
                  <LoadingBody />
                ) : cell.kind === 'paused' ? (
                  <PausedBody />
                ) : (
                  <ErrorBody message={cell.message} />
                )}
              </CellShell>
            );
          }),
        )}
      </div>
    </div>
  );
}

function CellShell({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="relative overflow-hidden rounded-lg border border-border">
      <CellLabel>{label}</CellLabel>
      {children}
    </div>
  );
}

function CellLabel({children}: {children: React.ReactNode}) {
  return (
    <span className="pointer-events-none absolute left-2 top-1.5 z-[2] font-mono text-[11px] text-primary/80">
      {children}
    </span>
  );
}

function PausedBody() {
  return (
    <div
      className={cn(
        'absolute inset-0 flex flex-col items-center justify-center gap-1',
        'bg-muted/40 text-center text-muted-foreground',
      )}>
      <span className="text-sm font-medium">Coming soon</span>
      <span className="max-w-[80%] text-xs">
        A new model version is in progress.
      </span>
    </div>
  );
}

function LoadingBody() {
  return (
    <div
      className={cn(
        'absolute inset-0 flex flex-col items-center justify-center gap-2',
        'bg-muted/40 text-center text-muted-foreground',
      )}>
      <Loader2 className="h-5 w-5 animate-spin" />
      <span className="text-xs">Loading model…</span>
    </div>
  );
}

function ErrorBody({message}: {message: string}) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-destructive/10 px-3 text-center">
      <AlertTriangle className="h-5 w-5 text-destructive" />
      <span className="text-xs font-medium text-destructive">
        Reduction failed
      </span>
      <span className="max-w-full truncate text-[11px] text-muted-foreground">
        {message}
      </span>
    </div>
  );
}
