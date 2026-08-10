import {createToolOgImage} from '@/lib/og/tool-og-image';
import {OG_LANES, OG_SIZE} from '@/lib/og/tokens';

export const alt = 'Turn a song into a draft drum chart';
export const size = OG_SIZE;
export const contentType = 'image/png';

const DRUM_NOTES = [
  // A two-bar groove matching the landing-page piano roll: yellow eighths,
  // red backbeats, kick anchors, then blue and green cymbal accents.
  {x: 60, y: 72, color: OG_LANES.yellow, cymbal: true},
  {x: 60, y: 204, color: OG_LANES.kick},
  {x: 170, y: 72, color: OG_LANES.yellow, cymbal: true},
  {x: 280, y: 28, color: OG_LANES.red},
  {x: 280, y: 116, color: OG_LANES.blue, cymbal: true},
  {x: 280, y: 204, color: OG_LANES.kick},
  {x: 390, y: 72, color: OG_LANES.yellow, cymbal: true},
  {x: 500, y: 72, color: OG_LANES.yellow, cymbal: true},
  {x: 610, y: 28, color: OG_LANES.red},
  {x: 610, y: 204, color: OG_LANES.kick},
  {x: 720, y: 72, color: OG_LANES.yellow, cymbal: true},
  {x: 830, y: 72, color: OG_LANES.yellow, cymbal: true},
  {x: 940, y: 160, color: OG_LANES.green, cymbal: true},
  {x: 940, y: 204, color: OG_LANES.kick},
] as const;

function DrumChart() {
  return (
    <svg width="100%" height="100%" viewBox="0 0 1020 240">
      <rect width="1020" height="240" rx="18" fill="#171b24" />
      {[28, 72, 116, 160, 204].map(y => (
        <line
          key={y}
          x1="32"
          x2="988"
          y1={y}
          y2={y}
          stroke="#2a3342"
          strokeWidth="2"
        />
      ))}
      {[60, 170, 280, 390, 500, 610, 720, 830, 940].map((x, index) => (
        <line
          key={x}
          x1={x}
          x2={x}
          y1="18"
          y2="222"
          stroke={index % 4 === 0 ? '#59677c' : '#3a4557'}
          strokeWidth={index % 4 === 0 ? 3 : 2}
        />
      ))}
      {DRUM_NOTES.map(note =>
        'cymbal' in note && note.cymbal ? (
          <path
            key={`${note.x}-${note.y}`}
            d={`M ${note.x} ${note.y - 12} L ${note.x + 14} ${
              note.y + 10
            } L ${note.x - 14} ${note.y + 10} Z`}
            fill={note.color}
          />
        ) : (
          <rect
            key={`${note.x}-${note.y}`}
            x={note.x - 14}
            y={note.y - 9}
            width="28"
            height="18"
            rx="4"
            fill={note.color}
          />
        ),
      )}
    </svg>
  );
}

export default function OpengraphImage() {
  return createToolOgImage({
    eyebrow: 'DRUM TRANSCRIPTION',
    title: 'Turn a song into a draft drum chart',
    illustration: <DrumChart />,
  });
}
