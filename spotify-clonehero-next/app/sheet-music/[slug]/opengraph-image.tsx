import {ImageResponse} from 'next/og';
import {getMd5FromSlug} from '@/app/getMd5FromSlug';
import {searchAdvanced} from '@/lib/search-encore';

export const alt = 'Drum Sheet Music';
export const size = {width: 1200, height: 630};
export const contentType = 'image/png';

const BACKGROUND =
  'linear-gradient(135deg, #1a0a1f 0%, #2c0e36 50%, #0a0a14 100%)';

function fallback(label: string) {
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
          background: BACKGROUND,
          color: 'white',
          fontFamily: 'system-ui, sans-serif',
          padding: 80,
        }}>
        <div
          style={{
            display: 'flex',
            fontSize: 30,
            color: 'rgba(255,255,255,0.55)',
            letterSpacing: '0.22em',
            textTransform: 'uppercase',
            marginBottom: 22,
          }}>
          Drum Sheet Music
        </div>
        <div
          style={{
            display: 'flex',
            fontSize: 88,
            fontWeight: 800,
            letterSpacing: '-0.02em',
          }}>
          {label}
        </div>
      </div>
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
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          background: BACKGROUND,
          color: 'white',
          fontFamily: 'system-ui, sans-serif',
          padding: 70,
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
          <div
            style={{
              display: 'flex',
              fontSize: 28,
              color: 'rgba(255,255,255,0.55)',
              letterSpacing: '0.22em',
              textTransform: 'uppercase',
              marginBottom: 22,
            }}>
            Drum Sheet Music
          </div>
          <div
            style={{
              display: 'flex',
              fontSize: 80,
              fontWeight: 800,
              letterSpacing: '-0.02em',
              lineHeight: 1.05,
              marginBottom: 18,
            }}>
            {chart.name}
          </div>
          <div
            style={{
              display: 'flex',
              fontSize: 46,
              color: 'rgba(255,255,255,0.82)',
              marginBottom: 16,
            }}>
            {chart.artist}
          </div>
          <div
            style={{
              display: 'flex',
              fontSize: 32,
              color: 'rgba(255,255,255,0.55)',
            }}>
            Charted by {chart.charter}
          </div>
        </div>
      </div>
    ),
    size,
  );
}
