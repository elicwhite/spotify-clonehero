import type {ReactNode} from 'react';

import {cn} from '@/lib/utils';

/**
 * The hairline card grid: cells on `bg-card` separated by 1px of the border
 * color showing through `gap-px`, the family's way of laying equal-weight
 * cards side by side (`StepFlow`, `/drum-transcription`'s "What you'll fix",
 * `/why`'s who-this-helps grid).
 *
 * The container string had three authors before this file owned it. Column
 * behavior is the caller's (`columns` takes the responsive `grid-cols-*`
 * classes), because how many cells fit a row is content knowledge.
 */
export function CardGrid({
  as: Tag = 'ul',
  columns,
  className,
  children,
}: {
  /** The list element to render; ordered content uses `'ol'`. */
  as?: 'ul' | 'ol' | undefined;
  /** Responsive column classes, e.g. `'sm:grid-cols-2 lg:grid-cols-4'`. */
  columns?: string | undefined;
  className?: string | undefined;
  children: ReactNode;
}) {
  return (
    <Tag
      className={cn(
        'grid gap-px overflow-hidden rounded-lg border border-border bg-border',
        columns,
        className,
      )}>
      {children}
    </Tag>
  );
}

/**
 * One cell of a `CardGrid`. The default padding is the prose-card density
 * (`p-5`); `StepFlow` overrides to `gap-2 p-4` because its cells are diagram
 * steps, not prose cards — that is the one documented denser variant.
 */
export function CardGridCell({
  className,
  children,
}: {
  className?: string | undefined;
  children: ReactNode;
}) {
  return (
    <li className={cn('flex flex-col gap-3 bg-card p-5', className)}>
      {children}
    </li>
  );
}
