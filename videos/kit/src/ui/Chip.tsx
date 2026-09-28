import type {LucideIcon} from 'lucide-react';
import type {CSSProperties, ReactNode} from 'react';
import {color, radius} from '../brand/tokens';
import {useFormat} from '../format';
import {alpha, clamp01, lighten} from '../motion';
import {textStyle} from '../text/style';

/** Chip sizes, reference px (`font` is the label size; the `chip` type token is md's). */
const SIZES = {
  sm: {h: 36, font: 17, padX: 14, dot: 7, icon: 16, gap: 9},
  md: {h: 46, font: 20, padX: 18, dot: 8, icon: 19, gap: 11},
  lg: {h: 58, font: 25, padX: 22, dot: 10, icon: 23, gap: 13},
} as const;

export interface ChipProps {
  label: ReactNode;
  /** Accent colour: tints the fill, border and dot. */
  accent?: string;
  /** Leading element: 'dot' (an accent dot), a lucide icon, or nothing. */
  lead?: 'dot' | LucideIcon | null;
  size?: keyof typeof SIZES;
  shape?: 'pill' | 'rounded';
  /** 0..1 extra glow (e.g. on the beat it lands). */
  highlight?: number;
  style?: CSSProperties;
}

/**
 * A mono label in a pill: "120 BPM", "4/4", shortcut keys. The accent tints
 * it; `highlight` makes it glow.
 */
export const Chip: React.FC<ChipProps> = ({
  label,
  accent,
  lead = accent ? 'dot' : null,
  size = 'md',
  shape = 'pill',
  highlight = 0,
  style,
}) => {
  const {unit} = useFormat();
  const s = SIZES[size];
  const h = clamp01(highlight);
  const Icon = lead !== null && lead !== 'dot' ? lead : null;
  return (
    <div
      style={textStyle('chip', unit, {
        display: 'inline-flex',
        alignItems: 'center',
        gap: s.gap * unit,
        height: s.h * unit,
        padding: `0 ${s.padX * unit}px`,
        borderRadius: shape === 'pill' ? radius.pill : radius.chip * unit,
        background: accent
          ? `linear-gradient(180deg, ${alpha(accent, 0.24 + 0.1 * h)}, ${alpha(accent, 0.12 + 0.08 * h)})`
          : `linear-gradient(180deg, rgba(255,255,255,${0.085 + 0.05 * h}), rgba(255,255,255,${0.045 + 0.04 * h}))`,
        border: `${unit}px solid ${accent ? alpha(accent, 0.55 + 0.35 * h) : `rgba(255,255,255,${0.16 + 0.2 * h})`}`,
        boxShadow: `inset 0 ${unit}px 0 rgba(255,255,255,0.08), 0 ${8 * unit}px ${24 * unit}px rgba(0,0,0,0.35)${
          h > 0
            ? `, 0 0 ${24 * h * unit}px ${alpha(accent ?? color.white, 0.45 * h)}`
            : ''
        }`,
        color: accent ? lighten(accent, 0.82) : 'rgba(255,255,255,0.92)',
        fontSize: s.font * unit,
        whiteSpace: 'nowrap',
        ...style,
      })}>
      {lead === 'dot' ? (
        <span
          style={{
            width: s.dot * unit,
            height: s.dot * unit,
            borderRadius: '50%',
            background: accent ?? color.white,
            boxShadow: `0 0 ${(8 + 10 * h) * unit}px ${alpha(accent ?? color.white, 0.8)}`,
            flex: 'none',
          }}
        />
      ) : Icon ? (
        <Icon
          size={s.icon * unit}
          strokeWidth={2}
          color={accent ? lighten(accent, 0.5) : 'rgba(255,255,255,0.8)'}
          style={{flex: 'none'}}
        />
      ) : null}
      <span>{label}</span>
    </div>
  );
};
