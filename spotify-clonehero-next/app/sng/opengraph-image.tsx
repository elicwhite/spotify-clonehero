import {ImageResponse} from 'next/og';

export const alt = 'SNG File Manager';
export const size = {width: 1200, height: 630};
export const contentType = 'image/png';

// The files that typically make up a Clone Hero package, shown collapsing
// into a single .sng (and convertible to .zip).
const PACKAGE_FILES = ['notes.chart', 'song.opus', 'album.png'];

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

        {/* loose files → .sng / .zip */}
        <div
          style={{
            display: 'flex',
            flexShrink: 0,
            alignItems: 'center',
            gap: 28,
          }}>
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

          <div
            style={{
              display: 'flex',
              fontSize: 64,
              color: 'rgba(255,255,255,0.5)',
              margin: '0 8px',
            }}>
            →
          </div>

          <div style={{display: 'flex', gap: 22}}>
            {['.sng', '.zip'].map(ext => (
              <div
                key={ext}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 168,
                  height: 168,
                  fontSize: 50,
                  fontWeight: 700,
                  fontFamily: 'monospace',
                  color: 'white',
                  background:
                    ext === '.sng'
                      ? 'linear-gradient(135deg, #f84b61 0%, #a5002c 100%)'
                      : 'rgba(255,255,255,0.08)',
                  border:
                    ext === '.sng'
                      ? 'none'
                      : '1px solid rgba(255,255,255,0.18)',
                  borderRadius: 22,
                }}>
                {ext}
              </div>
            ))}
          </div>
        </div>
      </div>
    ),
    size,
  );
}
