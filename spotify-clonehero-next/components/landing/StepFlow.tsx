import type {LucideIcon} from 'lucide-react';

import {cn} from '@/lib/utils';

export interface FlowStepSpec {
  Icon: LucideIcon;
  /** What happens at this step, in the reader's vocabulary. */
  label: string;
  /** One sentence naming the mechanism. */
  desc: string;
}

/**
 * The four-step "what it does" diagram, in the family's identity: a mono step
 * index, an icon, the step name, and one sentence naming the mechanism.
 * Horizontal on wide screens, a stacked list on narrow ones. Same information
 * either way, so the connectors are decorative only.
 */
export function StepFlow({
  steps,
  className,
}: {
  steps: FlowStepSpec[];
  className?: string;
}) {
  return (
    <ol
      className={cn(
        'grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2 lg:grid-cols-4',
        className,
      )}>
      {steps.map(({Icon, label, desc}, i) => (
        <li key={label} className="flex flex-col gap-2 bg-card p-4">
          <div className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="font-mono text-[11px] tabular-nums tracking-[0.18em] text-muted-foreground">
              {String(i + 1).padStart(2, '0')}
            </span>
            <Icon
              aria-hidden="true"
              className="h-4 w-4 text-muted-foreground"
            />
          </div>
          <span className="text-sm font-medium text-foreground">{label}</span>
          <span className="text-sm leading-relaxed text-muted-foreground">
            {desc}
          </span>
        </li>
      ))}
    </ol>
  );
}
