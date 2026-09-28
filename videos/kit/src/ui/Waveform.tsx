import {useLayoutEffect, useRef, type CSSProperties} from 'react';
import {color} from '../brand/tokens';
import {useFormat} from '../format';
import {useTimeline} from '../music';

export interface WaveBar {
  /** Left edge in px within the waveform box. */
  x: number;
  /** Amplitude 0..1 after gain and gamma. */
  amp: number;
  /** Start of the bar's slot, song seconds. */
  tSec: number;
}

/**
 * The bars a waveform draws over song seconds [startSec, endSec] into
 * `width` px. Each bar owns a fixed slot of TIME (not of screen), so when
 * the window scrolls the bars slide smoothly instead of re-binning and
 * shimmering.
 */
export const waveformBars = (opts: {
  peaks: readonly number[];
  /** Peak bins per second. */
  rate: number;
  startSec: number;
  endSec: number;
  width: number;
  /** Bar width plus gap, px. */
  pitch: number;
  gain?: number;
  gamma?: number;
  slotSec?: number;
}): WaveBar[] => {
  const {peaks, rate, startSec: t0, endSec: t1, width, pitch} = opts;
  const pxPerSec = width / Math.max(1e-6, t1 - t0);
  const slot = opts.slotSec ?? pitch / pxPerSec;
  const gain = opts.gain ?? 1;
  const gamma = opts.gamma ?? 0.75;
  const k0 = Math.floor(t0 / slot) - 1;
  const k1 = Math.ceil(t1 / slot) + 1;
  const out: WaveBar[] = [];
  for (let k = k0; k <= k1; k++) {
    const ts = k * slot;
    const i0 = Math.max(0, Math.floor(ts * rate));
    const i1 = Math.min(
      peaks.length,
      Math.max(i0 + 1, Math.ceil((ts + slot) * rate)),
    );
    let m = 0;
    for (let i = i0; i < i1; i++) m = Math.max(m, peaks[i] as number);
    out.push({
      x: (ts - t0) * pxPerSec,
      amp: Math.pow(Math.min(1, m * gain), gamma),
      tSec: ts,
    });
  }
  return out;
};

/** First and last-plus-one bin of `peaks` (at `rate` bins per second) inside [fromSec, toSec). */
const binRange = (
  peaks: readonly number[],
  rate: number,
  fromSec: number,
  toSec: number,
): [number, number] => [
  Math.max(0, Math.floor(fromSec * rate)),
  Math.min(peaks.length, Math.ceil(toSec * rate)),
];

/** A copy of `peaks` (at `rate` bins per second) with every bin outside [fromSec, toSec) zeroed. */
export const clipPeaks = (
  peaks: readonly number[],
  rate: number,
  fromSec: number,
  toSec: number,
): number[] => {
  const out = new Array<number>(peaks.length).fill(0);
  const [a, b] = binRange(peaks, rate, fromSec, toSec);
  for (let i = a; i < b; i++) out[i] = peaks[i] as number;
  return out;
};

/** The loudest bin of `peaks` (at `rate` bins per second) inside [fromSec, toSec), 0 if none. */
export const peakMax = (
  peaks: readonly number[],
  rate: number,
  fromSec: number,
  toSec: number,
): number => {
  const [a, b] = binRange(peaks, rate, fromSec, toSec);
  let m = 0;
  for (let i = a; i < b; i++) m = Math.max(m, peaks[i] as number);
  return m;
};

interface WaveformLook {
  /** Visible window, song seconds: the left edge and the right edge. */
  startSec: number;
  endSec: number;
  width: number;
  height: number;
  /** Bar width and gap, px (default 3 and 2 reference px). */
  barWidth?: number;
  barGap?: number;
  /** Fixed seconds per bar (keeps bars stable while zooming). */
  slotSec?: number;
  /** Mirror around the centre line (default true). */
  mirror?: boolean;
  /** Colours from the centre line to the bar tips (default white -> purple). */
  colors?: readonly [center: string, edge: string];
  /** Split at this x (px in the box): left of it uses `playedColors`, right uses `colors` at `unplayedAlpha`. */
  playheadX?: number;
  playedColors?: readonly [center: string, edge: string];
  unplayedAlpha?: number;
  gain?: number;
  gamma?: number;
  /** Minimum bar half-height, px, so silence draws a hairline (default 0.75 reference px). */
  minHeight?: number;
  /** 0..1: draw only the middle fraction of the width (a line growing out from the centre). */
  reveal?: number;
  /** Fade bars out over this many px at the left and right edges. */
  fadeEdges?: number;
  style?: CSSProperties;
}

/**
 * Either your own peak array (`peaks` at `rate` bins per second), or a stem
 * of the timeline's peaks (`stem`, default 'mix', which needs a timeline
 * provider above).
 */
export type WaveformProps = WaveformLook &
  (
    | {peaks: readonly number[]; rate: number; stem?: never}
    | {stem?: string; peaks?: never; rate?: never}
  );

const WaveformCanvas: React.FC<
  WaveformLook & {peaks: readonly number[]; rate: number}
> = ({
  peaks,
  rate,
  startSec,
  endSec,
  width,
  height,
  barWidth,
  barGap,
  slotSec,
  mirror = true,
  colors = [color.white, color.purple],
  playheadX,
  playedColors,
  unplayedAlpha = 0.42,
  gain = 1,
  gamma = 0.75,
  minHeight,
  reveal = 1,
  fadeEdges = 0,
  style,
}) => {
  const ref = useRef<HTMLCanvasElement>(null);
  const {unit} = useFormat();
  const bw = barWidth ?? 3 * unit;
  const gap = barGap ?? 2 * unit;
  const floor = minHeight ?? 0.75 * unit;
  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;

  useLayoutEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const bars = waveformBars({
      peaks,
      rate,
      startSec,
      endSec,
      width,
      pitch: bw + gap,
      gain,
      gamma,
      slotSec,
    });
    const mid = mirror ? height / 2 : height;
    const maxH = mirror ? height / 2 : height;
    const half = (reveal * width) / 2;
    const cx = width / 2;
    const gradient = (c: readonly [string, string]) => {
      const g = ctx.createLinearGradient(0, 0, 0, height);
      if (mirror) {
        g.addColorStop(0, c[1]);
        g.addColorStop(0.5, c[0]);
        g.addColorStop(1, c[1]);
      } else {
        g.addColorStop(0, c[1]);
        g.addColorStop(1, c[0]);
      }
      return g;
    };
    const draw = (
      fill: CanvasGradient,
      alpha: number,
      clipLeft: number,
      clipRight: number,
    ) => {
      ctx.save();
      ctx.beginPath();
      ctx.rect(clipLeft, 0, clipRight - clipLeft, height);
      ctx.clip();
      ctx.fillStyle = fill;
      for (const b of bars) {
        if (b.x + bw < 0 || b.x > width) continue;
        const center = b.x + bw / 2;
        if (Math.abs(center - cx) > half) continue;
        let a = alpha;
        if (fadeEdges > 0)
          a *= Math.min(
            1,
            Math.max(0, center / fadeEdges),
            Math.max(0, (width - center) / fadeEdges),
          );
        if (a <= 0.003) continue;
        const h = Math.max(floor, b.amp * maxH);
        const r = Math.min(bw / 2, h);
        ctx.globalAlpha = a;
        ctx.beginPath();
        if (mirror) ctx.roundRect(b.x, mid - h, bw, 2 * h, r);
        else ctx.roundRect(b.x, mid - h, bw, h, [r, r, 0, 0]);
        ctx.fill();
      }
      ctx.restore();
    };
    if (playheadX === undefined) {
      draw(gradient(colors), 1, 0, width);
    } else {
      draw(gradient(colors), unplayedAlpha, playheadX, width);
      draw(gradient(playedColors ?? colors), 1, 0, playheadX);
    }
  });

  return (
    <canvas
      ref={ref}
      width={Math.round(width * dpr)}
      height={Math.round(height * dpr)}
      style={{width, height, display: 'block', ...style}}
    />
  );
};

const TimelineWaveform: React.FC<WaveformLook & {stem: string}> = ({
  stem,
  ...look
}) => {
  const {peaks} = useTimeline();
  if (!peaks)
    throw new Error(
      '[Waveform] the timeline has no peaks; pass `peaks` and `rate`, or load a timeline with peaks',
    );
  const data = peaks.stems[stem];
  if (!data)
    throw new Error(
      `[Waveform] the timeline's peaks have no stem "${stem}" (it has ${Object.keys(peaks.stems).join(', ')})`,
    );
  return <WaveformCanvas {...look} peaks={data} rate={peaks.rate} />;
};

/**
 * A waveform as mirrored rounded bars on a canvas, white -> purple, split
 * colours at `playheadX`. A pure function of its props (redrawn every frame,
 * ~0.2 ms for 400 bars). With `peaks` it never touches the timeline.
 */
export const Waveform: React.FC<WaveformProps> = props =>
  props.peaks !== undefined ? (
    <WaveformCanvas {...props} peaks={props.peaks} rate={props.rate} />
  ) : (
    <TimelineWaveform {...props} stem={props.stem ?? 'mix'} />
  );
