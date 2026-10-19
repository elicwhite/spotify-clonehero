/**
 * The `/why` card. This route is a position rather than a tool, so it has no
 * illustration panel: the card is the page's own headline, composed from the
 * `lib/og/layout` primitives with every color and size from `lib/og/tokens`.
 */
import {ImageResponse} from 'next/og';

import {OgBrandRow, OgFrame, OgSubtitle, OgTitle} from '@/lib/og/layout';
import {OG_SIZE} from '@/lib/og/tokens';

export const alt =
  'I want the songs people love to be playable, and charted well';
export const size = OG_SIZE;
export const contentType = 'image/png';

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <OgFrame>
        <OgBrandRow right="WHY I BUILD THESE" />
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            flex: 1,
            justifyContent: 'center',
          }}>
          <OgTitle size="titleCompact" style={{maxWidth: 1000}}>
            I want the songs people love to be playable, and charted well
          </OgTitle>
          <OgSubtitle style={{marginTop: 32, maxWidth: 900}}>
            More charts for the songs people want to play, at the bar this
            community already holds.
          </OgSubtitle>
        </div>
      </OgFrame>
    ),
    size,
  );
}
