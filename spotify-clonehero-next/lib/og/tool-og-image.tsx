import {ImageResponse} from 'next/og';

export const OG_SIZE = {width: 1200, height: 630};

export type ToolOgKind = 'drum-transcription' | 'tempo';

const COLORS = {
  panel: 'rgba(255,255,255,0.055)',
  border: 'rgba(255,255,255,0.14)',
  text: '#ffffff',
  muted: 'rgba(255,255,255,0.64)',
  purple: '#a855b7',
  kick: '#f2994a',
  red: '#e5484d',
  yellow: '#f5c742',
  blue: '#4a9ef2',
  green: '#5cc262',
} as const;

const COPY = {
  'drum-transcription': {
    eyebrow: 'DRUM TRANSCRIPTION',
    title: 'Turn a song into a draft drum chart',
  },
  tempo: {
    eyebrow: 'TEMPO MAPPING',
    title: 'Build a draft tempo map for 4/4 songs',
  },
} as const;

/**
 * Peak envelope from an 18-second excerpt of a real held-out song's separated
 * drum stem. It is frozen here so metadata rendering never reads audio.
 */
const REAL_WAVEFORM = Array.from(
  'k95c8erdge9875c96re8d9ab6c96c85b87rgbc97b7fe7a96ea7vd8rb9vd8qajo9uhazzjeb9764445td875322321111111sc874222121yj9764ypoaa543222xu997522111112122zo9ohcvi8oc8ua8rb7xnge9744343wfa77432221111121wf9763222213vb754vyod85322122zd965221111111110ud8tc9qb8jcrmase8ztodb876644nua974322222111112sd964222221ufa864zoib9623222zld77421211111111tpb995we9763sc974kymg99zzqd96tpe987xpc87422111xrke9632212susc88zzjga6zlf997wtc77sslc97zrjda7ygga9rudomcqh9ue9zpldb7zmg99uqf976uib77645544hznea7543443yea776',
  value => Number.parseInt(value, 36) / 35,
);

function waveformPath(
  amplitudes: readonly number[],
  left: number,
  width: number,
  middle: number,
  maximum: number,
) {
  const point = (value: number, index: number, sign: -1 | 1) => {
    const x = left + (index * width) / Math.max(1, amplitudes.length - 1);
    return `${x} ${middle + sign * value * maximum}`;
  };
  const top = amplitudes.map((value, index) => point(value, index, -1));
  const bottom = [...amplitudes]
    .reverse()
    .map((value, reverseIndex) =>
      point(value, amplitudes.length - 1 - reverseIndex, 1),
    );
  return `M ${left} ${middle} L ${top.join(' L ')} L ${bottom.join(' L ')} Z`;
}

function Brand() {
  return (
    <div
      style={{
        display: 'flex',
        width: '100%',
        alignItems: 'center',
        justifyContent: 'flex-start',
        fontSize: 24,
        letterSpacing: '0.18em',
        color: COLORS.muted,
      }}>
      MUSIC CHARTS TOOLS
    </div>
  );
}

const DRUM_NOTES = [
  // A two-bar groove matching the landing-page piano roll: yellow eighths,
  // red backbeats, kick anchors, then blue and green cymbal accents.
  {x: 60, y: 72, color: COLORS.yellow, cymbal: true},
  {x: 60, y: 204, color: COLORS.kick},
  {x: 170, y: 72, color: COLORS.yellow, cymbal: true},
  {x: 280, y: 28, color: COLORS.red},
  {x: 280, y: 116, color: COLORS.blue, cymbal: true},
  {x: 280, y: 204, color: COLORS.kick},
  {x: 390, y: 72, color: COLORS.yellow, cymbal: true},
  {x: 500, y: 72, color: COLORS.yellow, cymbal: true},
  {x: 610, y: 28, color: COLORS.red},
  {x: 610, y: 204, color: COLORS.kick},
  {x: 720, y: 72, color: COLORS.yellow, cymbal: true},
  {x: 830, y: 72, color: COLORS.yellow, cymbal: true},
  {x: 940, y: 160, color: COLORS.green, cymbal: true},
  {x: 940, y: 204, color: COLORS.kick},
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

function TempoChart() {
  const markers = [78, 194, 310, 426, 542, 658, 774, 890];
  return (
    <svg width="100%" height="100%" viewBox="0 0 1020 240">
      <rect width="1020" height="240" rx="18" fill="#07060b" />
      <path
        d={waveformPath(REAL_WAVEFORM, 32, 956, 120, 82)}
        fill="#4a6288"
        opacity="0.9"
      />
      {markers.map((x, index) => (
        <line
          key={x}
          x1={x}
          x2={x}
          y1="20"
          y2="220"
          stroke={index === 0 || index === 4 ? COLORS.purple : COLORS.blue}
          strokeWidth={index === 0 || index === 4 ? 5 : 3}
        />
      ))}
    </svg>
  );
}

function ToolChart({tool}: {tool: ToolOgKind}) {
  return tool === 'drum-transcription' ? <DrumChart /> : <TempoChart />;
}

function FinalCard({tool}: {tool: ToolOgKind}) {
  const copy = COPY[tool];
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        padding: '50px 68px',
      }}>
      <div style={{display: 'flex', justifyContent: 'space-between'}}>
        <Brand />
        <div
          style={{
            display: 'flex',
            fontSize: 20,
            letterSpacing: '0.18em',
            color: COLORS.purple,
          }}>
          {copy.eyebrow}
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          fontSize: 56,
          fontWeight: 760,
          letterSpacing: '-0.04em',
          lineHeight: 1.05,
          marginTop: 26,
          marginBottom: 26,
        }}>
        {copy.title}
      </div>
      <div
        style={{
          display: 'flex',
          width: '100%',
          height: 300,
          padding: 16,
          border: `1px solid ${COLORS.border}`,
          borderRadius: 24,
          background: COLORS.panel,
        }}>
        <ToolChart tool={tool} />
      </div>
    </div>
  );
}

export function createToolOgImage(tool: ToolOgKind) {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          background:
            'radial-gradient(circle at 84% 18%, rgba(168,85,183,0.2), transparent 34%), linear-gradient(135deg, #17091d 0%, #0a0710 58%, #08070d 100%)',
          color: COLORS.text,
          fontFamily: 'system-ui, sans-serif',
        }}>
        <FinalCard tool={tool} />
      </div>
    ),
    OG_SIZE,
  );
}
