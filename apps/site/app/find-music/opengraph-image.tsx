import {ImageResponse} from 'next/og';

import {
  OgBrandRow,
  OgFrame,
  OgPanel,
  OgSubtitle,
  OgTitle,
} from '@/lib/og/layout';
import {OG_COLORS, OG_SIZE} from '@/lib/og/tokens';

export const alt = 'Find charts for the music you already listen to';
export const size = OG_SIZE;
export const contentType = 'image/png';

/** Wave marks from the Spotify icon, drawn over the brand-green circle. */
const SPOTIFY_WAVES =
  'M2137.6 2113.6c-26.3 43.2-82.6 56.7-125.6 30.4-344.1-210.3-777.3-257.8-1287.4-141.3-49.2 11.3-98.2-19.5-109.4-68.7-11.3-49.2 19.4-98.2 68.7-109.4C1242.1 1697.1 1721 1752 2107.3 1988c43 26.5 56.7 82.6 30.3 125.6zm179.3-398.9c-33.1 53.8-103.5 70.6-157.2 37.6-393.8-242.1-994.4-312.2-1460.3-170.8-60.4 18.3-124.2-15.8-142.6-76.1-18.2-60.4 15.9-124.1 76.2-142.5 532.2-161.5 1193.9-83.3 1646.2 194.7 53.8 33.1 70.8 103.4 37.7 157.1zm15.4-415.6c-472.4-280.5-1251.6-306.3-1702.6-169.5-72.4 22-149-18.9-170.9-91.3-21.9-72.4 18.9-149 91.4-171 517.7-157.1 1378.2-126.8 1922 196 65.1 38.7 86.5 122.8 47.9 187.8-38.5 65.2-122.8 86.7-187.8 48z';

/**
 * Glyph from the official Apple Music artwork in
 * `public/assets/apple-music/apple-music-icon-color.svg`, kept in its original
 * 73x73 artwork coordinates so it stays centered on the tile. The source file's
 * fills live in a `<style>` block, which Satori does not apply, so the tile
 * gradient is a CSS background here and the glyph carries an explicit fill.
 */
const APPLE_MUSIC_GLYPH =
  'M50.9,11c-0.17,0.02-1.72,0.29-1.91,0.33l-21.4,4.32l-0.01,0c-0.56,0.12-1,0.32-1.33,0.6c-0.41,0.34-0.63,0.83-0.72,1.39c-0.02,0.12-0.05,0.36-0.05,0.72c0,0,0,21.86,0,26.78c0,0.63-0.05,1.23-0.47,1.75c-0.42,0.52-0.95,0.67-1.56,0.8c-0.47,0.09-0.93,0.19-1.4,0.28c-1.77,0.36-2.92,0.6-3.96,1c-1,0.39-1.74,0.88-2.34,1.5c-1.18,1.23-1.66,2.91-1.49,4.48c0.14,1.34,0.74,2.62,1.78,3.56c0.7,0.64,1.57,1.13,2.6,1.33c1.07,0.21,2.2,0.14,3.86-0.2c0.88-0.18,1.71-0.46,2.5-0.92c0.78-0.46,1.45-1.07,1.97-1.82c0.52-0.75,0.86-1.58,1.05-2.47c0.19-0.91,0.24-1.74,0.24-2.65V28.56c0-1.24,0.35-1.57,1.36-1.82c0,0,17.79-3.59,18.62-3.75c1.16-0.22,1.7,0.11,1.7,1.32v15.86c0,0.63-0.01,1.26-0.43,1.78c-0.42,0.52-0.95,0.67-1.56,0.8c-0.47,0.09-0.93,0.19-1.4,0.28c-1.77,0.36-2.92,0.6-3.96,1c-1,0.39-1.74,0.88-2.34,1.5c-1.18,1.23-1.7,2.91-1.53,4.48c0.14,1.34,0.78,2.62,1.82,3.56c0.7,0.64,1.57,1.11,2.6,1.32c1.07,0.21,2.2,0.14,3.86-0.2c0.88-0.18,1.71-0.44,2.5-0.91c0.78-0.46,1.45-1.07,1.97-1.82c0.52-0.75,0.86-1.58,1.05-2.47c0.19-0.91,0.2-1.74,0.2-2.65V12.89C52.71,11.66,52.06,10.9,50.9,11z';

function SpotifyMark() {
  return (
    <div
      style={{
        display: 'flex',
        width: 48,
        height: 48,
        borderRadius: 24,
        background: OG_COLORS.spotify,
      }}>
      <svg width="48" height="48" viewBox="0 0 2931 2931">
        <path fill={OG_COLORS.spotifyInk} d={SPOTIFY_WAVES} />
      </svg>
    </div>
  );
}

function AppleMusicMark() {
  return (
    <div
      style={{
        display: 'flex',
        width: 48,
        height: 48,
        borderRadius: 11,
        background: 'linear-gradient(180deg, #fb5c74 0%, #fa233b 100%)',
      }}>
      <svg width="48" height="48" viewBox="0 0 73 73">
        <path fill="#ffffff" d={APPLE_MUSIC_GLYPH} />
      </svg>
    </div>
  );
}

function SongsFolderMark() {
  return (
    <div style={{display: 'flex', width: 48, height: 48}}>
      <svg width="48" height="48" viewBox="0 0 48 48">
        <path
          d="M4 12 h13 l5 6 h22 a3 3 0 0 1 3 3 v19 a3 3 0 0 1 -3 3 h-40 a3 3 0 0 1 -3 -3 v-25 a3 3 0 0 1 3 -3 z"
          fill="none"
          stroke={OG_COLORS.purple}
          strokeWidth="3"
        />
        <path
          d="M24 25 v11 m-5 -5 l5 5 l5 -5"
          fill="none"
          stroke={OG_COLORS.purple}
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

function SourceCard({
  mark,
  name,
  detail,
}: {
  mark: React.ReactNode;
  name: string;
  detail: string;
}) {
  return (
    <div
      style={{
        display: 'flex',
        flex: 1,
        alignItems: 'center',
        gap: 20,
        height: 126,
        padding: '0 30px',
        borderRadius: 16,
        border: `1px solid ${OG_COLORS.cardBorder}`,
        background: OG_COLORS.card,
      }}>
      {mark}
      <div style={{display: 'flex', flexDirection: 'column', gap: 6}}>
        <div style={{display: 'flex', fontSize: 25, color: OG_COLORS.text}}>
          {name}
        </div>
        <div style={{display: 'flex', fontSize: 19, color: OG_COLORS.subtle}}>
          {detail}
        </div>
      </div>
    </div>
  );
}

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <OgFrame>
        <OgBrandRow />
        <OgTitle size="titleCompact" style={{marginTop: 34, lineHeight: 1.1}}>
          <div style={{display: 'flex'}}>Find charts for the music</div>
          <div style={{display: 'flex'}}>you already listen to</div>
        </OgTitle>
        <OgSubtitle style={{marginTop: 22}}>
          Matched against Chorus and installed straight to your game.
        </OgSubtitle>
        <OgPanel style={{gap: 32, marginTop: 44}}>
          <SourceCard
            mark={<SpotifyMark />}
            name="Spotify"
            detail="Library and history"
          />
          <SourceCard
            mark={<AppleMusicMark />}
            name="Apple Music"
            detail="Saved songs"
          />
          <SourceCard
            mark={<SongsFolderMark />}
            name="Songs folder"
            detail="Installs charts directly"
          />
        </OgPanel>
      </OgFrame>
    ),
    size,
  );
}
