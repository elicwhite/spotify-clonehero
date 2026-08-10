import {ImageResponse} from 'next/og';

import {
  OgBrandRow,
  OgFrame,
  OgPanel,
  OgSubtitle,
  OgTitle,
} from '@/lib/og/layout';
import {OG_COLORS, OG_SIZE} from '@/lib/og/tokens';

export const alt = 'Spotify Chart Finder';
export const size = OG_SIZE;
export const contentType = 'image/png';

// Made-up, whimsical-feeling playlist names with realistic match
// counts. The 2000s rock one finds every song — illustrates the
// best-case outcome alongside two partial-match playlists.
const SAMPLE_PLAYLISTS: ReadonlyArray<readonly [string, number, number]> = [
  ['treadmill bangers', 38, 45],
  ['synth dreams', 27, 34],
  ['y2k rock forever', 50, 50],
];

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <OgFrame>
        <OgBrandRow />
        <OgTitle style={{marginTop: 22, marginBottom: 28}}>
          Spotify Chart Finder
        </OgTitle>
        <OgSubtitle style={{maxWidth: 1040, marginBottom: 48}}>
          Scan your Spotify playlists for Clone Hero charts.
        </OgSubtitle>
        <OgPanel padding="32px 40px" style={{flexDirection: 'column', gap: 22}}>
          {SAMPLE_PLAYLISTS.map(([playlist, found, total]) => (
            <div
              key={playlist}
              style={{display: 'flex', alignItems: 'center', gap: 24}}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 44,
                  height: 44,
                  borderRadius: 22,
                  background: OG_COLORS.spotify,
                }}>
                <svg width="26" height="26" viewBox="0 0 14 14">
                  <path
                    d="M3 7 L6 10 L11 4"
                    fill="none"
                    stroke={OG_COLORS.spotifyInk}
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
              <div
                style={{
                  display: 'flex',
                  fontSize: 40,
                  fontWeight: 600,
                  flex: 1,
                }}>
                {playlist}
              </div>
              <div
                style={{
                  display: 'flex',
                  fontSize: 36,
                  color: OG_COLORS.muted,
                }}>
                <span style={{color: OG_COLORS.text, fontWeight: 700}}>
                  {found}
                </span>
                <span style={{margin: '0 6px', opacity: 0.5}}>/</span>
                <span>{total}</span>
              </div>
            </div>
          ))}
        </OgPanel>
      </OgFrame>
    ),
    size,
  );
}
