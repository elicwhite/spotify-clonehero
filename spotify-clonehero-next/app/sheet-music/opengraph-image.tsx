import {ImageResponse} from 'next/og';

import {
  OgBrandRow,
  OgFrame,
  OgPanel,
  OgSubtitle,
  OgTitle,
} from '@/lib/og/layout';
import {OG_LANES, OG_SIZE} from '@/lib/og/tokens';

export const alt = 'Drum Sheet Music for any Clone Hero chart';
export const size = OG_SIZE;
export const contentType = 'image/png';

// Stylized one-bar drum pattern. Y values map onto a 5-line staff
// (lines at y=0, 28, 56, 84, 112). Note colors are the Clone Hero drum
// lanes — red snare, yellow hi-hat, blue/green toms, orange kick — so
// the staff also reads as a flattened highway.
const NOTES: ReadonlyArray<{x: number; y: number; color: string}> = [
  {x: 80, y: -14, color: OG_LANES.yellow},
  {x: 80, y: 98, color: OG_LANES.kick},
  {x: 160, y: -14, color: OG_LANES.yellow},
  {x: 240, y: -14, color: OG_LANES.yellow},
  {x: 240, y: 70, color: OG_LANES.red},
  {x: 320, y: -14, color: OG_LANES.yellow},
  {x: 400, y: -14, color: OG_LANES.yellow},
  {x: 400, y: 98, color: OG_LANES.kick},
  {x: 480, y: -14, color: OG_LANES.yellow},
  {x: 560, y: -14, color: OG_LANES.yellow},
  {x: 560, y: 70, color: OG_LANES.red},
  {x: 640, y: 42, color: OG_LANES.blue},
  {x: 720, y: 56, color: OG_LANES.green},
  {x: 800, y: 84, color: OG_LANES.green},
];

const STAFF_W = 880;
const STAFF_H = 144;

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <OgFrame>
        <OgBrandRow />
        <OgTitle style={{marginTop: 20, marginBottom: 24}}>
          Drum Sheet Music
        </OgTitle>
        <OgSubtitle style={{maxWidth: 1040, marginBottom: 36}}>
          Any Clone Hero drum chart as sheet music — synced to the audio.
        </OgSubtitle>
        <OgPanel padding="32px 40px" style={{alignSelf: 'flex-start'}}>
          <svg
            width={STAFF_W}
            height={STAFF_H}
            viewBox={`0 -28 ${STAFF_W} ${STAFF_H}`}>
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
            <rect
              x="0"
              y="0"
              width="6"
              height="112"
              fill="rgba(255,255,255,0.55)"
            />
            <rect
              x={STAFF_W - 6}
              y="0"
              width="6"
              height="112"
              fill="rgba(255,255,255,0.55)"
            />
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
        </OgPanel>
      </OgFrame>
    ),
    size,
  );
}
