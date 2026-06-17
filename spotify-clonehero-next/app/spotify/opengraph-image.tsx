import {ImageResponse} from 'next/og';

export const alt = 'Spotify Chart Finder';
export const size = {width: 1200, height: 630};
export const contentType = 'image/png';

const SPOTIFY_GREEN = '#1DB954';

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
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          background:
            'linear-gradient(135deg, #1a0a1f 0%, #2c0e36 50%, #0a0a14 100%)',
          color: 'white',
          fontFamily: 'system-ui, sans-serif',
          padding: '70px 80px',
        }}>
        <div
          style={{
            display: 'flex',
            fontSize: 28,
            color: 'rgba(255,255,255,0.55)',
            letterSpacing: '0.22em',
            textTransform: 'uppercase',
            marginBottom: 22,
          }}>
          Music Charts Tools
        </div>
        <div
          style={{
            display: 'flex',
            fontSize: 110,
            fontWeight: 800,
            letterSpacing: '-0.03em',
            lineHeight: 1.05,
            marginBottom: 28,
          }}>
          Spotify Chart Finder
        </div>
        <div
          style={{
            display: 'flex',
            fontSize: 42,
            color: 'rgba(255,255,255,0.78)',
            maxWidth: 1040,
            lineHeight: 1.25,
            marginBottom: 48,
          }}>
          Scan your Spotify playlists for Clone Hero charts.
        </div>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            padding: '32px 40px',
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 20,
            gap: 22,
          }}>
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
                  background: SPOTIFY_GREEN,
                }}>
                <svg width="26" height="26" viewBox="0 0 14 14">
                  <path
                    d="M3 7 L6 10 L11 4"
                    fill="none"
                    stroke="#0a0a14"
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
                  color: 'rgba(255,255,255,0.7)',
                }}>
                <span style={{color: 'white', fontWeight: 700}}>{found}</span>
                <span style={{margin: '0 6px', opacity: 0.5}}>/</span>
                <span>{total}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    ),
    size,
  );
}
