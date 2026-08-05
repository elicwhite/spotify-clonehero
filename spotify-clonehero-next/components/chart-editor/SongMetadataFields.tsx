'use client';

/**
 * The form controls behind the song-details dialog.
 *
 * Three layers live here, all of them presentational — the value and its
 * conversion to a `ChartDocument` live in
 * `lib/chart-editor-core/songIniMetadata.ts`:
 *  - {@link SongMetadataFields} — song / artist / charter, also used by the
 *    export dialog.
 *  - {@link SongCatalogFields} and {@link DifficultyRow} — the rest of the
 *    `song.ini` surface this project authors.
 *  - {@link DifficultyRow}'s optional suggestion: the calculator's read of the
 *    chart, offered beside the field it describes. Every decision it makes
 *    comes from `resolveDifficultyRecommendation`; this file only renders it.
 */

import {Sparkles} from 'lucide-react';

import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {cn} from '@/lib/utils';
import {
  DIFFICULTY_MAX,
  DIFFICULTY_MIN,
  describeRecommendationFactors,
  type DifficultyExplanation,
  type DifficultyRecommendationState,
} from '@/lib/chart-difficulty';
import type {
  SongIniMetadataValue,
  SongMetadataValue,
} from '@/lib/chart-editor-core';

interface SongMetadataFieldsProps {
  value: SongMetadataValue;
  onChange: (value: SongMetadataValue) => void;
  /** Prefix for input ids so multiple instances stay unique. */
  idPrefix?: string;
}

/**
 * Three labeled inputs (Song / Artist / Charter) laid out on the chart-editor
 * dialog grid. Presentational only — the parent owns the value and persistence.
 */
export default function SongMetadataFields({
  value,
  onChange,
  idPrefix = 'metadata',
}: SongMetadataFieldsProps) {
  return (
    <>
      <div className="grid grid-cols-4 items-center gap-4">
        <Label htmlFor={`${idPrefix}-song`} className="text-right">
          Song
        </Label>
        <Input
          id={`${idPrefix}-song`}
          className="col-span-3"
          value={value.name}
          onChange={e => onChange({...value, name: e.target.value})}
          placeholder="Song title"
        />
      </div>
      <div className="grid grid-cols-4 items-center gap-4">
        <Label htmlFor={`${idPrefix}-artist`} className="text-right">
          Artist
        </Label>
        <Input
          id={`${idPrefix}-artist`}
          className="col-span-3"
          value={value.artist}
          onChange={e => onChange({...value, artist: e.target.value})}
          placeholder="Artist name"
        />
      </div>
      <div className="grid grid-cols-4 items-center gap-4">
        <Label htmlFor={`${idPrefix}-charter`} className="text-right">
          Charter
        </Label>
        <Input
          id={`${idPrefix}-charter`}
          className="col-span-3"
          value={value.charter}
          onChange={e => onChange({...value, charter: e.target.value})}
          placeholder="MusicCharts.tools"
        />
      </div>
    </>
  );
}

interface SongCatalogFieldsProps {
  value: SongIniMetadataValue;
  onChange: (value: SongIniMetadataValue) => void;
  idPrefix?: string;
}

/**
 * `song.ini`'s catalog fields: `album`, `genre`, `year`. All three are free
 * text in the format — `year` especially, since charts in the wild carry
 * anything from `2004` to `, 2004`, so this deliberately does not use a number
 * input.
 */
export function SongCatalogFields({
  value,
  onChange,
  idPrefix = 'metadata',
}: SongCatalogFieldsProps) {
  return (
    <>
      <div className="grid grid-cols-4 items-center gap-4">
        <Label htmlFor={`${idPrefix}-album`} className="text-right">
          Album
        </Label>
        <Input
          id={`${idPrefix}-album`}
          className="col-span-3"
          value={value.album}
          onChange={e => onChange({...value, album: e.target.value})}
          placeholder="Album name"
        />
      </div>
      <div className="grid grid-cols-4 items-center gap-4">
        <Label htmlFor={`${idPrefix}-genre`} className="text-right">
          Genre
        </Label>
        <Input
          id={`${idPrefix}-genre`}
          className="col-span-3"
          value={value.genre}
          onChange={e => onChange({...value, genre: e.target.value})}
          placeholder="Rock"
        />
      </div>
      <div className="grid grid-cols-4 items-center gap-4">
        <Label htmlFor={`${idPrefix}-year`} className="text-right">
          Year
        </Label>
        <Input
          id={`${idPrefix}-year`}
          className="col-span-3"
          value={value.year}
          onChange={e => onChange({...value, year: e.target.value})}
          placeholder="2004"
          inputMode="numeric"
        />
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Difficulty controls
// ---------------------------------------------------------------------------

/** The 0-6 intensities, plus the "not set" option that maps to `-1`. */
const DIFFICULTY_OPTIONS = Array.from(
  {length: DIFFICULTY_MAX - DIFFICULTY_MIN + 1},
  (_, index) => DIFFICULTY_MIN + index,
);

const UNSET_OPTION = 'unset';

interface DifficultySelectProps {
  id: string;
  value: number | null;
  onChange: (value: number | null) => void;
  'aria-label'?: string;
}

/** A 0-6 intensity picker with an explicit "Not set" option. */
export function DifficultySelect({
  id,
  value,
  onChange,
  'aria-label': ariaLabel,
}: DifficultySelectProps) {
  return (
    <Select
      value={value === null ? UNSET_OPTION : String(value)}
      onValueChange={next =>
        onChange(next === UNSET_OPTION ? null : Number(next))
      }>
      <SelectTrigger id={id} aria-label={ariaLabel} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={UNSET_OPTION}>Not set</SelectItem>
        {DIFFICULTY_OPTIONS.map(option => (
          <SelectItem key={option} value={String(option)}>
            {/* A string, not the number: the trigger mirrors this node, and
                intensity 0 renders as an empty trigger otherwise. */}
            {String(option)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Tailwind tone for a disagreement, scaled by how far apart the numbers are.
 *  One tier is ordinary charter noise; three is a different claim entirely. */
function severityTone(state: DifficultyRecommendationState): string {
  switch (state.severity) {
    case 'major':
      return 'border-red-500/50 bg-red-500/10 text-red-200';
    case 'moderate':
      return 'border-amber-500/50 bg-amber-500/10 text-amber-200';
    default:
      return 'border-border bg-muted/40 text-muted-foreground';
  }
}

/** The calculator's read of one instrument, as a difficulty row shows it. */
export interface DifficultySuggestion {
  /** Which of the five situations the field is in. */
  state: DifficultyRecommendationState;
  /** What drove the number, or `null` when there is nothing to explain. */
  explanation: DifficultyExplanation | null;
  /** Write the recommendation into the chart. */
  onApply: (value: number | null) => void;
}

interface DifficultyRowProps {
  id: string;
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  /** Present only for the instruments the calculators can rate. */
  suggestion?: DifficultySuggestion;
}

/**
 * One labeled intensity picker on the dialog's four-column grid, with the
 * calculator's suggestion beside it when there is one.
 *
 * The field always belongs to the charter: nothing here writes a value that
 * was not clicked. The suggestion rides alongside as a chip whose tone
 * escalates with the size of the disagreement, and the copy below it says what
 * the chip means and what drove it.
 */
export function DifficultyRow({
  id,
  label,
  value,
  onChange,
  suggestion,
}: DifficultyRowProps) {
  return (
    <div
      className={cn(
        'grid grid-cols-4 gap-4',
        suggestion ? 'items-start' : 'items-center',
      )}>
      <Label htmlFor={id} className={cn('text-right', suggestion && 'pt-2')}>
        {label}
      </Label>
      <div className="col-span-3 grid gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <div className={suggestion ? 'w-24' : 'w-full'}>
            <DifficultySelect id={id} value={value} onChange={onChange} />
          </div>
          {suggestion && <SuggestionChip {...suggestion} />}
        </div>
        {suggestion && <RecommendationCopy {...suggestion} />}
      </div>
    </div>
  );
}

/** The suggestion itself: a button, shown only when acting on it would change
 *  the field. A field already sitting on our number has nothing to offer, and
 *  the factor sentence below still names that number. */
function SuggestionChip({state, onApply}: DifficultySuggestion) {
  if (!state.canApply) return null;
  return (
    <button
      type="button"
      onClick={() => onApply(state.recommended)}
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors hover:brightness-125',
        state.status === 'stale'
          ? 'border-amber-500/50 bg-amber-500/10 text-amber-200'
          : severityTone(state),
      )}>
      <Sparkles className="h-3 w-3" />
      {state.status === 'stale'
        ? `Chart changed, now reads ${state.recommended}`
        : `Suggested: ${state.recommended}`}
    </button>
  );
}

/** What drove the suggestion: the factor sentence, and nothing else. It names
 *  the number itself, so a row needs no second line restating it. */
function RecommendationCopy({explanation}: DifficultySuggestion) {
  const factors = describeRecommendationFactors(explanation);
  if (!factors) return null;
  return <p className="text-[11px] text-muted-foreground">{factors}</p>;
}
