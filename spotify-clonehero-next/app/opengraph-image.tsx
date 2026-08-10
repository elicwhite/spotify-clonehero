/**
 * Default OG image for Music Charts Tools.
 *
 * Applies to every route under app/ that doesn't define its own
 * `opengraph-image.tsx`. Generated at request time via Next's
 * ImageResponse (no static asset to keep in sync).
 */
import {ImageResponse} from 'next/og';

import {OgFrame, OgSubtitle, OgTitle} from '@/lib/og/layout';
import {OG_COLORS, OG_SIZE} from '@/lib/og/tokens';

export const alt = 'Music Charts Tools';
export const size = OG_SIZE;
export const contentType = 'image/png';

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <OgFrame center>
        <OgTitle size="display" center style={{marginBottom: 32}}>
          Music Charts Tools
        </OgTitle>
        <OgSubtitle
          size="subtitleLarge"
          style={{textAlign: 'center', maxWidth: 1000, color: OG_COLORS.muted}}>
          Find, view, and edit Clone Hero charts.
        </OgSubtitle>
        <div
          style={{
            display: 'flex',
            gap: 40,
            marginTop: 64,
            fontSize: 36,
            fontWeight: 600,
            color: OG_COLORS.muted,
          }}>
          <div style={{display: 'flex'}}>Find</div>
          <span style={{display: 'flex', opacity: 0.35}}>·</span>
          <div style={{display: 'flex'}}>View</div>
          <span style={{display: 'flex', opacity: 0.35}}>·</span>
          <div style={{display: 'flex'}}>Lyrics</div>
        </div>
      </OgFrame>
    ),
    size,
  );
}
