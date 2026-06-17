import {ImageResponse} from 'next/og';

export const alt = 'Spotify History Chart Finder';
export const size = {width: 1200, height: 630};
export const contentType = 'image/png';

const SPOTIFY_GREEN = '#1DB954';

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
          padding: '64px 80px',
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
            fontSize: 92,
            fontWeight: 800,
            letterSpacing: '-0.03em',
            lineHeight: 1.05,
            marginBottom: 28,
          }}>
          Spotify History Charts
        </div>
        <div
          style={{
            display: 'flex',
            fontSize: 36,
            color: 'rgba(255,255,255,0.78)',
            maxWidth: 1040,
            lineHeight: 1.25,
            marginBottom: 36,
          }}>
          Find charts for every song you&rsquo;ve listened to on Spotify.
        </div>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            padding: '28px 36px',
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 20,
            gap: 18,
          }}>
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
                  background: SPOTIFY_GREEN,
                }}>
                <svg width="22" height="22" viewBox="0 0 14 14">
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
              <div style={{display: 'flex', fontSize: 38, fontWeight: 600}}>
                {song}
              </div>
            </div>
          ))}
        </div>
      </div>
    ),
    size,
  );
}
