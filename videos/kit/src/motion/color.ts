/**
 * Colour helpers for per-frame colour math. They read `#rgb`, `#rgba`,
 * `#rrggbb`, `#rrggbbaa`, `rgb()`, `rgba()` and `transparent`, and return
 * `rgba()` strings. Anything else throws, so a typo fails the render instead
 * of turning white.
 */
import {clamp01, mix} from './math';

export type RGBA = readonly [r: number, g: number, b: number, a: number];

const cache = new Map<string, RGBA>();

const HEX = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const FUNCTIONAL = /^rgba?\(\s*([^)]*)\)$/i;

/** One rgb() channel: a number 0..255 or a percentage. */
const channel = (part: string): number =>
  part.endsWith('%') ? (Number(part.slice(0, -1)) / 100) * 255 : Number(part);

/** An alpha value: a number 0..1 or a percentage. */
const alphaOf = (part: string): number =>
  part.endsWith('%') ? Number(part.slice(0, -1)) / 100 : Number(part);

const parseHex = (digits: string): RGBA => {
  const full =
    digits.length <= 4 ? Array.from(digits, c => c + c).join('') : digits;
  const byte = (i: number) => parseInt(full.slice(i, i + 2), 16);
  return [byte(0), byte(2), byte(4), full.length === 8 ? byte(6) / 255 : 1];
};

const parseFunctional = (body: string): RGBA | null => {
  // rgb(1, 2, 3), rgba(1, 2, 3, 0.5), rgb(1 2 3 / 50%)
  const [rgb = '', alphaPart] = body.split('/');
  const parts = rgb.split(/[\s,]+/).filter(Boolean);
  if (alphaPart !== undefined) {
    if (parts.length !== 3) return null;
    parts.push(alphaPart.trim());
  }
  if (parts.length !== 3 && parts.length !== 4) return null;
  const [r = NaN, g = NaN, b = NaN] = parts.slice(0, 3).map(channel);
  const a = parts[3] === undefined ? 1 : alphaOf(parts[3]);
  const out: RGBA = [r, g, b, a];
  return out.every(Number.isFinite) ? out : null;
};

/** The colour's channels (0..255) and alpha (0..1). Throws on unreadable input. */
export const parseColor = (input: string): RGBA => {
  const hit = cache.get(input);
  if (hit) return hit;
  const s = input.trim();
  let out: RGBA | null = null;
  if (s.toLowerCase() === 'transparent') out = [0, 0, 0, 0];
  else if (HEX.test(s)) out = parseHex(s.slice(1));
  else {
    const m = FUNCTIONAL.exec(s);
    if (m) out = parseFunctional(m[1] ?? '');
  }
  if (!out) {
    throw new Error(
      `[color] cannot read "${input}": use #hex, rgb(), rgba() or transparent`,
    );
  }
  cache.set(input, out);
  return out;
};

/** An `rgba()` string for channels and alpha. */
const rgba = ([r, g, b, a]: RGBA): string =>
  `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${Math.round(a * 1000) / 1000})`;

/** The colour with its alpha multiplied by `a`: `alpha(lane.red, 0.3)`. */
export const alpha = (c: string, a: number): string => {
  const [r, g, b, a0] = parseColor(c);
  return rgba([r, g, b, a0 * clamp01(a)]);
};

/** Mix of two colours, each sRGB channel and alpha interpolated linearly. */
export const mixColor = (a: string, b: string, t: number): string => {
  const ca = parseColor(a);
  const cb = parseColor(b);
  const k = clamp01(t);
  return rgba([
    mix(ca[0], cb[0], k),
    mix(ca[1], cb[1], k),
    mix(ca[2], cb[2], k),
    mix(ca[3], cb[3], k),
  ]);
};

/** Toward white by `t` (0..1). */
export const lighten = (c: string, t: number): string =>
  mixColor(c, '#ffffff', t);

/**
 * A colour keyed over frames, each key crossfading in over
 * `crossfadeFrames` from its frame: `colorAt(frame, [[0, lane.blue], [600, lane.yellow]], 18)`.
 * Keys must be in frame order.
 */
export const colorAt = (
  frame: number,
  keys: readonly (readonly [frame: number, color: string])[],
  crossfadeFrames: number,
): string => {
  const first = keys[0];
  if (!first) throw new Error('[color] colorAt needs at least one key');
  let current = rgba(parseColor(first[1]));
  for (let i = 1; i < keys.length; i++) {
    const [f, c] = keys[i] as readonly [number, string];
    if (frame < f) break;
    const t = crossfadeFrames <= 0 ? 1 : clamp01((frame - f) / crossfadeFrames);
    current = mixColor(current, c, t * t * (3 - 2 * t));
  }
  return current;
};
