import {cn} from '@/lib/utils';

/**
 * The plain-text trust facts under a hero: local execution, what gets
 * downloaded, what a page needs to run. Stated, not decorated: no badges, no
 * shield icons, no seals. Each item is one short factual sentence.
 *
 * One fact per line, at every width. These used to wrap into rows at `sm`,
 * which packed two or three facts onto one line and read as a feature strip —
 * the decorated treatment §7 exists to prevent. A stacked list also keeps the
 * dash of each fact in the same column, so the reader can see how many claims
 * a page is making without parsing the sentences.
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
        'flex flex-col gap-y-1.5 text-sm text-muted-foreground',
        className,
      )}>
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-2">
          <span
            aria-hidden="true"
            className="mt-[0.45rem] h-px w-3 shrink-0 bg-border"
          />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}
