/**
 * The `/storage` card. This route is a state readout rather than a tool, so it
 * has no illustration panel: the card is the page's own headline, composed
 * from the `lib/og/layout` primitives.
 */
import {ImageResponse} from 'next/og';

import {OgBrandRow, OgFrame, OgSubtitle, OgTitle} from '@/lib/og/layout';
import {OG_SIZE} from '@/lib/og/tokens';

export const alt = 'What this browser is holding for you';
export const size = OG_SIZE;
export const contentType = 'image/png';

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <OgFrame>
        <OgBrandRow right="STORAGE" />
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            flex: 1,
            justifyContent: 'center',
          }}>
          <OgTitle size="titleCompact" style={{maxWidth: 1000}}>
            What this browser is holding for you
          </OgTitle>
          <OgSubtitle style={{marginTop: 32, maxWidth: 900}}>
            Nothing leaves the browser, so the browser decides how long it
            stays. See what is stored, and free what costs nothing.
          </OgSubtitle>
        </div>
      </OgFrame>
    ),
    size,
  );
}
