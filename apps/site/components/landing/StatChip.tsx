'use client';

import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip';
import {cn} from '@/lib/utils';

/** Where a number came from. Every figure on a landing page carries one. */
export interface LandingProvenance {
  /** Repo-relative recompute script that produced the figure. */
  script: string;
  /** Dataset / model / split it was measured on. */
  measuredOn: string;
  /** ISO date it was last measured. */
  asOf: string;
  /** True until re-confirmed on the current pipeline. Renders a marker. */
  provisional?: boolean;
  note?: string;
}

export interface LandingMetric {
  /** Presentation-ready display string. */
  value: string;
  /** What the number is, in the reader's vocabulary. */
  label: string;
  prov: LandingProvenance;
}

/** The provenance panel both chip sizes show. */
function ProvenanceBody({prov}: {prov: LandingProvenance}) {
  return (
    <div className="space-y-1 text-xs">
      <div className="break-words font-mono text-[11px] leading-snug text-muted-foreground">
        {prov.script}
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
        <dt className="text-muted-foreground">measured on</dt>
        <dd>{prov.measuredOn}</dd>
        <dt className="text-muted-foreground">as of</dt>
        <dd className="font-mono tabular-nums">{prov.asOf}</dd>
      </dl>
      {prov.note ? (
        <p className="italic text-muted-foreground">{prov.note}</p>
      ) : null}
      {prov.provisional ? (
        <p className="font-medium text-foreground">
          provisional, not re-confirmed on the current pipeline
        </p>
      ) : null}
    </div>
  );
}

/**
 * The same figure at prose scale, for a number that belongs inside a
 * sentence's block rather than in a stat row. Carries the identical
 * provenance tooltip.
 */
export function InlineStat({
  metric,
  className,
}: {
  metric: LandingMetric;
  className?: string;
}) {
  const {value, label, prov} = metric;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          className={cn(
            'inline-flex cursor-help items-baseline gap-1.5 rounded-md border border-border bg-muted/60 px-2 py-0.5 text-xs',
            'transition-colors hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
            className,
          )}>
          <span className="font-mono font-semibold tabular-nums text-foreground">
            {value}
            {prov.provisional ? (
              <sup
                aria-label="provisional, not re-confirmed on the current pipeline"
                className="ml-0.5 text-foreground">
                °
              </sup>
            ) : null}
          </span>
          <span className="text-muted-foreground">{label}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        <ProvenanceBody prov={prov} />
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * The same figure sized for a table cell: the number alone, with the identical
 * provenance tooltip. The label lives in the row and column headers, so it is
 * read out to assistive technology through `aria-label` instead.
 */
export function StatCell({
  metric,
  className,
}: {
  metric: LandingMetric;
  className?: string;
}) {
  const {value, label, prov} = metric;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          aria-label={`${value}, ${label}`}
          className={cn(
            'inline-flex cursor-help items-baseline rounded-sm font-mono tabular-nums text-foreground',
            'underline decoration-dotted decoration-border underline-offset-4 hover:decoration-foreground',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
            className,
          )}>
          {value}
          {prov.provisional ? (
            <sup aria-hidden="true" className="ml-0.5 text-muted-foreground">
              °
            </sup>
          ) : null}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        <ProvenanceBody prov={prov} />
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * A measured figure rendered as a chip, with its provenance behind a tooltip
 * and a visible marker when the figure is provisional. The house standard for
 * putting a number on a page: no number ships without its source reachable
 * from the number itself.
 *
 * Requires a TooltipProvider ancestor (the page supplies one).
 */
export function StatChip({
  metric,
  className,
}: {
  metric: LandingMetric;
  className?: string;
}) {
  const {value, label, prov} = metric;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          className={cn(
            'flex cursor-help flex-col gap-1 rounded-lg border border-border bg-card p-4 text-left',
            'transition-colors hover:bg-muted/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
            className,
          )}>
          <span className="font-mono text-2xl font-semibold tabular-nums tracking-tight text-foreground">
            {value}
            {prov.provisional ? (
              <sup
                aria-label="provisional, not re-confirmed on the current pipeline"
                className="ml-0.5 text-foreground">
                °
              </sup>
            ) : null}
          </span>
          <span className="text-sm leading-snug text-muted-foreground">
            {label}
          </span>
          {prov.provisional ? (
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-foreground">
              provisional
            </span>
          ) : null}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        <ProvenanceBody prov={prov} />
      </TooltipContent>
    </Tooltip>
  );
}
