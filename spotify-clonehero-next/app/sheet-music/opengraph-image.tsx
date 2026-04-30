import {ImageResponse} from 'next/og';

export const alt = 'Drum Sheet Music for any Clone Hero chart';
export const size = {width: 1200, height: 630};
export const contentType = 'image/png';

// Stylized one-bar drum pattern. Y values map onto a 5-line staff
// (lines at y=0, 28, 56, 84, 112). Note colors match Clone Hero drum
// lanes — red snare, yellow hi-hat, blue/green toms, orange kick — so
// the staff also reads as a flattened highway.
const HI_HAT = '#facc15';
const SNARE = '#ef4444';
const TOM_BLUE = '#3b82f6';
const TOM_GREEN = '#22c55e';
const KICK = '#f97316';

const NOTES: ReadonlyArray<{x: number; y: number; color: string}> = [
  {x: 80, y: -14, color: HI_HAT},
  {x: 80, y: 98, color: KICK},
  {x: 160, y: -14, color: HI_HAT},
  {x: 240, y: -14, color: HI_HAT},
  {x: 240, y: 70, color: SNARE},
  {x: 320, y: -14, color: HI_HAT},
  {x: 400, y: -14, color: HI_HAT},
  {x: 400, y: 98, color: KICK},
  {x: 480, y: -14, color: HI_HAT},
  {x: 560, y: -14, color: HI_HAT},
  {x: 560, y: 70, color: SNARE},
  {x: 640, y: 42, color: TOM_BLUE},
  {x: 720, y: 56, color: TOM_GREEN},
  {x: 800, y: 84, color: TOM_GREEN},
];

const STAFF_W = 880;
const STAFF_H = 144;

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
            fontSize: 26,
            color: 'rgba(255,255,255,0.55)',
            letterSpacing: '0.22em',
            textTransform: 'uppercase',
            marginBottom: 20,
          }}>
          Music Charts Tools
        </div>
        <div
          style={{
            display: 'flex',
            fontSize: 100,
            fontWeight: 800,
            letterSpacing: '-0.03em',
            lineHeight: 1.05,
            marginBottom: 24,
          }}>
          Drum Sheet Music
        </div>
        <div
          style={{
            display: 'flex',
            fontSize: 34,
            color: 'rgba(255,255,255,0.78)',
            maxWidth: 1040,
            lineHeight: 1.3,
            marginBottom: 36,
          }}>
            Any Clone Hero drum chart as sheet music — synced to the audio.
        </div>
        <div
          style={{
            display: 'flex',
            padding: '32px 40px',
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 20,
            alignSelf: 'flex-start',
          }}>
          <svg width={STAFF_W} height={STAFF_H} viewBox={`0 -28 ${STAFF_W} ${STAFF_H}`}>
            {[0, 1, 2, 3, 4].map(i => (
              <line
                key={`l${i}`}
                x1="0"
                x2={STAFF_W}
                y1={i * 28}
                y2={i * 28}
                stroke="rgba(255,255,255,0.4)"
                strokeWidth="3"
              />
            ))}
            <rect x="0" y="0" width="6" height="112" fill="rgba(255,255,255,0.55)" />
            <rect x={STAFF_W - 6} y="0" width="6" height="112" fill="rgba(255,255,255,0.55)" />
            {NOTES.map((n, i) => (
              <circle
                key={i}
                cx={n.x}
                cy={n.y}
                r="14"
                fill={n.color}
                stroke="rgba(0,0,0,0.35)"
                strokeWidth="2"
              />
            ))}
          </svg>
        </div>
      </div>
    ),
    size,
  );
}
