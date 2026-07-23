'use client';

import {useEffect, useMemo, useRef, useState} from 'react';
import {toast} from 'sonner';
import {AlertTriangle, RotateCcw} from 'lucide-react';
import ChartDropZone from '@/components/chart-picker/ChartDropZone';
import type {LoadedFiles} from '@/components/chart-picker/chart-file-readers';
import {Button} from '@/components/ui/button';
import {AudioManager} from '@/lib/preview/audioManager';
import type {Track} from '@/lib/preview/highway/types';
import {
  computeReductions,
  loadOursModels,
  runOurs,
  type OursModels,
  type OursReducerTiers,
  type ReductionModel,
  type ReductionRejection,
  type ReducerTiers,
} from '@/lib/drum-difficulty/computeReductions';
import {
  oursNotesToTrack,
  reducedNotesToTrack,
  TIERS,
  type Tier,
} from '@/lib/drum-difficulty/toRenderableTrack';
import ExportChartDialog from './ExportChartDialog';
import ReductionGrid, {type ReducerCell} from './ReductionGrid';
import TransportBar from './components/TransportBar';

function rejectionMessage(rej: ReductionRejection): string {
  switch (rej.reason) {
    case 'no-drums':
      return 'This chart has no drums track.';
    case 'no-expert-track':
      return 'This chart has no Expert drum track.';
    case 'no-notes':
      return "This chart's Expert drum track has no notes.";
    case 'no-audio':
      return 'This chart has no audio. The comparison needs a shared audio track.';
    case 'not-pro-drums':
      return rej.drumType === 'five-lane'
        ? 'This is a 5-lane (Guitar Hero) drum chart. Pro-drums charts only.'
        : 'This is a basic 4-lane drum chart. Pro-drums charts only.';
  }
}

/** Turn one reducer's outcome into three renderable/error/paused cells. */
function tierCells(
  tiers: ReducerTiers,
  model: ReductionModel,
): Record<Tier, ReducerCell> {
  const out = {} as Record<Tier, ReducerCell>;
  for (const tier of TIERS) {
    if (!tiers.ok) {
      out[tier] = {kind: 'error', message: tiers.error};
      continue;
    }
    try {
      out[tier] = {
        kind: 'highway',
        track: reducedNotesToTrack(tiers.tiers[tier], model.parsedChart, tier),
      };
    } catch (e) {
      out[tier] = {
        kind: 'error',
        message: e instanceof Error ? e.message : String(e),
      };
    }
  }
  return out;
}

/** Turn Ours' async outcome into three renderable/error cells (no rescale —
 * Ours' notes carry their own tick/msTime). */
function oursTierCells(tiers: OursReducerTiers): Record<Tier, ReducerCell> {
  const out = {} as Record<Tier, ReducerCell>;
  for (const tier of TIERS) {
    if (!tiers.ok) {
      out[tier] = {kind: 'error', message: tiers.error};
      continue;
    }
    try {
      out[tier] = {
        kind: 'highway',
        track: oursNotesToTrack(tiers.tiers[tier], tier),
      };
    } catch (e) {
      out[tier] = {
        kind: 'error',
        message: e instanceof Error ? e.message : String(e),
      };
    }
  }
  return out;
}

/** The chart's own authored Hard/Medium/Easy tracks are already renderable
 * `Track`s (scan-chart parses every present difficulty, not just Expert) —
 * no reducer output to convert, just wrap each tier directly. */
function harmonixTierCells(
  tiers: Record<Tier, Track>,
): Record<Tier, ReducerCell> {
  const out = {} as Record<Tier, ReducerCell>;
  for (const tier of TIERS) {
    out[tier] = {kind: 'highway', track: tiers[tier]};
  }
  return out;
}

const OURS_LOADING_CELLS: Record<Tier, ReducerCell> = {
  hard: {kind: 'loading'},
  medium: {kind: 'loading'},
  easy: {kind: 'loading'},
};

type View =
  | {status: 'empty'}
  | {status: 'error'; message: string}
  | {status: 'model'; model: ReductionModel; loaded: LoadedFiles; id: number};

export default function DifficultiesClient() {
  const [view, setView] = useState<View>({status: 'empty'});
  const [audioManager, setAudioManager] = useState<AudioManager | null>(null);
  const [oursModels, setOursModels] = useState<OursModels | null>(null);
  const [oursModelsError, setOursModelsError] = useState<string | null>(null);
  const idRef = useRef(0);

  // Kick off the ~37MB Ours model fetch as soon as the page mounts, before a
  // chart is even uploaded, so it's likely already resolved by the time the
  // user picks one — HOPCAT/Onyx never wait on it. `loadOursModels` caches, so
  // this runs the network fetch at most once per session.
  useEffect(() => {
    let cancelled = false;
    loadOursModels().then(
      m => {
        if (!cancelled) setOursModels(m);
      },
      e => {
        if (!cancelled) {
          setOursModelsError(e instanceof Error ? e.message : String(e));
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  function onLoaded(loaded: LoadedFiles) {
    try {
      const result = computeReductions(loaded);
      if (!result.ok) {
        setView({status: 'error', message: rejectionMessage(result)});
        return;
      }
      idRef.current += 1;
      setView({
        status: 'model',
        model: result.model,
        loaded,
        id: idRef.current,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to read chart';
      toast.error(message);
      setView({status: 'error', message});
    }
  }

  function reset() {
    setView({status: 'empty'});
  }

  const model = view.status === 'model' ? view.model : null;

  // One shared AudioManager per loaded chart. Every cell + the transport read
  // this single instance (the codebase's one-instance, per-frame-poll pattern).
  useEffect(() => {
    if (!model) return;
    let cancelled = false;
    const manager = new AudioManager(model.audioFiles, () => {});
    manager.ready.then(() => {
      if (cancelled) {
        manager.destroy();
        return;
      }
      manager.setChartDelay(model.chartDelayMs / 1000);
      setAudioManager(manager);
    });
    return () => {
      cancelled = true;
      manager.destroy();
      setAudioManager(null);
    };
  }, [model]);

  // Ours runs synchronously once its models resolve; until then (or on a model
  // fetch failure) its three cells show a loading / error state rather than
  // blocking HOPCAT/Onyx or the whole grid (plan §8).
  const oursCells = useMemo<Record<Tier, ReducerCell>>(() => {
    if (!model) return OURS_LOADING_CELLS;
    if (oursModelsError) {
      const err: ReducerCell = {kind: 'error', message: oursModelsError};
      return {hard: err, medium: err, easy: err};
    }
    if (!oursModels) return OURS_LOADING_CELLS;
    return oursTierCells(
      runOurs(model.rawDrumChart, model.parsedChart, oursModels),
    );
  }, [model, oursModels, oursModelsError]);

  const rows = useMemo(() => {
    if (!model) return null;
    const harmonixRow = model.harmonixTiers
      ? [
          {
            name: 'Harmonix',
            cells: harmonixTierCells(model.harmonixTiers),
          },
        ]
      : [];
    return [
      {name: 'Ours', cells: oursCells},
      ...harmonixRow,
      {name: 'HOPCAT', cells: tierCells(model.reducers.hopcat, model)},
      {name: 'Onyx', cells: tierCells(model.reducers.onyx, model)},
    ];
  }, [model, oursCells]);

  // The grid builds its cells once at mount (its own effect has empty deps), so
  // remount it via `key` when Ours transitions out of its loading state — that
  // one-time flip lets its three highways join the shared renderer. Usually the
  // models are already loaded by upload time, so this never actually re-mounts.
  const oursResolved = model != null && oursCells.hard.kind !== 'loading';

  // Export always uses Ours (HOPCAT/Onyx are comparison-only, per plan) — only
  // enabled once all three of its tiers rendered successfully.
  const oursTracks: Record<Tier, Track> | null =
    oursCells.hard.kind === 'highway' &&
    oursCells.medium.kind === 'highway' &&
    oursCells.easy.kind === 'highway'
      ? {
          hard: oursCells.hard.track,
          medium: oursCells.medium.track,
          easy: oursCells.easy.track,
        }
      : null;

  return (
    <main className="mx-auto max-w-[1400px] px-4 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Drum Difficulty Comparison</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Upload a pro-drums chart to compare Hard / Medium / Easy reductions
          from Ours, HOPCAT, and Onyx side by side, locked to one shared audio
          track.
        </p>
      </header>

      {view.status === 'empty' && (
        <div className="mx-auto max-w-xl">
          <ChartDropZone onLoaded={onLoaded} id="difficulties-picker" />
        </div>
      )}

      {view.status === 'error' && (
        <div className="mx-auto max-w-xl space-y-4">
          <div className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
            <div className="text-sm">
              <p className="font-medium text-destructive">
                Can&apos;t compare this chart
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

      {view.status === 'model' && rows && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            {audioManager ? (
              <div className="flex-1">
                <TransportBar audioManager={audioManager} />
              </div>
            ) : (
              <p className="flex-1 text-sm text-muted-foreground">
                Loading audio…
              </p>
            )}
            {oursTracks && view.status === 'model' && (
              <ExportChartDialog loaded={view.loaded} oursTracks={oursTracks} />
            )}
            <Button variant="outline" size="sm" onClick={reset}>
              <RotateCcw className="mr-2 h-4 w-4" />
              New chart
            </Button>
          </div>

          {audioManager && (
            <ReductionGrid
              key={`${view.id}-${oursResolved ? 'ours' : 'loading'}`}
              parsedChart={model!.parsedChart}
              audioManager={audioManager}
              expertTrack={model!.expertTrack}
              rows={rows}
            />
          )}
        </div>
      )}
    </main>
  );
}
