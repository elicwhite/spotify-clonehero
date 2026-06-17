/**
 * Default OG image for Music Charts Tools.
 *
 * Applies to every route under app/ that doesn't define its own
 * `opengraph-image.tsx`. Generated at request time via Next's
 * ImageResponse (no static asset to keep in sync), so the same file
 * also serves Twitter when paired with `twitter-image.tsx`.
 */
import {ImageResponse} from 'next/og';

export const alt = 'Music Charts Tools';
export const size = {width: 1200, height: 630};
export const contentType = 'image/png';

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background:
            'linear-gradient(135deg, #1a0a1f 0%, #2c0e36 50%, #0a0a14 100%)',
          color: 'white',
          fontFamily: 'system-ui, sans-serif',
          padding: '72px',
        }}>
        <div
          style={{
            display: 'flex',
            fontSize: 132,
            fontWeight: 800,
            letterSpacing: '-0.03em',
            textAlign: 'center',
            lineHeight: 1.05,
            marginBottom: 32,
          }}>
          Music Charts Tools
        </div>
        <div
          style={{
            display: 'flex',
            fontSize: 48,
            color: 'rgba(255,255,255,0.78)',
            textAlign: 'center',
            maxWidth: 1000,
            lineHeight: 1.25,
          }}>
          Find, view, and edit Clone Hero charts.
        </div>
        <div
          style={{
            display: 'flex',
            gap: 40,
            marginTop: 64,
            fontSize: 36,
            fontWeight: 600,
            color: 'rgba(255,255,255,0.85)',
          }}>
          <div style={{display: 'flex'}}>Find</div>
          <span style={{display: 'flex', opacity: 0.35}}>·</span>
          <div style={{display: 'flex'}}>View</div>
          <span style={{display: 'flex', opacity: 0.35}}>·</span>
          <div style={{display: 'flex'}}>Lyrics</div>
        </div>
      </div>
    ),
    size,
  );
}
