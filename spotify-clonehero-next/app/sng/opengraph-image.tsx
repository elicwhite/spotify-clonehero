import {ImageResponse} from 'next/og';

export const alt = 'SNG File Manager';
export const size = {width: 1200, height: 630};
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
  color: 'white',
  background: 'rgba(255,255,255,0.08)',
  border: '1px solid rgba(255,255,255,0.18)',
  borderRadius: 22,
} as const;

const arrow = {
  display: 'flex',
  flexShrink: 0,
  fontSize: 56,
  color: 'rgba(255,255,255,0.5)',
} as const;

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
            flexShrink: 0,
            fontSize: 26,
            color: 'rgba(255,255,255,0.55)',
            letterSpacing: '0.22em',
            textTransform: 'uppercase',
            marginBottom: 18,
          }}>
          Music Charts Tools
        </div>
        <div
          style={{
            display: 'flex',
            flexShrink: 0,
            fontSize: 92,
            fontWeight: 800,
            letterSpacing: '-0.03em',
            lineHeight: 1.2,
            marginBottom: 18,
          }}>
          SNG File Manager
        </div>
        <div
          style={{
            display: 'flex',
            flexShrink: 0,
            fontSize: 38,
            color: 'rgba(255,255,255,0.78)',
            maxWidth: 1000,
            lineHeight: 1.3,
            marginBottom: 44,
          }}>
          Create, inspect, and convert Clone Hero .sng packages — right in your
          browser.
        </div>

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
                  color: 'rgba(255,255,255,0.82)',
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.12)',
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
      </div>
    ),
    size,
  );
}
