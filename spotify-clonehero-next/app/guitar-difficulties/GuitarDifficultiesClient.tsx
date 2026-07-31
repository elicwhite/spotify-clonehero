'use client';

import {useCallback, useEffect, useState} from 'react';
import {AlertTriangle, Loader2, RotateCcw} from 'lucide-react';
import {Button} from '@/components/ui/button';
import GuitarDifficultyGrid from './GuitarDifficultyGrid';
import {
  loadGuitarReductionSnapshot,
  type ParsedGuitarReductionSnapshot,
} from '@/lib/guitar-difficulty/snapshot';

type View =
  | {status: 'loading'}
  | {status: 'ready'; preview: ParsedGuitarReductionSnapshot}
  | {status: 'empty'}
  | {status: 'error'; message: string};

function countNotes(
  preview: ParsedGuitarReductionSnapshot,
  difficulty: keyof ParsedGuitarReductionSnapshot['tracks'],
) {
  return preview.tracks[difficulty].noteEventGroups.reduce(
    (sum, group) => sum + group.length,
    0,
  );
}

export default function GuitarDifficultiesClient() {
  const [view, setView] = useState<View>({status: 'loading'});

  const load = useCallback(() => {
    const controller = new AbortController();
    loadGuitarReductionSnapshot(controller.signal).then(
      preview => {
        const hasNotes = Object.values(preview.tracks).some(
          track => track.noteEventGroups.length > 0,
        );
        setView(hasNotes ? {status: 'ready', preview} : {status: 'empty'});
      },
      error => {
        if (error instanceof DOMException && error.name === 'AbortError')
          return;
        setView({
          status: 'error',
          message: error instanceof Error ? error.message : String(error),
        });
      },
    );
    return () => controller.abort();
  }, []);

  useEffect(load, [load]);

  return (
    <main className="mx-auto max-w-[1500px] px-4 py-8">
      <header className="mb-6">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold">Guitar Difficulty Preview</h1>
          <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-700 dark:text-amber-300">
            Frozen preview snapshot
          </span>
        </div>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Compare Expert against model-reduced Hard, Medium, and Easy five-fret
          guitar charts side by side. This prototype uses a representative song
          fixture and the pinned e101baa model output.
        </p>
      </header>

      {view.status === 'loading' && (
        <div className="flex min-h-64 items-center justify-center rounded-lg border border-border bg-muted/30">
          <div className="text-center text-sm text-muted-foreground">
            <Loader2 className="mx-auto h-6 w-6 animate-spin" />
            <p className="mt-2">Loading the frozen guitar snapshot…</p>
          </div>
        </div>
      )}

      {view.status === 'error' && (
        <div className="mx-auto max-w-xl space-y-4">
          <div className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
            <div className="text-sm">
              <p className="font-medium text-destructive">
                Can&apos;t load the guitar preview
              </p>
              <p className="mt-1 text-muted-foreground">{view.message}</p>
            </div>
          </div>
          <Button
            variant="outline"
            onClick={() => {
              setView({status: 'loading'});
              load();
            }}>
            <RotateCcw className="mr-2 h-4 w-4" />
            Retry snapshot
          </Button>
        </div>
      )}

      {view.status === 'empty' && (
        <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          This frozen snapshot does not contain a renderable guitar fixture.
        </div>
      )}

      {view.status === 'ready' && (
        <div className="space-y-5">
          <section className="rounded-lg border border-border bg-muted/20 p-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-base font-semibold">
                  {view.preview.snapshot.song.artist} —{' '}
                  {view.preview.snapshot.song.title}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Representative{' '}
                  {view.preview.snapshot.song.window.endTick -
                    view.preview.snapshot.song.window.startTick}{' '}
                  tick fixture · parsed with{' '}
                  {view.preview.snapshot.parser.package}@
                  {view.preview.snapshot.parser.packageVersion}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setView({status: 'loading'});
                  load();
                }}>
                <RotateCcw className="mr-2 h-4 w-4" />
                Reload snapshot
              </Button>
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-4">
              {(['expert', 'hard', 'medium', 'easy'] as const).map(
                difficulty => (
                  <div
                    key={difficulty}
                    className="rounded-md border border-border/70 bg-background/60 px-3 py-2">
                    <p className="text-xs text-muted-foreground">
                      {difficulty[0].toUpperCase() + difficulty.slice(1)}
                    </p>
                    <p className="mt-1 font-mono text-lg">
                      {countNotes(view.preview, difficulty)}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      parsed guitar notes
                    </p>
                  </div>
                ),
              )}
            </div>
          </section>

          <GuitarDifficultyGrid
            chart={view.preview.chart}
            tracks={view.preview.tracks}
          />

          <details className="rounded-lg border border-border bg-muted/10 p-4 text-xs">
            <summary className="cursor-pointer font-medium">
              Snapshot provenance and model configuration
            </summary>
            <dl className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <dt className="text-muted-foreground">Snapshot</dt>
                <dd className="font-mono">
                  {view.preview.snapshot.snapshotId}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Source commit</dt>
                <dd className="font-mono">
                  {view.preview.snapshot.model.sourceCommit}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Frozen at</dt>
                <dd>{view.preview.snapshot.frozenAt}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Feature variant</dt>
                <dd className="font-mono">
                  {view.preview.snapshot.model.featureVariant}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Mask decoder</dt>
                <dd>{view.preview.snapshot.model.maskDecoder}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Techniques</dt>
                <dd>
                  {view.preview.snapshot.model.technique} ·{' '}
                  {view.preview.snapshot.model.techniqueCleanup}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Sustain</dt>
                <dd>
                  {view.preview.snapshot.model.sustain} ·{' '}
                  {view.preview.snapshot.model.sustainConstraint}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Range</dt>
                <dd>{view.preview.snapshot.model.range}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">HGB</dt>
                <dd>
                  iter {view.preview.snapshot.model.hyperparameters.iterations}{' '}
                  · lr{' '}
                  {view.preview.snapshot.model.hyperparameters.learningRate} ·
                  leaf {view.preview.snapshot.model.hyperparameters.leafNodes} ·
                  minleaf{' '}
                  {view.preview.snapshot.model.hyperparameters.minSamplesLeaf} ·
                  l2{' '}
                  {view.preview.snapshot.model.hyperparameters.l2Regularization}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Validation</dt>
                <dd>
                  {view.preview.snapshot.validation.seeds
                    .map(
                      seed =>
                        `${seed.seed}: ${seed.pooledChartEditRate.toFixed(8)}`,
                    )
                    .join(' · ')}
                </dd>
              </div>
            </dl>
            <p className="mt-3 text-muted-foreground">
              The checked-in artifact is precomputed model output for this
              representative fixture; it does not embed a live
              Python/scikit-learn model. The export script and source hashes are
              recorded in the artifact for reproducibility while the model
              evolves.
            </p>
          </details>
        </div>
      )}
    </main>
  );
}
