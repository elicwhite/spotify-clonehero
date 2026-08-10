import {ImageResponse} from 'next/og';
import type {ReactNode} from 'react';

import {OgBrandRow, OgFrame, OgPanel, OgTitle} from './layout';
import {OG_SIZE} from './tokens';

/**
 * The standard tool card: brand row with a per-tool eyebrow, an inset title,
 * and a full-width panel holding the route's illustration. The route file
 * owns the copy and the illustration; the frame, palette, and type scale come
 * from `lib/og/tokens`.
 */
export function createToolOgImage({
  eyebrow,
  title,
  illustration,
}: {
  /** The per-tool label, right-aligned on the brand row. Literal caps. */
  eyebrow: string;
  title: string;
  illustration: ReactNode;
}) {
  return new ImageResponse(
    (
      <OgFrame>
        <OgBrandRow right={eyebrow} />
        <OgTitle size="titleInset" style={{marginTop: 26, marginBottom: 26}}>
          {title}
        </OgTitle>
        <OgPanel padding={16} style={{width: '100%', height: 300}}>
          {illustration}
        </OgPanel>
      </OgFrame>
    ),
    OG_SIZE,
  );
}
