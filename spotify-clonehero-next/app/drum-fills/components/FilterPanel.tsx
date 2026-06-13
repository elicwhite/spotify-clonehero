'use client';

import {Input} from '@/components/ui/input';
import {Button} from '@/components/ui/button';
import {Slider} from '@/components/ui/slider';
import {cn} from '@/lib/utils';
import type {Subdivision} from '@/lib/local-db/drum-fills';
import {
  type LibraryFilters,
  type MasteryFilter,
  FULL_TEMPO_RANGE,
} from '@/lib/drum-fills/library/filterFills';

const SUBDIVISIONS: Subdivision[] = ['8ths', '16ths', 'triplets', 'mixed'];
const LENGTHS: {value: number; label: string}[] = [
  {value: 0.5, label: '½ bar'},
  {value: 1, label: '1 bar'},
  {value: 2, label: '2 bars'},
];
const MASTERY: {value: MasteryFilter; label: string}[] = [
  {value: 'unpracticed', label: 'New'},
  {value: 'learning', label: 'Learning'},
  {value: 'mastered', label: 'Mastered'},
];

function Toggle({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
        active
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border bg-background hover:bg-muted',
      )}>
      {children}
    </button>
  );
}

function toggleIn<T>(list: T[], value: T): T[] {
  return list.includes(value)
    ? list.filter(v => v !== value)
    : [...list, value];
}

export default function FilterPanel({
  filters,
  onChange,
  voicingTags,
  onReset,
  hasActive,
  resultCount,
  extras,
}: {
  filters: LibraryFilters;
  onChange: (next: LibraryFilters) => void;
  voicingTags: string[];
  onReset: () => void;
  hasActive: boolean;
  resultCount: number;
  /** View-level controls (grouped toggle, sort) rendered in the header row. */
  extras?: React.ReactNode;
}) {
  const set = (patch: Partial<LibraryFilters>) =>
    onChange({...filters, ...patch});

  return (
    <div className="flex flex-col gap-4 rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <Input
          name="fill-search"
          placeholder="Search song or artist…"
          value={filters.search}
          onChange={e => set({search: e.target.value})}
          className="max-w-xs"
        />
        <div className="flex items-center gap-2">
          {extras}
          <span className="text-sm text-muted-foreground">
            {resultCount} fill{resultCount === 1 ? '' : 's'}
          </span>
          {hasActive && (
            <Button size="sm" variant="ghost" onClick={onReset}>
              Clear
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <FilterGroup label="Subdivision">
          {SUBDIVISIONS.map(s => (
            <Toggle
              key={s}
              active={filters.subdivisions.includes(s)}
              onClick={() =>
                set({subdivisions: toggleIn(filters.subdivisions, s)})
              }>
              {s}
            </Toggle>
          ))}
        </FilterGroup>

        <FilterGroup label="Length">
          {LENGTHS.map(l => (
            <Toggle
              key={l.value}
              active={filters.lengthBars.includes(l.value)}
              onClick={() =>
                set({lengthBars: toggleIn(filters.lengthBars, l.value)})
              }>
              {l.label}
            </Toggle>
          ))}
        </FilterGroup>

        <FilterGroup label="Mastery">
          {MASTERY.map(m => (
            <Toggle
              key={m.value}
              active={filters.mastery.includes(m.value)}
              onClick={() =>
                set({mastery: toggleIn(filters.mastery, m.value)})
              }>
              {m.label}
            </Toggle>
          ))}
        </FilterGroup>

        {voicingTags.length > 0 && (
          <FilterGroup label="Voicing">
            {voicingTags.map(tag => (
              <Toggle
                key={tag}
                active={filters.voicingTags.includes(tag)}
                onClick={() =>
                  set({voicingTags: toggleIn(filters.voicingTags, tag)})
                }>
                {tag}
              </Toggle>
            ))}
          </FilterGroup>
        )}

        <FilterGroup
          label={`Complexity ${filters.minComplexity}–${filters.maxComplexity}`}>
          <Slider
            className="mt-2 w-48"
            min={1}
            max={5}
            step={1}
            value={[filters.minComplexity, filters.maxComplexity]}
            onValueChange={([min, max]) =>
              set({minComplexity: min, maxComplexity: max})
            }
          />
        </FilterGroup>

        <FilterGroup
          label={`Tempo ${filters.minTempo}–${filters.maxTempo} BPM`}>
          <Slider
            className="mt-2 w-48"
            min={FULL_TEMPO_RANGE[0]}
            max={FULL_TEMPO_RANGE[1]}
            step={5}
            value={[filters.minTempo, filters.maxTempo]}
            onValueChange={([min, max]) => set({minTempo: min, maxTempo: max})}
          />
        </FilterGroup>
      </div>
    </div>
  );
}

function FilterGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}
