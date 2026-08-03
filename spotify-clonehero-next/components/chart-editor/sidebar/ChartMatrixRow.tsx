'use client';

/**
 * One Chart Matrix row (plan 0074 Phase 3, Design C): an instrument's
 * charted difficulties as toggle cells, or — when only Expert is charted —
 * a single "Generate H · M · E" affordance spanning the H/M/E columns.
 *
 * The generate affordance and the per-instrument overflow menu's "Delete
 * H · M · E difficulties" both render disabled this phase: difficulty
 * generation is Phase 4 work, but the plan ships the affordance placement
 * now so the layout doesn't shift later. Each carries copy naming that
 * reason, reachable by hover (tooltip) and by screen reader (an `sr-only`
 * span the control's `aria-describedby` points at).
 */

import {Drum, Guitar, MoreHorizontal, Sparkles} from 'lucide-react';
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip';
import type {Difficulty, ParsedTrackData, TrackKey} from '@/lib/chart-edit';
import type {AssistProvenance} from '@/lib/chart-editor-core';
import type {SupportedTrackInstrument} from '@/lib/chart-editor-core';
import ChartMatrixCell from './ChartMatrixCell';
import {trackKeyId} from '../scope';
import {
  DIFFICULTY_COLUMNS,
  INSTRUMENT_LABEL,
  difficultyName,
} from '../trackLabels';

// lucide-react has no dedicated bass icon; the label text is what tells
// Guitar and Bass rows apart, so bass reuses the guitar glyph.
const INSTRUMENT_ICON: Record<SupportedTrackInstrument, React.ElementType> = {
  guitar: Guitar,
  bass: Guitar,
  drums: Drum,
};

/** Shared copy for every disabled Phase-4 affordance on the matrix. */
export const GENERATION_DEFERRED_REASON =
  'Difficulty generation arrives with the next update.';

/** Copy for the disabled per-instrument overflow affordance. */
const DELETE_DIFFICULTIES_LABEL = 'Delete Hard, Medium, and Easy difficulties';

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
    ? instrument === 'drums' && provenance?.drumTranscription !== undefined
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
}

export default function ChartMatrixRow({
  instrument,
  trackData,
  visibleTrackKeys,
  provenance,
  onToggle,
}: ChartMatrixRowProps) {
  const Icon = INSTRUMENT_ICON[instrument];
  const tracksByDifficulty = new Map(
    trackData
      .filter(track => track.instrument === instrument)
      .map(track => [track.difficulty, track] as const),
  );
  const hasLowerDifficulties = ['hard', 'medium', 'easy'].some(d =>
    tracksByDifficulty.has(d as Difficulty),
  );

  return (
    <>
      <div
        style={{gridColumn: 1}}
        className="flex min-h-[1.875rem] items-center gap-1.5 text-xs font-semibold">
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate">
          {INSTRUMENT_LABEL[instrument]}
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            {/* `aria-disabled` rather than `disabled`: a disabled button is
             *  not focusable, and a keyboard-only sighted user has to reach
             *  this to surface the reason via the tooltip, which opens only
             *  on hover or focus. */}
            <button
              type="button"
              aria-label={`${INSTRUMENT_LABEL[instrument]} options`}
              aria-disabled="true"
              aria-describedby={`overflow-reason-${instrument}`}
              className="flex h-4 w-4 shrink-0 cursor-default items-center justify-center rounded text-muted-foreground/60">
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">
            {DELETE_DIFFICULTIES_LABEL}: {GENERATION_DEFERRED_REASON}
          </TooltipContent>
        </Tooltip>
        <span id={`overflow-reason-${instrument}`} className="sr-only">
          {DELETE_DIFFICULTIES_LABEL}: {GENERATION_DEFERRED_REASON}
        </span>
      </div>

      {DIFFICULTY_COLUMNS.map((col, index) => {
        const track = tracksByDifficulty.get(col.difficulty);
        // No placeholder for an uncharted difficulty: every item in the
        // matrix carries an explicit `grid-column`, so an absent cell leaves
        // its column empty without pushing anything after it onto a new row
        // (which is what a spanning "Generate H · M · E" bar would otherwise
        // do to an Expert-only instrument).
        if (!track) return null;
        const trackKey: TrackKey = {instrument, difficulty: col.difficulty};
        const visible = visibleTrackKeys.has(trackKeyId(trackKey));
        return (
          <ChartMatrixCell
            key={col.difficulty}
            name={`${INSTRUMENT_LABEL[instrument]} ${col.name}`}
            label={col.label}
            gridColumn={2 + index}
            visible={visible}
            tooltip={cellTooltip(
              instrument,
              col.difficulty,
              track,
              provenance,
              visible,
            )}
            onToggle={() => onToggle(trackKey)}
          />
        );
      })}

      {!hasLowerDifficulties && tracksByDifficulty.has('expert') && (
        <div style={{gridColumn: '3 / 6'}}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-disabled="true"
                aria-describedby={`gen-reason-${instrument}`}
                aria-label={`Generate ${INSTRUMENT_LABEL[instrument]} Hard, Medium, Easy difficulties`}
                className="flex min-h-[1.875rem] w-full cursor-default items-center justify-center gap-1.5 rounded-md border border-dashed text-[11px] font-medium text-muted-foreground/60">
                <Sparkles className="h-3 w-3" />
                Generate H · M · E
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">
              {GENERATION_DEFERRED_REASON}
            </TooltipContent>
          </Tooltip>
          {/* Same reason, always in the DOM: the tooltip is the sighted-hover
           *  route, this is the route for screen readers and for tests that
           *  don't simulate a hover. */}
          <span id={`gen-reason-${instrument}`} className="sr-only">
            {GENERATION_DEFERRED_REASON}
          </span>
        </div>
      )}
    </>
  );
}
