import * as React from 'react';
import {Slot} from '@radix-ui/react-slot';
import {cva, type VariantProps} from 'class-variance-authority';

import {cn} from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        destructive:
          'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        outline:
          'border border-input bg-background hover:bg-accent hover:text-accent-foreground',
        secondary:
          'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      // Heights read the editor-density token with their standard value as
      // the fallback, so a button is 40/36/40px everywhere and 28px inside
      // the editor's `data-density="compact"` scope (`app/globals.css`).
      // `lg` keeps a fixed height: it is a page-level call to action, not a
      // dense editor control. A caller passing its own `h-*` still wins via
      // tailwind-merge.
      //
      // `xs` is the one step below `sm`, for a dense row of secondary
      // actions (assist card action rows). It is the only size that also
      // drops the text and icon scale — 14px type in a 24px button is what
      // made every call site override `[&_svg]` by hand.
      size: {
        default: 'h-[var(--ed-control-h,2.5rem)] px-4 py-2',
        sm: 'h-[var(--ed-control-h,2.25rem)] rounded-md px-3',
        xs: 'h-[var(--ed-control-h-sm,1.75rem)] gap-1.5 rounded-md px-2 text-[11.5px] [&_svg]:size-3',
        lg: 'h-11 rounded-md px-8',
        icon: 'h-[var(--ed-control-h,2.5rem)] w-[var(--ed-control-h,2.5rem)]',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({className, variant, size, asChild = false, ...props}, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        className={cn(buttonVariants({variant, size, className}))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = 'Button';

export {Button, buttonVariants};
