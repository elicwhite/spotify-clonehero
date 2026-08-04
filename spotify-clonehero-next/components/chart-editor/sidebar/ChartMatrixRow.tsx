'use client';

/**
 * One Chart Matrix row (plan 0074 Phase 3/4, Design C/D; plan 0076 item 8): an
 * instrument's charted difficulties as toggle cells, plus the row-tail
 * affordance for its Hard/Medium/Easy set:
 *
 * - No lower difficulties charted: a spanning "Generate H · M · E" bar
 *   (disabled with a typed reason when no assist runner is wired in — see
 *   `useDifficultyGeneration`'s `disabledReason`).
 * - Some but not all of Hard/Medium/Easy charted: a slim "Generate H · M · E"
 *   bar directly under those three columns. Generation is set-shaped (it
 *   writes all three), so a partial set still has an affordance rather than
 *   being reachable only by deleting what is there.
 * - Lower difficulties charted and stale (Expert edited since generation): a
 *   slim amber "Re-generate H · M · E" bar under those columns, mirroring the
 *   Chart Assist recommendation card's own call-to-action.
 *
 * There is no per-instrument overflow menu on the row (plan 0076 item 8
 * removed it — it truncated the instrument name for a rarely-used "Delete
 * H/M/E" action). That action now lives on the difficulty-generation Chart
 * Assist card instead.
 *
 * While this instrument's generation is in flight — started here OR from the
 * Chart Assist card, since `useDifficultyGeneration` reports one shared
 * answer — its difficulty cells lock (`ChartMatrixCell`'s `locked`), so a
 * mid-generation toggle can't race the command that's about to
 * install/replace the tracks. Other rows are unaffected.
 *
 * Right-click on the row label or a cell opens the delete context menu
 * (plan 0077 item 6), built by `ChartMatrixContextMenu`. This row only
 * forwards the two `onContextMenu` callbacks, adding the one thing it alone
 * knows: whether THIS instrument has any lower difficulties charted at all
 * (`hasLowerDifficulties`), which decides whether "Delete all lower
 * difficulties" belongs in the menu.
 */

import type {MouseEvent} from 'react';
import {Sparkles} from 'lucide-react';
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip';
import {cn} from '@/lib/utils';
import type {Difficulty, ParsedTrackData, TrackKey} from '@/lib/chart-edit';
import type {AssistProvenance} from '@/lib/chart-editor-core';
import {
  LOWER_TRACK_DIFFICULTIES,
  type SupportedTrackInstrument,
  type SupportedTrackKey,
} from '@/lib/chart-editor-core';
import {ConnectedAssistRunCard} from '@/components/assist/AssistRunCard';
import type {AssistRunnerControls} from '@/components/assist/useAssistRunner';
import ChartMatrixCell from './ChartMatrixCell';
import InstrumentIcon from '../InstrumentIcon';
import {trackKeyId} from '../scope';
import {
  DIFFICULTY_COLUMNS,
  INSTRUMENT_LABEL,
  difficultyName,
} from '../trackLabels';

interface GenerateSetBarProps {
  instrument: SupportedTrackInstrument;
  /** True to span the empty H/M/E columns on the cells' own grid row (a row
   *  with no lower difficulties at all), matching the cells' height. False
   *  puts a slimmer bar on the grid row below them, same three columns. */
  spansEmptyCells: boolean;
  /** Amber call-to-action styling and "Re-generate" wording (Expert changed
   *  since these tiers were generated). */
  stale: boolean;
  /** Why the button can't run — rendered in a tooltip AND in an always-present
   *  `sr-only` node, since a disabled control has neither. Undefined = live. */
  disabledReason: string | undefined;
  onGenerate: () => void;
  generating: boolean;
  runner: AssistRunnerControls | null;
}

/**
 * The row's Generate/Re-generate affordance, in both of the places the row
 * puts one. While this instrument's run is in flight the bar is replaced by
 * the shared inline `AssistRunCard` (progress + Cancel), which is the only
 * Cancel affordance the run has.
 *
 * Disabled state is `aria-disabled` plus an early-returning `onClick` rather
 * than the `disabled` attribute: a natively disabled button emits no pointer
 * events, so its tooltip could never open and the reason would be unreachable
 * by hover, by keyboard and by screen reader.
 */
function GenerateSetBar({
  instrument,
  spansEmptyCells,
  stale,
  disabledReason,
  onGenerate,
  generating,
  runner,
}: GenerateSetBarProps) {
  const label = INSTRUMENT_LABEL[instrument];
  const disabled = disabledReason !== undefined;
  const reasonId = `gen-reason-${instrument}`;
  // Both bars occupy the H/M/E columns: spanning the empty cells on the row
  // itself when there are none, and directly under those same three cells
  // otherwise — the prototype's `.gen-bar.inrow` and `.gen-bar.under`, which
  // share a column span and differ only in height and treatment.
  const gridColumn = '3 / 6';
  const minHeight = spansEmptyCells ? 'min-h-[1.875rem]' : 'min-h-[1.25rem]';

  if (generating && runner) {
    return (
      <div style={{gridColumn}}>
        <ConnectedAssistRunCard
          store={runner.store}
          task="generate-difficulties"
          onCancel={runner.cancel}
          onDismiss={runner.dismiss}
          className={
            stale
              ? 'rounded-md border border-amber-400/60 bg-amber-50 p-2 text-[11px] dark:border-amber-500/40 dark:bg-amber-950/20'
              : 'text-[11px]'
          }
        />
      </div>
    );
  }

  return (
    <div style={{gridColumn}}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={`${stale ? 'Re-generate' : 'Generate'} ${label} Hard, Medium, Easy difficulties`}
            aria-disabled={disabled || undefined}
            aria-describedby={disabled ? reasonId : undefined}
            onClick={() => {
              if (disabled) return;
              onGenerate();
            }}
            className={cn(
              'flex w-full items-center justify-center gap-1.5 rounded-md text-[10.5px] font-semibold transition-colors',
              minHeight,
              stale
                ? 'border border-amber-400/60 bg-amber-50 text-amber-800 dark:border-amber-500/40 dark:bg-amber-950/20 dark:text-amber-300'
                : // The prototype tints the plain Generate bar with the accent
                  // rather than leaving it neutral grey: it is an offer, not a
                  // disabled placeholder.
                  'border border-dashed border-primary/40 bg-primary/5 text-primary',
              disabled && 'cursor-default',
              disabled &&
                !stale &&
                'border-border/60 bg-transparent text-muted-foreground/60',
              disabled && stale && 'opacity-70',
              !disabled &&
                (stale ? 'hover:bg-amber-100' : 'hover:bg-primary/10'),
            )}>
            <Sparkles className="h-3 w-3" />
            {stale ? 'Re-generate H · M · E' : 'Generate H · M · E'}
          </button>
        </TooltipTrigger>
        {disabled && (
          <TooltipContent side="right">{disabledReason}</TooltipContent>
        )}
      </Tooltip>
      {disabled && (
        // Same reason, always in the DOM: the tooltip is the sighted-hover
        // route, this is the route for screen readers and for tests that
        // don't simulate a hover.
        <span id={reasonId} className="sr-only">
          {disabledReason}
        </span>
      )}
    </div>
  );
}

function noteCount(track: ParsedTrackData | undefined): number {
  if (!track) return 0;
  return track.noteEventGroups.reduce((sum, group) => sum + group.length, 0);
}

function cellTooltip(
  instrument: SupportedTrackInstrument,
  difficulty: Difficulty,
  track: ParsedTrackData,
  provenance: AssistProvenance | undefined,
  visible: boolean,
): string {
  const count = noteCount(track);
  const noteWord = count === 1 ? 'note' : 'notes';
  const lines = [
    `${INSTRUMENT_LABEL[instrument]} ${difficultyName(difficulty)}: ${count} ${noteWord}`,
  ];

  const isExpert = difficulty === 'expert';
  const aiOrigin = isExpert
    ? instrument === 'drums' &&
      provenance?.tempoDerived?.['drum-transcription'] !== undefined
      ? 'AI-transcribed'
      : undefined
    : provenance?.difficulties?.[instrument] !== undefined
      ? 'AI-generated from Expert'
      : undefined;
  if (aiOrigin) lines.push(aiOrigin);

  lines.push(`Click to ${visible ? 'hide from' : 'show in'} the editor`);
  return lines.join('\n');
}

export interface ChartMatrixRowProps {
  instrument: SupportedTrackInstrument;
  trackData: readonly ParsedTrackData[];
  visibleTrackKeys: ReadonlySet<string>;
  provenance: AssistProvenance | undefined;
  onToggle: (track: TrackKey) => void;
  /** True when this instrument's Hard/Medium/Easy were generated from an
   *  Expert track that has since changed (plan 0074 Design C staleness). */
  stale: boolean;
  /** True while THIS instrument's `generate-difficulties` run is in flight. */
  generating: boolean;
  /** Starts (or restarts) generation for this instrument. */
  onGenerate: () => void;
  /** Why `onGenerate` can't run here — a standing limit (no runner, or an
   *  instrument this build doesn't generate for). The single discriminator
   *  for the Generate bar's disabled state; undefined means it is live. */
  generateDisabledReason: string | undefined;
  /** The shared assist runner, for the inline `AssistRunCard` treatment
   *  (progress + Cancel) while THIS row's generation is in flight — the
   *  same "one renderer, two shells" contract every other card uses (plan
   *  0074 Design B). Null when no runner is wired into this host; present
   *  even for an instrument whose generation is disabled. */
  runner: AssistRunnerControls | null;
  /** Opens the delete context menu anchored on the row label (plan 0077
   *  item 6: "Delete instrument" / "Delete all lower difficulties"). */
  onRowContextMenu: (
    e: MouseEvent,
    instrument: SupportedTrackInstrument,
    hasLowerDifficulties: boolean,
  ) => void;
  /** Opens the delete context menu anchored on one cell (plan 0077 item 6:
   *  "Delete difficulty" / "Delete all lower difficulties" / "Delete
   *  instrument"). */
  onCellContextMenu: (
    e: MouseEvent,
    trackKey: SupportedTrackKey,
    hasLowerDifficulties: boolean,
  ) => void;
}

export default function ChartMatrixRow({
  instrument,
  trackData,
  visibleTrackKeys,
  provenance,
  onToggle,
  stale,
  generating,
  onGenerate,
  generateDisabledReason,
  runner,
  onRowContextMenu,
  onCellContextMenu,
}: ChartMatrixRowProps) {
  const tracksByDifficulty = new Map(
    trackData
      .filter(track => track.instrument === instrument)
      .map(track => [track.difficulty, track] as const),
  );
  const hasLowerDifficulties = LOWER_TRACK_DIFFICULTIES.some(d =>
    tracksByDifficulty.has(d),
  );
  const hasWholeLowerSet = LOWER_TRACK_DIFFICULTIES.every(d =>
    tracksByDifficulty.has(d),
  );
  // Under the cells: the amber staleness call-to-action, or (for a partial
  // set) the plain one. A row with the whole set and a fresh Expert has
  // neither.
  const showSetBar = hasLowerDifficulties && (stale || !hasWholeLowerSet);

  return (
    <>
      <div
        style={{gridColumn: 1}}
        onContextMenu={e =>
          onRowContextMenu(e, instrument, hasLowerDifficulties)
        }
        className="flex min-h-[1.875rem] items-center gap-1.5 text-xs font-semibold">
        <InstrumentIcon
          instrument={instrument}
          size={16}
          className="h-4 w-4 shrink-0"
        />
        {/* No truncation: the row spends its whole label column on the
         *  instrument name, so it always renders in full (plan 0076 item
         *  8). */}
        <span className="min-w-0 flex-1">{INSTRUMENT_LABEL[instrument]}</span>
      </div>

      {DIFFICULTY_COLUMNS.map((col, index) => {
        const track = tracksByDifficulty.get(col.difficulty);
        // No placeholder for an uncharted difficulty: every item in the
        // matrix carries an explicit `grid-column`, so an absent cell leaves
        // its column empty without pushing anything after it onto a new row
        // (which is what a spanning "Generate H · M · E" bar would otherwise
        // do to an Expert-only instrument).
        if (!track) return null;
        const trackKey: SupportedTrackKey = {
          instrument,
          difficulty: col.difficulty,
        };
        const visible = visibleTrackKeys.has(trackKeyId(trackKey));
        const locked = generating && col.difficulty !== 'expert';
        return (
          <ChartMatrixCell
            key={col.difficulty}
            name={`${INSTRUMENT_LABEL[instrument]} ${col.name}`}
            label={col.label}
            gridColumn={2 + index}
            visible={visible}
            locked={locked}
            tooltip={cellTooltip(
              instrument,
              col.difficulty,
              track,
              provenance,
              visible,
            )}
            onToggle={() => onToggle(trackKey)}
            onContextMenu={e =>
              onCellContextMenu(e, trackKey, hasLowerDifficulties)
            }
          />
        );
      })}

      {!hasLowerDifficulties && tracksByDifficulty.has('expert') && (
        <GenerateSetBar
          instrument={instrument}
          spansEmptyCells
          stale={false}
          disabledReason={generateDisabledReason}
          onGenerate={onGenerate}
          generating={generating}
          runner={runner}
        />
      )}

      {showSetBar && (
        <GenerateSetBar
          instrument={instrument}
          spansEmptyCells={false}
          stale={stale}
          disabledReason={generateDisabledReason}
          onGenerate={onGenerate}
          generating={generating}
          runner={runner}
        />
      )}
    </>
  );
}
