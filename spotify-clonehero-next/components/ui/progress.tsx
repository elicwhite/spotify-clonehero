'use client';

import * as React from 'react';
import {cn} from '@/lib/utils';

interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Progress value from 0 to 100. */
  value?: number;
}

const Progress = React.forwardRef<HTMLDivElement, ProgressProps>(
  ({className, value = 0, ...props}, ref) => (
    <div
      ref={ref}
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn(
        'relative h-2 w-full overflow-hidden rounded-full bg-primary/20',
        className,
      )}
      {...props}>
      <div
        className="h-full bg-primary transition-all duration-300 ease-in-out"
        style={{width: `${Math.max(0, Math.min(100, value))}%`}}
      />
    </div>
  ),
);
Progress.displayName = 'Progress';

export {Progress};
export type {ProgressProps};
