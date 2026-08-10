import {ImageResponse} from 'next/og';
import {getMd5FromSlug} from '@/app/getMd5FromSlug';
import {searchAdvanced} from '@/lib/search-encore';

import {OgEyebrow, OgFrame, OgTitle} from '@/lib/og/layout';
import {OG_COLORS, OG_SIZE} from '@/lib/og/tokens';

export const alt = 'Drum Sheet Music';
export const size = OG_SIZE;
export const contentType = 'image/png';

/**
 * This card names the section rather than the site: it is one chart's page,
 * so the label that earns the top line is what the reader is looking at.
 */
function SheetMusicEyebrow() {
  return <OgEyebrow style={{marginBottom: 22}}>DRUM SHEET MUSIC</OgEyebrow>;
}

function fallback(label: string) {
  return new ImageResponse(
    (
      <OgFrame center>
        <SheetMusicEyebrow />
        <OgTitle center>{label}</OgTitle>
      </OgFrame>
    ),
    size,
  );
}

export default async function OpengraphImage({
  params,
}: {
  params: Promise<{slug: string}>;
}) {
  const {slug} = await params;
  const md5 = getMd5FromSlug(slug);
  if (!md5) return fallback('Invalid chart');

  const response = await searchAdvanced({hash: md5});
  const chart = response.data[0];
  if (!chart) return fallback('Chart not found');

  const albumArt = `https://files.enchor.us/${chart.albumArtMd5}.jpg`;

  return new ImageResponse(
    (
      <OgFrame>
        <div
          style={{
            display: 'flex',
            flex: 1,
            alignItems: 'center',
            gap: 56,
          }}>
          <img
            src={albumArt}
            alt="Album art"
            width={420}
            height={420}
            style={{borderRadius: 20, objectFit: 'cover'}}
          />
          <div style={{display: 'flex', flexDirection: 'column', flex: 1}}>
            <SheetMusicEyebrow />
            <OgTitle size="titleCompact" style={{marginBottom: 18}}>
              {chart.name}
            </OgTitle>
            <div
              style={{
                display: 'flex',
                fontSize: 46,
                color: OG_COLORS.muted,
                marginBottom: 16,
              }}>
              {chart.artist}
            </div>
            <div
              style={{
                display: 'flex',
                fontSize: 32,
                color: OG_COLORS.subtle,
              }}>
              Charted by {chart.charter}
            </div>
          </div>
        </div>
      </OgFrame>
    ),
    size,
  );
}
