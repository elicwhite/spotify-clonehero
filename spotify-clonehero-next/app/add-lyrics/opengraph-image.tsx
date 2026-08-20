import {ImageResponse} from 'next/og';

import {
  OgBrandRow,
  OgFrame,
  OgPanel,
  OgSubtitle,
  OgTitle,
} from '@/lib/og/layout';
import {OG_COLORS, OG_LANES, OG_SIZE, OG_TYPE} from '@/lib/og/tokens';

import {
  CORRECTED_INDEX,
  PROPOSED_AT,
  SYLLABLES,
  envelope,
} from './landing/syllableAlignModel';

export const alt = 'Add synced lyrics to a chart';
export const size = OG_SIZE;
export const contentType = 'image/png';

/**
 * The illustration is a still frame of the landing hero canvas
 * (app/add-lyrics/landing/SyllableAlignCanvas.tsx) in its settled state:
 * syllables ticked onto the vocal at the time each is sung, with one ("ler")
 * corrected onto its burst and its proposed position left behind as a dashed
 * tick. The waveform envelope, syllable positions, and the corrected
 * syllable's offset come from `./landing/syllableAlignModel`, the same data
 * the canvas animates, so the two cannot drift apart.
 */

// The illustration's own coordinate space. Labels are positioned by the same
// fractions in the surrounding flex layer, so they line up with the SVG.
const VIEW_W = 1000;
const VIEW_H = 230;
const PAD_FRAC = 0.03;
const TICK_TOP = 98;
const WAVE_MID = 172;
const WAVE_H = 46;

/** x in viewBox units for a strip fraction. */
function x(frac: number) {
  return (PAD_FRAC + frac * (1 - 2 * PAD_FRAC)) * VIEW_W;
}

/** Fraction of the panel width for a strip fraction, for label layout. */
function pct(frac: number) {
  return (PAD_FRAC + frac * (1 - 2 * PAD_FRAC)) * 100;
}

/** The filled waveform silhouette as one SVG path. */
function wavePath() {
  const steps = 400;
  const top: string[] = [];
  const bottom: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const e = envelope(t);
    top.push(`L${x(t).toFixed(1)},${(WAVE_MID - e * WAVE_H).toFixed(1)}`);
    bottom.unshift(
      `L${x(t).toFixed(1)},${(WAVE_MID + e * WAVE_H * 0.7).toFixed(1)}`,
    );
  }
  return `M${x(0).toFixed(1)},${WAVE_MID}${top.join('')}${bottom.join('')}Z`;
}

const WAVE_PATH = wavePath();

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <OgFrame>
        <OgBrandRow />
        {/* `titleCompact`: at the default `title` size this title wraps to
            two lines and collides with the subtitle. */}
        <OgTitle size="titleCompact" style={{marginTop: 22, marginBottom: 24}}>
          Add synced lyrics to a chart
        </OgTitle>
        <OgSubtitle style={{maxWidth: 1040, marginBottom: 44}}>
          Paste lyrics. Each syllable is aligned to the vocal, and you review
          the result in the chart editor.
        </OgSubtitle>
        <OgPanel padding="24px 28px" style={{flexGrow: 1}}>
          <div
            style={{
              display: 'flex',
              position: 'relative',
              width: '100%',
              height: '100%',
            }}>
            <svg
              width="100%"
              height="100%"
              viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
              preserveAspectRatio="none"
              style={{position: 'absolute', top: 0, left: 0}}>
              <path d={WAVE_PATH} fill={OG_COLORS.muted} opacity="0.38" />
              {/* Where "ler" was proposed stays behind as a dashed tick. */}
              <line
                x1={x(PROPOSED_AT)}
                y1={TICK_TOP}
                x2={x(PROPOSED_AT)}
                y2={WAVE_MID + WAVE_H * 0.7}
                stroke={OG_LANES.blue}
                strokeWidth="2.5"
                strokeDasharray="7 7"
                opacity="0.45"
              />
              {SYLLABLES.map((syl, i) => (
                <line
                  key={syl.text}
                  x1={x(syl.at)}
                  y1={TICK_TOP}
                  x2={x(syl.at)}
                  y2={WAVE_MID + WAVE_H * 0.7}
                  stroke={
                    i === CORRECTED_INDEX ? OG_LANES.green : OG_LANES.blue
                  }
                  strokeWidth={i === CORRECTED_INDEX ? 4 : 3}
                  opacity="0.9"
                />
              ))}
            </svg>
            {SYLLABLES.map((syl, i) => (
              <div
                key={syl.text}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  position: 'absolute',
                  top: 0,
                  left: `${pct(syl.at)}%`,
                  transform: 'translateX(-50%)',
                  color: i === CORRECTED_INDEX ? OG_LANES.green : OG_LANES.blue,
                }}>
                <div
                  style={{
                    display: 'flex',
                    fontSize: OG_TYPE.illustrationLabel,
                    fontWeight: 600,
                  }}>
                  {syl.text}
                </div>
                <div
                  style={{
                    display: 'flex',
                    fontSize: OG_TYPE.illustrationSub,
                    fontFamily: 'monospace',
                    marginTop: 6,
                    opacity: 0.75,
                  }}>
                  {syl.time}
                </div>
              </div>
            ))}
          </div>
        </OgPanel>
      </OgFrame>
    ),
    size,
  );
}
