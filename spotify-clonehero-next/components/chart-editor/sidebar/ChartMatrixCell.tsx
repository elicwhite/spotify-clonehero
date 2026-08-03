'use client';

/**
 * One Chart Matrix cell (plan 0074 Phase 3, Design C): a charted track's
 * difficulty letter. The only interaction on the whole matrix lives here —
 * click toggles this track's visibility. Filled/accent = visible, neutral =
 * hidden. No focus concept, no note counts on the cell face; provenance
 * (note count, AI origin) rides the tooltip only.
 */

import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip';
import {cn} from '@/lib/utils';

export interface ChartMatrixCellProps {
  /** Accessible name, e.g. "Guitar Expert". */
  name: string;
  /** Difficulty letter rendered on the cell face (X/H/M/E). */
  label: string;
  /** 1-based matrix grid column (2 = Expert .. 5 = Easy). Every matrix item
   *  places itself explicitly, so an instrument missing a difficulty leaves
   *  a hole instead of shifting the rest of its row. */
  gridColumn: number;
  visible: boolean;
  tooltip: string;
  onToggle: () => void;
  /** True while this cell's instrument has a `generate-difficulties` run in
   *  flight (plan 0074 Phase 4): the cell keeps showing its current
   *  visibility but stops accepting clicks, so a mid-generation toggle can't
   *  race the command that's about to install/replace this track. */
  locked?: boolean | undefined;
}

export default function ChartMatrixCell({
  name,
  label,
  gridColumn,
  visible,
  tooltip,
  onToggle,
  locked = false,
}: ChartMatrixCellProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={name}
          aria-pressed={visible}
          disabled={locked}
          onClick={onToggle}
          style={{gridColumn}}
          className={cn(
            'flex min-h-[1.875rem] items-center justify-center rounded-md border text-xs font-bold transition-colors',
            visible
              ? 'border-primary bg-primary text-primary-foreground hover:bg-primary/90'
              : 'border-input bg-background text-muted-foreground hover:bg-muted',
            locked && 'opacity-50 cursor-not-allowed',
          )}>
          {label}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" className="whitespace-pre-line">
        {locked ? `${tooltip}\nGenerating...` : tooltip}
      </TooltipContent>
    </Tooltip>
  );
}
