import * as React from 'react';

import {cn} from '@/lib/utils';

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<'input'>>(
  ({className, type, ...props}, ref) => {
    return (
      <input
        type={type}
        // Height reads the editor-density token (`app/globals.css`) with the
        // standard 40px as its fallback.
        className={cn(
          'flex h-[var(--ed-control-h,2.5rem)] w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = 'Input';

export {Input};
