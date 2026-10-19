import {createToolOgImage} from '@/lib/og/tool-og-image';
import {OG_COLORS, OG_LANES, OG_SIZE} from '@/lib/og/tokens';

export const alt = 'Build a draft tempo map for 4/4 songs';
export const size = OG_SIZE;
export const contentType = 'image/png';

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
          stroke={index === 0 || index === 4 ? OG_COLORS.purple : OG_LANES.blue}
          strokeWidth={index === 0 || index === 4 ? 5 : 3}
        />
      ))}
    </svg>
  );
}

export default function OpengraphImage() {
  return createToolOgImage({
    eyebrow: 'TEMPO MAPPING',
    title: 'Build a draft tempo map for 4/4 songs',
    illustration: <TempoChart />,
  });
}
