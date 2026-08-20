import {cn} from '@/lib/utils';

/**
 * One body paragraph inside a `LandingSection`, at the same measure and ramp
 * as the section intro (`text-sm sm:text-base`), so body prose never renders
 * a step smaller than the intro sitting above it.
 *
 * That mismatch is why this exists: the class was hand-copied into three
 * landing layouts and two of the copies silently dropped `sm:text-base`.
 */
export function LandingProse({
  className,
  children,
  ...rest
}: React.ComponentPropsWithoutRef<'p'>) {
  return (
    <p
      {...rest}
      className={cn(
        'max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base',
        className,
      )}>
      {children}
    </p>
  );
}
