import {Fragment, useMemo, type CSSProperties, type ReactNode} from 'react';
import {color as palette} from '../brand/tokens';
import {useGlobalFrame} from '../clock';
import {floatTransform} from '../fx/drift';
import {useFilterId} from '../fx/filterId';
import {useFormat} from '../format';
import {ease} from '../brand/ease';
import {mix, progress, type StaggerFrom} from '../motion';
import {tokenFontSpec} from './fit';
import {useFontsReady} from './fonts';
import {breakLines, charAdvances, measureWidth, type FontSpec} from './measure';
import {
  type EnterPresetName,
  type ExitPresetName,
  type KineticPreset,
  type SplitMode,
  type UnitContext,
} from './presets';
import {
  kineticSeed,
  kineticTimeline,
  tokenize,
  type KineticWord,
  type UnitTiming,
} from './timing';
import {resolveType, textStyle, type TypeInput} from './style';
import {
  composeStyle,
  directionalBlur,
  unitCss,
  type UnitStyle,
} from './unitStyle';

export interface CaretOptions {
  color?: string;
  /** Frames the caret keeps blinking after typing ends (default 1 s). */
  hideAfter?: number;
  /** Frames the caret shows (blinking) before typing starts (default 0.3 s). */
  lead?: number;
  /** Frames per blink (default 0.6 s). */
  blink?: number;
  /** 'bar' (thin) or 'block'. */
  shape?: 'bar' | 'block';
}

export interface FloatProps {
  /** Multiplier on the drift (default 1). */
  amount?: number;
  seed?: string | number;
}

export interface KineticTextProps {
  /**
   * A string (split on spaces; "\n" forces a line break) or explicit atomic
   * groups, e.g. ["Tool-assisted", "charting,", {text: "one step", style}].
   * A group never breaks inside, so "first-pass" stays whole.
   */
  text: string | readonly KineticWord[];
  /** A type token from the scale, or your own token (default 'h1'). Its size is reference px. */
  variant?: TypeInput;
  /** Font size, px (default: the token's size scaled to the format). */
  size?: number;
  weight?: number;
  /** em */
  tracking?: number;
  lineHeight?: number;
  color?: string;
  font?: 'sans' | 'mono';
  uppercase?: boolean;

  /** Wrap width, px. Lines are balanced (like text-wrap: balance). */
  maxWidth?: number;
  maxLines?: number;
  balance?: boolean;
  align?: 'left' | 'center' | 'right';
  /** Animate words or characters (default: the enter preset's preference). */
  split?: SplitMode;

  /** Enter preset (default 'maskUp'). Runs only if `enterAt` is set. */
  enter?: EnterPresetName | KineticPreset;
  /** Film frame the first unit starts, or one frame per unit (or per word in chars mode). */
  enterAt?: number | readonly number[];
  /** Frames between units (default: the preset's, converted with the fps). */
  stagger?: number;
  /** Frames per unit (default: the preset's). */
  duration?: number;
  order?: StaggerFrom;

  /** Exit preset (default 'maskUpOut'). Runs only if `exitAt` is set. */
  exit?: ExitPresetName | KineticPreset;
  exitAt?: number | readonly number[];
  exitStagger?: number;
  exitDuration?: number;
  exitOrder?: StaggerFrom;

  /** Variable-weight animation: the weight at the start of the enter (e.g. 300 -> the token's 760). */
  weightFrom?: number;
  /** The weight at the end of the exit. */
  weightTo?: number;

  /** Caret (default: on for 'typeOn'). */
  caret?: boolean | CaretOptions;
  /** A slow parallax float of the whole block, so a held line never sits dead still. */
  float?: boolean | FloatProps;
  /** Extra per-unit style every frame (e.g. a per-word beat pulse), added on top of the presets. */
  unitStyle?: (u: UnitContext) => UnitStyle;
  seed?: string;
  style?: CSSProperties;
  className?: string;
}

interface LaidWord {
  text: string;
  width: number;
  index: number;
  style: CSSProperties | undefined;
  chars: {text: string; width: number}[];
}

interface Layout {
  lines: LaidWord[][];
  measured: boolean;
}

const textKeyOf = (text: string | readonly KineticWord[]): string =>
  typeof text === 'string'
    ? text
    : text
        .map(w =>
          typeof w === 'string'
            ? w
            : `${w.text}\u0002${JSON.stringify(w.style ?? null)}`,
        )
        .join('\u0001');

/**
 * Kinetic typography. Splits text into words or characters, lays it out with
 * balanced line breaks and real kerning, and animates each unit with an enter
 * and an exit preset keyed to FILM frames. The timing is `kineticTimeline`'s,
 * so anything lined up with a line uses the same numbers.
 *
 * ```tsx
 * <KineticText text="Generate a tempo map from the audio" enterAt={f0} exitAt={f1} maxWidth={1100 * unit} />
 * <KineticText variant="display" text="Chart Editor" enter="flipUp" enterAt={f} weightFrom={420} />
 * <KineticText text={['Find', {text: 'Music', style: accentText}]} enter="blurRise" enterAt={[f, f + 8]}
 *   exit="blurLift" exitAt={f + 120} float />
 * ```
 */
export const KineticText: React.FC<KineticTextProps> = props => {
  const {
    text,
    variant = 'h1',
    maxWidth,
    maxLines,
    balance = true,
    align = 'left',
    enterAt,
    exitAt,
    weightFrom,
    weightTo,
    unitStyle,
    style,
    className,
  } = props;
  const frame = useGlobalFrame();
  const {fps, unit} = useFormat();
  const fontsReady = useFontsReady();
  const filterId = useFilterId('kt');
  const token = resolveType(variant);
  const size = props.size ?? token.size * unit;
  const restWeight = props.weight ?? token.weight;
  const tracking = props.tracking ?? token.tracking;
  const lineHeight = props.lineHeight ?? token.lineHeight;
  const familyName = props.font ?? token.family;
  const uppercase = props.uppercase ?? token.uppercase ?? false;
  const textColor = props.color ?? token.color ?? palette.text;
  const seed = props.seed ?? kineticSeed(text);

  const textKey = textKeyOf(text);
  const timing = useMemo(
    () =>
      kineticTimeline({
        text,
        fps,
        enter: props.enter,
        exit: props.exit,
        split: props.split,
        enterAt,
        stagger: props.stagger,
        duration: props.duration,
        order: props.order,
        exitAt,
        exitStagger: props.exitStagger,
        exitDuration: props.exitDuration,
        exitOrder: props.exitOrder,
        seed,
      }),
    // `textKey` stands for `text` and the strings for the frame lists:
    // arrays are usually new objects every render.
    [
      textKey,
      fps,
      props.enter,
      props.exit,
      props.split,
      String(enterAt),
      props.stagger,
      props.duration,
      props.order,
      String(exitAt),
      props.exitStagger,
      props.exitDuration,
      props.exitOrder,
      seed,
    ],
  );
  const {enter, exit, enterFrames, exitFrames} = timing;
  const splitChars = timing.split === 'chars';

  const spec = useMemo<FontSpec>(
    () =>
      tokenFontSpec(token, size, {
        font: familyName,
        weight: restWeight,
        tracking,
        uppercase,
      }),
    [token, size, restWeight, tracking, uppercase, familyName],
  );

  const layout = useMemo<Layout>(() => {
    let index = 0;
    const lines: LaidWord[][] = [];
    for (const words of tokenize(text)) {
      const laid: LaidWord[] = words.map(w => ({
        text: w.text,
        style: w.style,
        width: fontsReady ? measureWidth(w.text, spec) : 0,
        index: index++,
        chars: Array.from(w.text).map(c => ({text: c, width: 0})),
      }));
      if (fontsReady && splitChars) {
        for (const w of laid) {
          const adv = charAdvances(w.text, spec);
          w.chars = w.chars.map((c, i) => ({...c, width: adv[i] ?? 0}));
        }
      }
      if (fontsReady && maxWidth) {
        const space = measureWidth(' ', spec);
        const groups = breakLines(
          laid.map(w => w.width),
          space,
          maxWidth,
          {balance, maxLines},
        );
        for (const g of groups) lines.push(g.map(i => laid[i] as LaidWord));
      } else {
        lines.push(laid);
      }
    }
    return {lines, measured: fontsReady};
    // `textKey` stands for `text` (an array prop is a new object every render).
  }, [textKey, fontsReady, spec, maxWidth, maxLines, balance, splitChars]);

  const lh = size * lineHeight;
  const padTop = size * 0.16;
  const padBottom = size * 0.28;
  const padSide = size * 0.14;
  const perspective = size * 5;
  const unitCount = timing.units.length;
  const lineCount = layout.lines.length;

  const lockWidths =
    layout.measured &&
    (splitChars || weightFrom !== undefined || weightTo !== undefined);
  const caretOn =
    props.caret === undefined ? Boolean(enter.caret) : Boolean(props.caret);
  const caretOpts: CaretOptions =
    typeof props.caret === 'object' ? props.caret : {};

  // Every unit's enter and exit progress now, in reading order.
  const phases = timing.units.map(u => ({
    enterP: enterAt === undefined ? 1 : progress(frame, u.start, enterFrames),
    exitP: exitAt === undefined ? 0 : progress(frame, u.exitStart, exitFrames),
  }));
  // The caret sits after the last unit that has fully arrived.
  const visibleCount = phases.reduce(
    (n, p, i) => (p.enterP >= 1 ? i + 1 : n),
    0,
  );
  const exitStarted = phases.some(p => p.exitP > 0);
  // Each word's first unit, so a laid-out word finds its units.
  const firstUnit = new Map<number, number>();
  timing.units.forEach((u, i) => {
    if (!firstUnit.has(u.word)) firstUnit.set(u.word, i);
  });

  interface Rendered {
    /** Reading-order unit index. */
    index: number;
    node: ReactNode;
    /** The unit's directional-blur filter, when it has one. */
    filter: ReactNode;
    enterP: number;
    exitP: number;
  }

  const renderUnit = (
    i: number,
    t: string,
    width: number,
    line: number,
    word: LaidWord,
    char: number,
  ): Rendered => {
    const u = timing.units[i] as UnitTiming;
    const {enterP, exitP} = phases[i] ?? {enterP: 1, exitP: 0};

    const ctx: UnitContext = {
      index: i,
      count: unitCount,
      line,
      lineCount,
      word: word.index,
      char,
      text: t,
      width,
      lineHeight: lh,
      fontSize: size,
      padTop,
      padBottom,
      seed,
      frame,
      start: u.start,
      durationFrames: enterFrames,
      fps,
      unit,
    };
    let s: UnitStyle = enterP < 1 ? enter.style(enterP, ctx) : {};
    if (exitP > 0)
      s = composeStyle(
        s,
        exit.style(exitP, {
          ...ctx,
          start: u.exitStart,
          durationFrames: exitFrames,
        }),
      );
    if (unitStyle) s = composeStyle(s, unitStyle(ctx));
    let weight = s.weight;
    if (weightFrom !== undefined && enterP < 1)
      weight = mix(weightFrom, restWeight, ease.enter(enterP));
    if (weightTo !== undefined && exitP > 0)
      weight = mix(weight ?? restWeight, weightTo, ease.exit(exitP));

    const blur = directionalBlur(s);
    const id = `${filterId}u${i}`;
    const boxW = Math.max(1, width || size * 0.6);
    const filter = blur ? (
      <filter
        key={id}
        id={id}
        x={-(3 * blur.x) / boxW}
        y={-(3 * blur.y) / lh}
        width={1 + (6 * blur.x) / boxW}
        height={1 + (6 * blur.y) / lh}
        colorInterpolationFilters="sRGB">
        <feGaussianBlur stdDeviation={`${blur.x} ${blur.y}`} />
      </filter>
    ) : null;
    const directionalFilter = blur ? `url(#${id})` : undefined;

    const node = (
      <span
        key={i}
        style={{
          display: 'inline-block',
          whiteSpace: 'pre',
          width: lockWidths && width > 0 ? width : undefined,
          textAlign: lockWidths && !splitChars ? 'center' : undefined,
          ...unitCss(
            {...s, weight},
            {base: word.style, perspective, directionalFilter},
          ),
        }}>
        {s.glyph ?? t}
      </span>
    );
    return {index: i, node, filter, enterP, exitP};
  };

  const lineNodes = layout.lines.map((line, li) =>
    line.map((w, wi) => {
      const first = firstUnit.get(w.index) ?? 0;
      const rendered: Rendered[] = splitChars
        ? w.chars.map((c, ci) =>
            renderUnit(first + ci, c.text, c.width, li, w, ci),
          )
        : [renderUnit(first, w.text, w.width, li, w, -1)];
      const masking =
        (enter.mask && rendered.some(r => r.enterP < 1)) ||
        (exit.mask && rendered.some(r => r.exitP > 0));
      return {rendered, masking, key: `${li}-${wi}`};
    }),
  );

  const filters = lineNodes.flatMap(words =>
    words.flatMap(w => w.rendered.map(r => r.filter).filter(Boolean)),
  );

  // Caret: after the last fully typed unit.
  let caretAfter = -2;
  let caretVisible = false;
  if (caretOn && enterAt !== undefined && !exitStarted) {
    const lead = caretOpts.lead ?? 0.3 * fps;
    const hideAfter = caretOpts.hideAfter ?? fps;
    const blink = caretOpts.blink ?? 0.6 * fps;
    const lastStart = Math.max(...timing.units.map(u => u.start));
    const typingEnd = lastStart + Math.max(enterFrames, 1);
    const firstStart = timing.firstStart;
    if (frame >= firstStart - lead && frame < typingEnd + hideAfter) {
      caretAfter = visibleCount - 1;
      const typing = frame >= firstStart && frame < typingEnd;
      const blinkRef = frame < firstStart ? firstStart - lead : typingEnd;
      caretVisible =
        typing || Math.floor((frame - blinkRef) / (blink / 2)) % 2 === 0;
    }
  }
  const caretColor = caretOpts.color ?? textColor;
  const caretNode = (key: string) => (
    <span
      key={key}
      style={{
        display: 'inline-block',
        width: 0,
        height: lh,
        verticalAlign: 'top',
        position: 'relative',
      }}>
      <span
        style={{
          position: 'absolute',
          left: size * 0.06,
          top: (lh - size * 0.92) / 2,
          width:
            caretOpts.shape === 'block'
              ? size * 0.56
              : Math.max(2 * unit, size * 0.09),
          height: size * 0.92,
          background: caretColor,
          opacity: caretVisible ? 1 : 0,
          borderRadius: unit,
        }}
      />
    </span>
  );

  const floatOpts =
    props.float === undefined || props.float === false
      ? null
      : props.float === true
        ? {}
        : props.float;
  const drift = floatOpts
    ? floatTransform(
        frame,
        {fps, unit},
        {amount: floatOpts.amount, seed: floatOpts.seed ?? textKey},
      )
    : undefined;
  const transform =
    [style?.transform, drift].filter(Boolean).join(' ') || undefined;

  return (
    <div
      className={className}
      style={textStyle(
        {
          ...token,
          family: familyName,
          weight: restWeight,
          tracking,
          lineHeight,
          uppercase,
          color: textColor,
        },
        unit,
        {fontSize: size, maxWidth, position: 'relative', ...style, transform},
      )}>
      {lineNodes.map((words, li) => (
        <div key={li} style={{whiteSpace: 'pre', textAlign: align, height: lh}}>
          {caretAfter === -1 && li === 0 ? caretNode('caret') : null}
          {words.map((w, wi) => (
            <Fragment key={w.key}>
              {wi > 0 ? ' ' : null}
              <span
                style={{
                  display: 'inline-block',
                  verticalAlign: 'top',
                  overflow: w.masking ? 'hidden' : 'visible',
                  padding: `${padTop}px ${padSide}px ${padBottom}px`,
                  margin: `-${padTop}px -${padSide}px -${padBottom}px`,
                }}>
                {w.rendered.map(r => (
                  <Fragment key={r.index}>
                    {r.node}
                    {r.index === caretAfter ? caretNode('caret') : null}
                  </Fragment>
                ))}
              </span>
            </Fragment>
          ))}
        </div>
      ))}
      {filters.length > 0 ? (
        <svg width={0} height={0} style={{position: 'absolute'}} aria-hidden>
          <defs>{filters}</defs>
        </svg>
      ) : null}
    </div>
  );
};
