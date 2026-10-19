import type {ReactNode} from 'react';

import {cn} from '@/lib/utils';

import {Eyebrow} from './Eyebrow';

/**
 * A two-column feature row: what one tool or one step does, beside a picture
 * of what it produces.
 *
 * `LandingSection` is single-column by construction, which is right for a
 * tool page where the illustration is the hero's and every section below it
 * is prose, a step flow, or a table. The cohort pages (`/` and `/chart`) are
 * the other shape: each row is one offering, and the picture carries as much
 * of the claim as the sentence does, so the two sit side by side.
 *
 * It renders the same `border-t` rule and `h2` as `LandingSection`, so a page
 * can mix the two without a seam.
 *
 * `flip` puts the illustration first at desktop width. Alternating sides down
 * a page is what keeps a run of bands from reading as a table; it is
 * decorative, so on small screens every band stacks copy-then-picture and the
 * flip is ignored.
 */
export function FeatureBand({
  eyebrow,
  title,
  children,
  actions,
  illustration,
  flip = false,
  className,
}: {
  /** Optional mono label above the heading, e.g. a step name. */
  eyebrow?: ReactNode;
  title: ReactNode;
  /** The body copy. */
  children: ReactNode;
  /** Links or buttons under the copy. */
  actions?: ReactNode;
  /** Page-owned illustration of what this band's tool produces. */
  illustration: ReactNode;
  /** Draw the illustration on the left at desktop width. */
  flip?: boolean;
  className?: string;
}) {
  return (
    <section
      className={cn('scroll-mt-16 border-t border-border pt-8', className)}>
      <div className="grid items-center gap-6 md:grid-cols-2 md:gap-10">
        <div className={cn(flip && 'md:order-2')}>
          {eyebrow !== undefined ? <Eyebrow>{eyebrow}</Eyebrow> : null}
          <h2
            className={cn(
              'text-xl font-semibold tracking-tight sm:text-2xl [text-wrap:balance]',
              eyebrow !== undefined && 'mt-3',
            )}>
            {title}
          </h2>
          <div className="mt-3 space-y-3 text-sm leading-relaxed text-muted-foreground sm:text-base">
            {children}
          </div>
          {actions ? (
            <div className="mt-5 flex flex-wrap items-center gap-3">
              {actions}
            </div>
          ) : null}
        </div>
        <div className={cn('min-w-0', flip && 'md:order-1')}>
          {illustration}
        </div>
      </div>
    </section>
  );
}
