import {ImageResponse} from 'next/og';

import {
  OgBrandRow,
  OgFrame,
  OgPanel,
  OgSubtitle,
  OgTitle,
} from '@/lib/og/layout';
import {OG_COLORS, OG_SIZE} from '@/lib/og/tokens';

export const alt = 'Spotify History Chart Finder';
export const size = OG_SIZE;
export const contentType = 'image/png';

// Public-domain compositions only — traditional folk + a classical
// piece. Modern hit covers across different eras make them feel
// recognizable rather than dusty.
const SAMPLE_HISTORY: ReadonlyArray<string> = [
  'Scarborough Fair',
  'Cotton Eye Joe',
  'Wayfaring Stranger',
  'Flight of the Bumblebee',
];

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <OgFrame>
        <OgBrandRow />
        <OgTitle style={{marginTop: 22, marginBottom: 28}}>
          Spotify History Charts
        </OgTitle>
        <OgSubtitle style={{maxWidth: 1040, marginBottom: 36}}>
          Find charts for every song you&rsquo;ve listened to on Spotify.
        </OgSubtitle>
        <OgPanel padding="28px 36px" style={{flexDirection: 'column', gap: 18}}>
          {SAMPLE_HISTORY.map(song => (
            <div
              key={song}
              style={{display: 'flex', alignItems: 'center', gap: 22}}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 40,
                  height: 40,
                  borderRadius: 20,
                  background: OG_COLORS.spotify,
                }}>
                <svg width="22" height="22" viewBox="0 0 14 14">
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
              <div style={{display: 'flex', fontSize: 38, fontWeight: 600}}>
                {song}
              </div>
            </div>
          ))}
        </OgPanel>
      </OgFrame>
    ),
    size,
  );
}
