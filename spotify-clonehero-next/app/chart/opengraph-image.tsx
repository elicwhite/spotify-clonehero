import {createToolOgImage} from '@/lib/og/tool-og-image';
import {OG_COLORS, OG_LANES, OG_SIZE} from '@/lib/og/tokens';

export const alt = 'Tool-assisted charting, one step at a time';
export const size = OG_SIZE;
export const contentType = 'image/png';

/**
 * The page's own subject is the sequence, not any one tool, so the card draws
 * the sequence: four stages left to right with the lane colors marking which
 * part of a chart each one produces.
 */
const STAGES: {label: string; color: string}[] = [
  {label: 'Tempo', color: OG_LANES.blue},
  {label: 'Drum notes', color: OG_LANES.yellow},
  {label: 'Difficulties', color: OG_LANES.green},
  {label: 'Lyrics', color: OG_LANES.kick},
];

function Stages() {
  return (
    <div
      style={{
        display: 'flex',
        width: '100%',
        height: '100%',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 18,
        padding: '0 12px',
      }}>
      {STAGES.map((stage, index) => (
        <div
          key={stage.label}
          style={{display: 'flex', alignItems: 'center', gap: 18, flex: 1}}>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              flex: 1,
              gap: 22,
              height: 168,
              justifyContent: 'center',
              padding: '0 26px',
              borderRadius: 16,
              border: `1px solid ${OG_COLORS.cardBorder}`,
              background: OG_COLORS.card,
            }}>
            <div
              style={{
                display: 'flex',
                width: 62,
                height: 12,
                borderRadius: 4,
                background: stage.color,
              }}
            />
            <div style={{display: 'flex', fontSize: 27, fontWeight: 600}}>
              {stage.label}
            </div>
          </div>
          {index < STAGES.length - 1 ? (
            <div
              style={{display: 'flex', fontSize: 34, color: OG_COLORS.subtle}}>
              →
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export default function OpengraphImage() {
  return createToolOgImage({
    eyebrow: 'FOR CHARTERS',
    title: 'Tool-assisted charting, one step at a time',
    illustration: <Stages />,
  });
}
