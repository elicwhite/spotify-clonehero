import {ImageResponse} from 'next/og';

import {OgBrandRow, OgFrame, OgSubtitle, OgTitle} from '@/lib/og/layout';
import {OG_COLORS, OG_SIZE} from '@/lib/og/tokens';

export const alt = 'SNG File Manager';
export const size = OG_SIZE;
export const contentType = 'image/png';

// The files that typically make up a Clone Hero package.
const PACKAGE_FILES = ['notes.chart', 'song.opus', 'album.png'];

const square = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 168,
  height: 168,
  fontSize: 46,
  fontWeight: 700,
  fontFamily: 'monospace',
  color: OG_COLORS.text,
  background: OG_COLORS.panel,
  border: `1px solid ${OG_COLORS.panelBorder}`,
  borderRadius: 22,
} as const;

const arrow = {
  display: 'flex',
  flexShrink: 0,
  fontSize: 56,
  color: OG_COLORS.subtle,
} as const;

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <OgFrame>
        <OgBrandRow />
        <OgTitle style={{marginTop: 18, marginBottom: 18}}>
          SNG File Manager
        </OgTitle>
        <OgSubtitle style={{maxWidth: 1000, marginBottom: 44}}>
          Create, inspect, and convert Clone Hero .sng packages.
        </OgSubtitle>

        {/* .sng → its files → .sng / .zip */}
        <div
          style={{
            display: 'flex',
            flexShrink: 0,
            alignItems: 'center',
            gap: 24,
          }}>
          <div style={square}>.sng</div>

          <div style={arrow}>→</div>

          {/* the files inside the package, each in its own rectangle */}
          <div style={{display: 'flex', flexDirection: 'column', gap: 12}}>
            {PACKAGE_FILES.map(name => (
              <div
                key={name}
                style={{
                  display: 'flex',
                  fontSize: 26,
                  fontFamily: 'monospace',
                  color: OG_COLORS.muted,
                  background: OG_COLORS.panel,
                  border: `1px solid ${OG_COLORS.panelBorder}`,
                  borderRadius: 12,
                  padding: '10px 20px',
                }}>
                {name}
              </div>
            ))}
          </div>

          <div style={arrow}>→</div>

          <div style={{display: 'flex', gap: 22}}>
            <div style={square}>.sng</div>
            <div style={square}>.zip</div>
          </div>
        </div>
      </OgFrame>
    ),
    size,
  );
}
