import {cn} from '@/lib/utils';

/**
 * The mono label that sits above a heading. Mono is the family's
 * "measurement voice": labels, numbers, provenance, stage numbers.
 *
 * `as` exists for label positions that are not paragraphs — a definition
 * list's `dt` uses the same voice — so a page never re-types these metrics
 * to put the voice on a different element.
 */
export function Eyebrow({
  as: Tag = 'p',
  children,
  className,
  ...rest
}: React.ComponentPropsWithoutRef<'p'> & {
  as?: 'p' | 'dt' | 'span' | undefined;
}) {
  return (
    <Tag
      {...rest}
      className={cn(
        'font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground',
        className,
      )}>
      {children}
    </Tag>
  );
}
