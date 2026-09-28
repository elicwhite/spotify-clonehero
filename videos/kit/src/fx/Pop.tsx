import type {CSSProperties, ReactNode} from 'react';
import {useGlobalFrame} from '../clock';
import {useFormat} from '../format';
import {progress} from '../motion';
import {
  resolveEnter,
  resolveExit,
  type EnterPresetName,
  type ExitPresetName,
  type KineticPreset,
  type UnitContext,
} from '../text/presets';
import {
  composeStyle,
  directionalBlur,
  unitCss,
  type UnitStyle,
} from '../text/unitStyle';
import {useFilterId} from './filterId';

/**
 * The text presets that work on a whole element: none needs a line mask, a
 * caret or characters to scramble.
 */
export const POP_ENTERS = [
  'scalePop',
  'dropIn',
  'fadeUp',
  'fadeIn',
  'blurIn',
  'blurRise',
  'whipIn',
  'none',
] as const satisfies readonly EnterPresetName[];
export const POP_EXITS = [
  'shrinkOut',
  'fallOut',
  'riseOut',
  'fadeOut',
  'fadeDown',
  'blurOut',
  'blurLift',
  'whipUp',
  'peelUp',
  'none',
] as const satisfies readonly ExitPresetName[];
export type PopEnterName = (typeof POP_ENTERS)[number];
export type PopExitName = (typeof POP_EXITS)[number];

export interface PopProps {
  /** Film frame the element starts arriving. Omit to show it at rest. */
  at?: number;
  /** Film frame the element starts leaving. */
  exitAt?: number;
  /** An enter preset from `POP_ENTERS` (default 'scalePop'), or your own without a mask or caret. */
  enter?: PopEnterName | KineticPreset;
  /** An exit preset from `POP_EXITS` (default 'shrinkOut'), or your own without a mask. */
  exit?: PopExitName | KineticPreset;
  /** Frames the enter and the exit take (default: the presets'). */
  duration?: number;
  exitDuration?: number;
  /**
   * The element's nominal size, px: what a preset's relative distances (a
   * line height, a font size) are measured against. Default 40 reference px.
   */
  size?: number;
  /** CSS transform-origin (default: the preset's, else the centre). */
  origin?: string;
  /**
   * Seed of any randomness in the presets (default 'pop'). It never depends
   * on where the element sits in the tree, so every copy of it (a
   * SampledMotionBlur's samples) moves the same.
   */
  seed?: string;
  /** The element's own style: its transform, opacity and filter are kept, the pop's layered on. */
  style?: CSSProperties;
  children: ReactNode;
}

/**
 * Enter and exit for any element, keyed to film frames: a KineticText preset
 * applied to the whole element as one unit (its transform, opacity and blur).
 * The element keeps its layout slot while hidden, so nothing around it jumps.
 *
 * ```tsx
 * <Pop at={beat(1, 2)} exitAt={beat(3, 3)}><Chip label="4/4" /></Pop>
 * <Pop at={f} exitAt={f + 150} enter="blurRise" exit="blurOut" size={38 * unit}
 *   style={{position: 'absolute', left: 110, top: 600}}>
 *   <Callout ... />
 * </Pop>
 * ```
 */
export const Pop: React.FC<PopProps> = ({
  at,
  exitAt,
  enter = 'scalePop',
  exit = 'shrinkOut',
  duration,
  exitDuration,
  size,
  origin,
  seed = 'pop',
  style,
  children,
}) => {
  const frame = useGlobalFrame();
  const {fps, unit} = useFormat();
  const filterId = useFilterId('pop');
  const inPreset = resolveEnter(enter);
  const outPreset = resolveExit(exit);
  if (inPreset.mask || inPreset.caret || outPreset.mask)
    throw new Error(
      '[Pop] a preset with a line mask or a caret needs KineticText; give Pop one of POP_ENTERS / POP_EXITS or a preset without them',
    );
  const nominal = size ?? 40 * unit;
  const inFrames = duration ?? inPreset.duration * fps;
  const outFrames = exitDuration ?? outPreset.duration * fps;
  const unitOf = (start: number, frames: number): UnitContext => ({
    index: 0,
    count: 1,
    line: 0,
    lineCount: 1,
    word: 0,
    char: -1,
    text: '',
    width: nominal,
    lineHeight: nominal,
    fontSize: nominal,
    padTop: 0,
    padBottom: 0,
    seed,
    frame,
    start,
    durationFrames: frames,
    fps,
    unit,
  });

  let s: UnitStyle = {};
  if (at !== undefined) {
    const p = progress(frame, at, inFrames);
    if (p < 1) s = inPreset.style(p, unitOf(at, inFrames));
  }
  if (exitAt !== undefined && frame >= exitAt) {
    const q = progress(frame, exitAt, outFrames);
    s = composeStyle(s, outPreset.style(q, unitOf(exitAt, outFrames)));
  }
  const hidden = (s.opacity ?? 1) <= 0.001;
  const directional = directionalBlur(s);
  return (
    <div
      style={{
        ...unitCss(s, {
          base: style,
          perspective: nominal * 5,
          directionalFilter: directional ? `url(#${filterId})` : undefined,
        }),
        transformOrigin: origin ?? s.origin ?? style?.transformOrigin,
        visibility: hidden ? 'hidden' : style?.visibility,
      }}>
      {directional ? (
        <svg width={0} height={0} style={{position: 'absolute'}} aria-hidden>
          <filter
            id={filterId}
            x="-50%"
            y="-50%"
            width="200%"
            height="200%"
            colorInterpolationFilters="sRGB">
            <feGaussianBlur
              stdDeviation={`${directional.x} ${directional.y}`}
            />
          </filter>
        </svg>
      ) : null}
      {children}
    </div>
  );
};
