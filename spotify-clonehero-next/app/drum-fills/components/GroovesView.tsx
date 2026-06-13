'use client';

import {useEffect, useMemo, useState} from 'react';
import {toast} from 'sonner';
import {useGrooveFilters} from '../hooks/useGrooveFilters';
import {Button} from '@/components/ui/button';
import {Badge} from '@/components/ui/badge';
import {Card, CardContent} from '@/components/ui/card';
import {Slider} from '@/components/ui/slider';
import {cn} from '@/lib/utils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  getGrooveClusters,
  hasFillsNeedingGrooveRescan,
  type GrooveCluster,
} from '@/lib/drum-fills/db';
import {
  MIN_DRILLABLE_FILLS,
  filterAndSortGrooves,
  type GrooveProgress,
  type GrooveSort,
} from '@/lib/drum-fills/grooveClusters';
import type {DrumVoice} from '@/lib/drum-fills/detection/types';
import GrooveStave from './GrooveStave';
import VirtualCardGrid from './VirtualCardGrid';

/** Groove cards are taller than fill cards (full stave); tune the row height.
 * Card ≈ 364px rendered + the 16px grid gap. */
const GROOVE_ROW_HEIGHT = 384;

const SUBDIVISION_LABEL: Record<string, string> = {
  '8ths': '8ths',
  '16ths': '16ths',
  triplets: 'Triplets',
  mixed: 'Mixed',
};

const SORT_LABELS: Record<GrooveSort, string> = {
  'difficulty-asc': 'Easiest first',
  'difficulty-desc': 'Hardest first',
  'fills-desc': 'Most fills',
  'tempo-asc': 'Slowest first',
};

const PROGRESS_OPTIONS: Array<{value: GrooveProgress; label: string}> = [
  {value: 'not-started', label: 'New'},
  {value: 'in-progress', label: 'In progress'},
  {value: 'mastered', label: 'Mastered'},
];

const VOICE_OPTIONS: Array<{value: DrumVoice; label: string}> = [
  {value: 'kick', label: 'Kick'},
  {value: 'snare', label: 'Snare'},
  {value: 'hat', label: 'Hi-hat'},
  {value: 'tom', label: 'Tom'},
  {value: 'crash', label: 'Crash'},
];

const PROGRESS_BADGE: Record<
  GrooveProgress,
  {label: string; className: string}
> = {
  'not-started': {label: 'New', className: 'text-muted-foreground'},
  'in-progress': {
    label: 'In progress',
    className: 'text-amber-600 dark:text-amber-400',
  },
  mastered: {
    label: 'Mastered',
    className: 'text-emerald-600 dark:text-emerald-400',
  },
};

export default function GroovesView({
  onStartSession,
  onRescan,
  scanning,
}: {
  onStartSession: (cluster: GrooveCluster) => void;
  onRescan: () => void;
  scanning: boolean;
}) {
  const [clusters, setClusters] = useState<GrooveCluster[] | null>(null);
  const [needsRescan, setNeedsRescan] = useState(false);

  // Filter / sort state, persisted in the URL (survives reload).
  const {
    sort,
    progress,
    voices,
    minFills,
    setSort,
    setMinFills,
    toggleProgress,
    toggleVoice,
  } = useGrooveFilters();

  useEffect(() => {
    (async () => {
      try {
        const [list, stale] = await Promise.all([
          getGrooveClusters(),
          hasFillsNeedingGrooveRescan(),
        ]);
        setClusters(list);
        setNeedsRescan(stale);
      } catch (err) {
        console.error('Failed to load grooves', err);
        toast.error('Could not load grooves.');
        setClusters([]);
      }
    })();
  }, []);

  // Largest cluster's fill count bounds the min-fills slider.
  const maxFills = useMemo(
    () =>
      Math.max(MIN_DRILLABLE_FILLS, ...(clusters ?? []).map(c => c.fillCount)),
    [clusters],
  );

  const visible = useMemo(
    () =>
      filterAndSortGrooves(clusters ?? [], {minFills, progress, voices, sort}),
    [clusters, minFills, progress, voices, sort],
  );

  if (clusters === null) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        Loading grooves…
      </div>
    );
  }

  // Clusters with too few fills to drill are always excluded (handled inside
  // filterAndSortGrooves via minFills, which starts at MIN_DRILLABLE_FILLS).
  const drillableCount = clusters.filter(
    c => c.fillCount >= MIN_DRILLABLE_FILLS,
  ).length;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      {needsRescan && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
          <p className="text-sm text-amber-900">
            Some fills were detected before groove tracking. Rescan your library
            to enable Grooves for them.
          </p>
          <Button onClick={onRescan} disabled={scanning} size="sm">
            {scanning ? 'Scanning…' : 'Rescan Library'}
          </Button>
        </div>
      )}

      {clusters.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <h2 className="text-xl font-semibold">No grooves yet</h2>
          <p className="max-w-md text-muted-foreground">
            Scan your library to detect fills and the grooves they sit on. Pick
            a groove to drill many different fills over the same beat.
          </p>
          <Button onClick={onRescan} disabled={scanning}>
            {scanning ? 'Scanning…' : 'Scan Library'}
          </Button>
        </div>
      ) : drillableCount === 0 ? (
        <p className="py-10 text-center text-muted-foreground">
          No grooves recur across multiple fills yet. Scan more of your library
          to find shared grooves to drill.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-x-6 gap-y-3 rounded-lg border bg-muted/30 px-4 py-3">
            {/* Sort */}
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted-foreground">
                Sort
              </span>
              <Select
                value={sort}
                onValueChange={v => setSort(v as GrooveSort)}>
                <SelectTrigger className="h-8 w-[150px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(SORT_LABELS) as GrooveSort[]).map(s => (
                    <SelectItem key={s} value={s}>
                      {SORT_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Progress */}
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted-foreground">
                Progress
              </span>
              <div className="flex gap-1.5">
                {PROGRESS_OPTIONS.map(opt => (
                  <Button
                    key={opt.value}
                    size="sm"
                    variant={
                      progress.includes(opt.value) ? 'default' : 'outline'
                    }
                    className="h-8"
                    onClick={() => toggleProgress(opt.value)}>
                    {opt.label}
                  </Button>
                ))}
              </div>
            </div>

            {/* Voicing */}
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted-foreground">
                Beat uses (all selected)
              </span>
              <div className="flex gap-1.5">
                {VOICE_OPTIONS.map(opt => (
                  <Button
                    key={opt.value}
                    size="sm"
                    variant={voices.includes(opt.value) ? 'default' : 'outline'}
                    className="h-8"
                    onClick={() => toggleVoice(opt.value)}>
                    {opt.label}
                  </Button>
                ))}
              </div>
            </div>

            {/* Min fills */}
            <div className="flex min-w-[160px] flex-col gap-1">
              <span className="text-xs font-medium text-muted-foreground">
                Min fills: {minFills}
              </span>
              <Slider
                className="mt-2"
                min={MIN_DRILLABLE_FILLS}
                max={maxFills}
                step={1}
                value={[minFills]}
                onValueChange={([v]) => setMinFills(v)}
              />
            </div>
          </div>

          {visible.length === 0 ? (
            <p className="py-10 text-center text-muted-foreground">
              No grooves match these filters.
            </p>
          ) : (
            <VirtualCardGrid
              items={visible}
              getKey={c => c.similarityKey}
              rowHeight={GROOVE_ROW_HEIGHT}
              onActivate={index => onStartSession(visible[index])}
              renderCard={(cluster, _index, {focused, onFocus}) => (
                <GrooveCard
                  cluster={cluster}
                  focused={focused}
                  onFocus={onFocus}
                  onStart={() => onStartSession(cluster)}
                />
              )}
            />
          )}
        </>
      )}
    </div>
  );
}

function GrooveCard({
  cluster,
  onStart,
  focused = false,
  onFocus,
}: {
  cluster: GrooveCluster;
  onStart: () => void;
  focused?: boolean;
  onFocus?: () => void;
}) {
  const tempoLabel =
    Math.round(cluster.tempoMin) === Math.round(cluster.tempoMax)
      ? `${Math.round(cluster.tempoMin)} BPM`
      : `${Math.round(cluster.tempoMin)}–${Math.round(cluster.tempoMax)} BPM`;

  return (
    <Card
      role="gridcell"
      onFocus={onFocus}
      className={cn('flex flex-col', focused && 'ring-2 ring-ring')}>
      <CardContent className="flex flex-1 flex-col gap-3 pt-4">
        <GrooveStave fingerprint={cluster.representativeFingerprint} />

        <div className="flex flex-wrap gap-1.5 text-xs">
          <Badge variant="secondary">
            {cluster.fillCount} fill{cluster.fillCount === 1 ? '' : 's'}
          </Badge>
          <Badge variant="secondary">
            {cluster.distinctSongs} song{cluster.distinctSongs === 1 ? '' : 's'}
          </Badge>
          <Badge variant="outline">{tempoLabel}</Badge>
          <Badge variant="outline">Diff {cluster.grooveDifficulty}</Badge>
          {cluster.progress !== 'not-started' && (
            <Badge
              variant="outline"
              className={PROGRESS_BADGE[cluster.progress].className}>
              {PROGRESS_BADGE[cluster.progress].label}
            </Badge>
          )}
        </div>

        {cluster.subdivisions.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {cluster.subdivisions.map(s => (
              <Badge key={s.value} variant="outline" className="text-[10px]">
                {SUBDIVISION_LABEL[s.value] ?? s.value} ×{s.count}
              </Badge>
            ))}
          </div>
        )}

        <div className="mt-auto flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            Cx {cluster.complexities.join(', ')}
          </span>
          <Button
            size="sm"
            onClick={onStart}
            disabled={cluster.fillCount === 0}>
            Drill groove
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
