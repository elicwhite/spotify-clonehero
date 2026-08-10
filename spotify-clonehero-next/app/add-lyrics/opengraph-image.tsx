import {ImageResponse} from 'next/og';

import {
  OgBrandRow,
  OgFrame,
  OgPanel,
  OgSubtitle,
  OgTitle,
} from '@/lib/og/layout';
import {OG_COLORS, OG_SIZE} from '@/lib/og/tokens';

export const alt = 'Add Lyrics to Charts';
export const size = OG_SIZE;
export const contentType = 'image/png';

// Public-domain example: opening of "The Wellerman" (traditional sea
// shanty). One multi-syllable word ("Wellerman") split across three
// cells shows the syllable-level granularity at a glance.
const SAMPLE_SYLLABLES: ReadonlyArray<readonly [string, string]> = [
  ['Soon', '0:02.10'],
  ['may', '0:02.45'],
  ['the', '0:02.78'],
  ['Wel', '0:03.12'],
  ['ler', '0:03.42'],
  ['man', '0:03.74'],
];

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <OgFrame>
        <OgBrandRow />
        <OgTitle style={{marginTop: 22, marginBottom: 28}}>
          Add Lyrics to Charts
        </OgTitle>
        <OgSubtitle style={{maxWidth: 1040, marginBottom: 48}}>
          Paste lyrics — auto-synced to any chart, syllable by syllable.
        </OgSubtitle>
        <OgPanel padding="32px 44px" style={{gap: 36}}>
          {SAMPLE_SYLLABLES.map(([syl, time]) => (
            <div
              key={syl + time}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
              }}>
              <div style={{display: 'flex', fontSize: 64, fontWeight: 600}}>
                {syl}
              </div>
              <div
                style={{
                  display: 'flex',
                  fontSize: 28,
                  color: OG_COLORS.muted,
                  fontFamily: 'monospace',
                  marginTop: 10,
                }}>
                {time}
              </div>
            </div>
          ))}
        </OgPanel>
      </OgFrame>
    ),
    size,
  );
}
