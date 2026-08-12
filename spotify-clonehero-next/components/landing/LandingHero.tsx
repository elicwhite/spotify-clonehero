import type {ReactNode} from 'react';

import {Eyebrow} from './Eyebrow';
import {TrustLine} from './TrustLine';

/**
 * The first screenful of a tool landing page: what the tool is called, what
 * it does, what is true about running it, and a picture of the thing it
 * produces.
 *
 * The order is the style guide's, not a layout preference. The lede sells the
 * purpose rather than the mechanism (§2), and the trust facts sit directly
 * under it because the not-one-shot statement and the download size have to
 * land in the first screenful (§4, §7) rather than in an FAQ.
 *
 * `title` is a `ReactNode` because titles carry typography that is content:
 * `/drum-transcription` sets a non-breaking hyphen so "first-pass" cannot
 * split across lines at the display size.
 *
 * `trust` is optional. A tool page states its trust facts in the first
 * screenful because §4 and §7 require it, but not every page in this shell is
 * a tool page — `/why` is a position piece with nothing to claim — and making
 * the slot mandatory is what pushed that page into forking the hero instead
 * of using it.
 */
export function LandingHero({
  eyebrow,
  title,
  lede,
  trust,
  illustration,
  caption,
}: {
  eyebrow: ReactNode;
  title: ReactNode;
  lede: ReactNode;
  /** The plain trust facts, one short factual sentence each. */
  trust?: ReactNode[];
  /** The hero canvas. Page-owned content; the hero only gives it a slot. */
  illustration?: ReactNode;
  /** Mono caption explaining what the illustration shows. */
  caption?: ReactNode;
}) {
  return (
    <header className="space-y-6">
      <Eyebrow>{eyebrow}</Eyebrow>
      <h1 className="max-w-3xl text-3xl font-semibold tracking-tight sm:text-5xl [text-wrap:balance]">
        {title}
      </h1>
      <p className="max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
        {lede}
      </p>
      {trust && trust.length > 0 ? <TrustLine items={trust} /> : null}
      {illustration}
      {caption ? (
        <p className="font-mono text-[11px] leading-relaxed text-muted-foreground">
          {caption}
        </p>
      ) : null}
    </header>
  );
}
