import {cn} from '@/lib/utils';

/**
 * The mono label that sits above a heading. Mono is the family's
 * "measurement voice": labels, numbers, provenance, stage numbers.
 */
export function Eyebrow({
  children,
  className,
  ...rest
}: React.ComponentPropsWithoutRef<'p'>) {
  return (
    <p
      {...rest}
      className={cn(
        'font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground',
        className,
      )}>
      {children}
    </p>
  );
}
