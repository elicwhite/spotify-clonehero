import {cn} from '@/lib/utils';

/**
 * The plain-text trust facts under a hero: local execution, what gets
 * downloaded, what a page needs to run. Stated, not decorated: no badges, no
 * shield icons, no seals. Each item is one short factual sentence.
 */
export function TrustLine({
  items,
  className,
}: {
  items: React.ReactNode[];
  className?: string;
}) {
  return (
    <ul
      className={cn(
        'flex flex-col gap-x-6 gap-y-1.5 text-sm text-muted-foreground sm:flex-row sm:flex-wrap',
        className,
      )}>
      {items.map((item, i) => (
        <li
          key={i}
          className="flex items-start gap-2 sm:items-center [text-wrap:balance]">
          <span
            aria-hidden="true"
            className="mt-[0.45rem] h-px w-3 shrink-0 bg-border sm:mt-0"
          />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}
