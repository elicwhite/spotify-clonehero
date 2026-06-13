'use client';

import {useEffect, useState} from 'react';
import {toast} from 'sonner';
import {Button} from '@/components/ui/button';
import {Card, CardContent} from '@/components/ui/card';
import {Progress} from '@/components/ui/progress';
import {
  getActiveLadders,
  getGrooveClusters,
  getProgressSummary,
  hasFillsNeedingRescan,
  type ActiveLadder,
  type GrooveCluster,
  type ProgressSummary,
} from '@/lib/local-db/drum-fills';
import type {ScanProgress} from '@/lib/drum-fills/scan/types';
import GrooveSketch from './GrooveSketch';

/**
 * Practice-first home (plan 0045 §7). Answers "what should I drill right now?"
 * before any browsing:
 *  - a progress strip (grooves started · rungs climbed · fills mastered · due),
 *  - Due now → the SRS review queue,
 *  - Continue climbing → grooves with saved ladder progress,
 *  - Suggested groove → the largest unstarted cluster (start something new),
 *  - Surprise me → roulette.
 *
 * The fill Library and the Grooves explorer live behind this as nav layers.
 * First-run (no fills yet) collapses to a single Scan call to action.
 */
export default function HomeView({
  onStartReview,
  onStartGroove,
  onStartRoulette,
  onBrowseGrooves,
  onScan,
  scanning,
  scanProgress,
  hasData,
  loading,
}: {
  onStartReview: () => void;
  onStartGroove: (cluster: GrooveCluster) => void;
  onStartRoulette: () => void;
  onBrowseGrooves: () => void;
  onScan: () => void;
  scanning: boolean;
  scanProgress: ScanProgress | null;
  hasData: boolean;
  loading: boolean;
}) {
  const [summary, setSummary] = useState<ProgressSummary | null>(null);
  const [ladders, setLadders] = useState<ActiveLadder[]>([]);
  const [suggested, setSuggested] = useState<GrooveCluster | null>(null);
  const [needsRescan, setNeedsRescan] = useState(false);

  useEffect(() => {
    if (!hasData) return;
    let cancelled = false;
    (async () => {
      try {
        const [sum, active, clusters, stale] = await Promise.all([
          getProgressSummary(),
          getActiveLadders(6),
          getGrooveClusters(),
          hasFillsNeedingRescan(),
        ]);
        if (cancelled) return;
        setSummary(sum);
        setLadders(active);
        setNeedsRescan(stale);
        // Suggested = largest drillable cluster the user hasn't started yet.
        const startedKeys = new Set(active.map(a => a.cluster.similarityKey));
        const next = clusters
          .filter(c => c.fillCount >= 2 && !startedKeys.has(c.similarityKey))
          .sort((a, b) => b.fillCount - a.fillCount)[0];
        setSuggested(next ?? null);
      } catch (err) {
        console.error('Failed to load home', err);
        toast.error('Could not load your practice home.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hasData]);

  // First run / empty library: a single scan call to action.
  if (!loading && !hasData) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
        <h2 className="text-2xl font-semibold">Start practicing drum fills</h2>
        <p className="max-w-md text-muted-foreground">
          Scan your Clone Hero Songs folder to detect drum fills and the grooves
          they sit on. Everything runs in your browser.
        </p>
        <Button size="lg" onClick={onScan} disabled={scanning}>
          {scanning ? 'Scanning…' : 'Scan your library'}
        </Button>
        {scanning && scanProgress && (
          <div className="w-full max-w-md">
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
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-6">
      {/* Progress strip — the learning arc in one place. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          label="Grooves started"
          value={
            summary
              ? `${summary.groovesStarted} / ${summary.totalGrooves}`
              : '—'
          }
        />
        <Stat label="Rungs climbed" value={summary?.rungsClimbed ?? '—'} />
        <Stat label="Fills mastered" value={summary?.fillsMastered ?? '—'} />
        <Stat label="Due today" value={summary?.dueNow ?? '—'} accent />
      </div>

      {needsRescan && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
          <p className="text-sm text-amber-900">
            Some fills predate difficulty scoring and cross-song grouping.
            Rescan to enable ladders and difficulty sorting.
          </p>
          <Button onClick={onScan} disabled={scanning} size="sm">
            {scanning ? 'Scanning…' : 'Rescan'}
          </Button>
        </div>
      )}

      {/* Due now — the SRS review queue. */}
      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Due now</h2>
        {summary && summary.dueNow > 0 ? (
          <Card>
            <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
              <p className="text-sm">
                <span className="font-semibold">{summary.dueNow}</span> fill
                {summary.dueNow === 1 ? '' : 's'} due for review.
              </p>
              <Button onClick={onStartReview}>Start review</Button>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
              <p className="text-sm text-muted-foreground">
                All caught up — nothing due. Keep climbing or start a new
                groove.
              </p>
              <Button variant="outline" onClick={onStartReview}>
                Practice new fills
              </Button>
            </CardContent>
          </Card>
        )}
      </section>

      {/* Continue climbing — active ladders. */}
      {ladders.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">Continue climbing</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {ladders.map(l => (
              <LadderCard
                key={l.cluster.similarityKey}
                ladder={l}
                onContinue={() => onStartGroove(l.cluster)}
              />
            ))}
          </div>
        </section>
      )}

      {/* Suggested groove — start something new. */}
      {suggested && (
        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Suggested groove</h2>
            <Button variant="ghost" size="sm" onClick={onBrowseGrooves}>
              Explore all grooves
            </Button>
          </div>
          <Card>
            <CardContent className="flex flex-wrap items-center gap-4 pt-6">
              <div className="w-40 shrink-0">
                <GrooveSketch
                  fingerprint={suggested.representativeFingerprint}
                />
              </div>
              <div className="text-sm">
                <p className="font-medium">A fresh groove to drill</p>
                <p className="text-xs text-muted-foreground">
                  {suggested.fillCount} fills · {suggested.distinctSongs} songs
                  · {Math.round(suggested.tempoMin)}–
                  {Math.round(suggested.tempoMax)} BPM
                </p>
              </div>
              <div className="ml-auto flex items-center gap-2">
                <Button variant="ghost" onClick={onStartRoulette}>
                  Surprise me
                </Button>
                <Button onClick={() => onStartGroove(suggested)}>
                  Start ladder
                </Button>
              </div>
            </CardContent>
          </Card>
        </section>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string | number;
  accent?: boolean;
}) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <p
        className={
          'text-2xl font-bold ' +
          (accent ? 'text-amber-600' : 'text-foreground')
        }>
        {value}
      </p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function LadderCard({
  ladder,
  onContinue,
}: {
  ladder: ActiveLadder;
  onContinue: () => void;
}) {
  return (
    <Card className="flex flex-col">
      <CardContent className="flex flex-1 flex-col gap-3 pt-4">
        <GrooveSketch fingerprint={ladder.cluster.representativeFingerprint} />
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">
            Rung {ladder.rungIndex + 1} of {ladder.rungCount}
          </p>
          <Button size="sm" onClick={onContinue}>
            Continue
          </Button>
        </div>
        <Progress
          value={
            ladder.rungCount > 0
              ? (ladder.rungIndex / ladder.rungCount) * 100
              : 0
          }
        />
      </CardContent>
    </Card>
  );
}
