'use client';

import type {ReactNode} from 'react';

import {formatBytes} from '@/lib/sng/file-utils';

/**
 * One stored thing: what it is, how much room it takes, and what can be done
 * with it.
 *
 * The size and the actions sit on the same row because that is the judgement
 * the page exists to support — this one is large, and here is the button. A
 * size in one place and a button somewhere else is what made the first version
 * of this page a report rather than something you could act on.
 */
export function StorageRow({
  title,
  detail,
  sizeBytes,
  actions,
}: {
  title: ReactNode;
  detail?: ReactNode;
  /** Omitted for an empty state, which has no size worth printing. */
  sizeBytes?: number;
  actions?: ReactNode;
}) {
  return (
    <li className="flex flex-wrap items-baseline gap-x-4 gap-y-2 border-t border-border py-3 first:border-t-0">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-foreground">{title}</p>
        {detail ? (
          <p className="truncate text-xs text-foreground/60">{detail}</p>
        ) : null}
      </div>
      {sizeBytes === undefined ? null : (
        <span className="font-mono text-sm text-foreground/80">
          {formatBytes(sizeBytes)}
        </span>
      )}
      {actions ? <span className="flex gap-2">{actions}</span> : null}
    </li>
  );
}

/** The heading over a group of rows, with what the group totals. */
export function StorageGroup({
  title,
  note,
  totalBytes,
  children,
}: {
  title: string;
  note: ReactNode;
  totalBytes: number;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4">
        <h3 className="text-base font-medium text-foreground">{title}</h3>
        <span className="font-mono text-sm text-foreground/80">
          {formatBytes(totalBytes)}
        </span>
      </div>
      <p className="max-w-2xl text-sm text-foreground/70">{note}</p>
      <ul>{children}</ul>
    </section>
  );
}
