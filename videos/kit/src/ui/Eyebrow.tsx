import type {CSSProperties} from 'react';
import {color, space} from '../brand/tokens';
import {useGlobalFrame} from '../clock';
import {useFormat} from '../format';
import {ease} from '../brand/ease';
import {useLayout} from '../brand/layout';
import {alpha, progress} from '../motion';
import {KineticText} from '../text/KineticText';
import {
  EYEBROW_TIMING,
  eyebrowLabelTiming,
  type EyebrowTiming,
} from './slateTiming';

export interface EyebrowProps extends EyebrowTiming {
  text: string;
  /** The accent bar's colour, and the caret's (default the brand purple). */
  accent?: string;
  /**
   * Top-left corner, px, kept inside the title-safe box. Omit both to lay the
   * eyebrow out in the flow.
   */
  x?: number;
  y?: number;
  /**
   * The widest the whole row (bar and label) may be, px; a longer label
   * wraps. Default when placed: up to the title-safe box's right edge.
   */
  maxWidth?: number;
  /** Label colour: muted white (default), the accent, or full white. */
  tone?: 'muted' | 'accent' | 'text';
  style?: CSSProperties;
}

/**
 * A chapter eyebrow: a short accent bar and a mono, uppercase, wide-tracked
 * label. The bar draws from the left, then the label types in behind a caret
 * in the accent colour. Placed with `x`/`y`, it stays inside the title-safe
 * box, and a label too wide for the frame wraps.
 */
export const Eyebrow: React.FC<EyebrowProps> = ({
  text,
  accent = color.purple,
  x,
  y,
  maxWidth,
  enterAt,
  exitAt,
  enter = 'type',
  tone = 'muted',
  style,
}) => {
  const f = useGlobalFrame();
  const {fps, unit, safe} = useFormat();
  // Placed, it sits at (x, y) kept inside the safe box, the way a slate does.
  const placement = useLayout({x: x ?? safe.x, y: y ?? safe.y});
  const {barInSec, barOutDelaySec, barOutSec} = EYEBROW_TIMING;
  const barIn =
    enterAt === undefined
      ? 1
      : ease.enter(progress(f, enterAt, barInSec * fps));
  const barOut =
    exitAt === undefined
      ? 0
      : ease.exit(progress(f, exitAt + barOutDelaySec * fps, barOutSec * fps));
  const labelColor =
    tone === 'accent'
      ? accent
      : tone === 'text'
        ? color.text
        : 'rgba(255,255,255,0.72)';
  const barW = space.eyebrowBarWidth * unit;
  const barH = space.eyebrowBarHeight * unit;
  const gap = space.eyebrowBarGap * unit;
  const placed = x !== undefined || y !== undefined;
  const left = placement.slateX;
  const top = placement.slateY;
  const rowMax = maxWidth ?? (placed ? placement.slateWidth : undefined);
  const labelMax = rowMax === undefined ? undefined : rowMax - barW - gap;
  const label = eyebrowLabelTiming(text, {enterAt, exitAt, enter}, fps);
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap,
        ...(placed ? {position: 'absolute', left, top} : null),
        ...style,
      }}>
      <div
        style={{
          width: barW,
          height: barH,
          borderRadius: barH / 2,
          background: accent,
          boxShadow: `0 0 ${14 * unit}px ${alpha(accent, 0.55)}`,
          transform: `scaleX(${barIn * (1 - barOut)})`,
          transformOrigin: barOut > 0 ? 'right center' : 'left center',
          flex: 'none',
        }}
      />
      <KineticText
        {...label}
        variant="eyebrow"
        color={labelColor}
        maxWidth={labelMax}
        caret={enter === 'type' ? {color: accent} : false}
      />
    </div>
  );
};
