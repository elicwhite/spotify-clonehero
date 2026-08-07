import {cn} from '@/lib/utils';

import {Eyebrow} from './Eyebrow';

/**
 * One section of a tool landing page: a title above a hairline rule, then the
 * section body. Pages whose sections form an ordered sequence can pass a mono
 * `index`; it is decorative, so it is hidden from assistive tech and the
 * heading carries the meaning.
 */
export function LandingSection({
  id,
  index,
  title,
  intro,
  children,
  className,
}: {
  id?: string;
  /** Optional two-digit section index, e.g. "02", for pages with an order. */
  index?: string;
  title: string;
  intro?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      id={id}
      className={cn('scroll-mt-16 border-t border-border pt-8', className)}>
      <div className="flex items-baseline gap-3">
        {index !== undefined ? (
          <Eyebrow aria-hidden="true" className="tabular-nums">
            {index}
          </Eyebrow>
        ) : null}
        <h2 className="text-xl font-semibold tracking-tight sm:text-2xl [text-wrap:balance]">
          {title}
        </h2>
      </div>
      {intro ? (
        <div className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
          {intro}
        </div>
      ) : null}
      <div className="mt-6">{children}</div>
    </section>
  );
}
