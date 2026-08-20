import type {ReactNode} from 'react';

import {cn} from '@/lib/utils';

/**
 * The destructive callout box: a rounded panel on the destructive tint, for a
 * failure that needs more than one line — a title, the message, and usually a
 * recovery action. The container string had three authors (the difficulty
 * entry banner and both save-failed panels) before this owned it.
 *
 * A one-line supplementary error stays a plain `text-destructive` paragraph;
 * this is the treatment for a failure that is the screen's current subject.
 */
export function DestructiveNotice({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        'rounded-lg border border-destructive/40 bg-destructive/10 p-4',
        className,
      )}>
      {children}
    </div>
  );
}
