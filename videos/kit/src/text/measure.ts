/**
 * Text measurement and line breaking for kinetic type.
 *
 * Measurements use a hidden DOM span with exactly the CSS the text renders
 * with (so Inter's optical size, kerning and tracking all count), and are
 * cached only once the fonts have loaded. `breakLines` is pure.
 */
import {areFontsLoaded} from './fontState';

export interface FontSpec {
  /** CSS font-family list. */
  family: string;
  /** px */
  size: number;
  weight: number;
  /** em */
  tracking: number;
  uppercase?: boolean;
  /** CSS font-feature-settings. */
  features?: string;
}

const cache = new Map<string, number>();
let probe: HTMLSpanElement | null = null;

const getProbe = (): HTMLSpanElement | null => {
  if (typeof document === 'undefined') return null;
  if (probe && probe.isConnected) return probe;
  probe = document.createElement('span');
  const s = probe.style;
  s.position = 'absolute';
  s.left = '-100000px';
  s.top = '0';
  s.visibility = 'hidden';
  s.whiteSpace = 'pre';
  s.pointerEvents = 'none';
  s.fontKerning = 'normal';
  s.fontOpticalSizing = 'auto';
  s.setProperty('text-rendering', 'geometricPrecision');
  document.body.appendChild(probe);
  return probe;
};

/**
 * Advance width of `text` in px, including tracking after every glyph.
 * Without a DOM (Node) it estimates 0.55 em per character.
 */
export const measureWidth = (text: string, f: FontSpec): number => {
  const key = `${f.family}|${f.size}|${f.weight}|${f.tracking}|${f.uppercase ? 1 : 0}|${f.features ?? ''}|${text}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const el = getProbe();
  if (!el) return text.length * f.size * 0.55;
  const s = el.style;
  s.fontFamily = f.family;
  s.fontSize = `${f.size}px`;
  s.fontWeight = String(f.weight);
  s.letterSpacing = `${f.tracking}em`;
  s.textTransform = f.uppercase ? 'uppercase' : 'none';
  s.fontFeatureSettings = f.features ?? 'normal';
  el.textContent = text;
  const w = el.getBoundingClientRect().width;
  if (areFontsLoaded()) cache.set(key, w);
  return w;
};

/**
 * Per-character advances with kerning folded in: box i is as wide as the
 * distance from glyph i to glyph i+1 in the kerned run. Laying the boxes out
 * side by side reproduces the unsplit text exactly, so splitting a word into
 * animated characters keeps its kerning.
 */
export const charAdvances = (word: string, f: FontSpec): number[] => {
  const out: number[] = [];
  let prev = 0;
  let prefix = '';
  for (const c of Array.from(word)) {
    prefix += c;
    const w = measureWidth(prefix, f);
    out.push(w - prev);
    prev = w;
  }
  return out;
};

/** Two widths closer than this are the same width. */
const WIDTH_EPSILON = 0.01;

/**
 * Break words into lines no wider than `maxWidth` and return the word
 * indices of each line. Words are atomic, so "first-pass" never splits.
 *
 * The line count is the fewest that fit (the greedy count), capped at
 * `maxLines`. Unbalanced (`balance: false`), lines fill greedily and the
 * last line takes whatever `maxLines` leaves over. Balanced (the default),
 * like CSS `text-wrap: balance`:
 * 1. the widest line is as narrow as it can be;
 * 2. among the breaks that achieve it, the line widths are the most even
 *    (the smallest sum of squared widths; every break of n words into k
 *    lines has the same total width);
 * 3. a remaining tie breaks each line as late as possible, so earlier lines
 *    are the longer ones.
 */
export const breakLines = (
  widths: readonly number[],
  spaceWidth: number,
  maxWidth: number,
  opts: {balance?: boolean; maxLines?: number} = {},
): number[][] => {
  const n = widths.length;
  if (n === 0) return [];
  const prefix = [0];
  for (const w of widths)
    prefix.push((prefix[prefix.length - 1] as number) + w);
  /** Width of the line holding words a..b inclusive. */
  const lineWidth = (a: number, b: number) =>
    (prefix[b + 1] as number) - (prefix[a] as number) + spaceWidth * (b - a);
  const maxLines = Math.max(1, opts.maxLines ?? Infinity);

  // The fewest lines that fit.
  let lines = 1;
  let start = 0;
  for (let i = 1; i < n; i++) {
    if (lineWidth(start, i) > maxWidth) {
      lines++;
      start = i;
    }
  }
  lines = Math.min(lines, maxLines);

  if (opts.balance === false || lines === 1) {
    const out: number[][] = [[]];
    let s = 0;
    for (let i = 0; i < n; i++) {
      if (i > s && lineWidth(s, i) > maxWidth && out.length < maxLines) {
        out.push([]);
        s = i;
      }
      (out[out.length - 1] as number[]).push(i);
    }
    return out;
  }

  const widest = narrowestWidestLine(lineWidth, n, lines);
  return mostEvenBreak(lineWidth, n, lines, widest + WIDTH_EPSILON);
};

type LineWidth = (a: number, b: number) => number;

/** Words 0..n-1 as `lines` lines: the least possible width of the widest line. */
const narrowestWidestLine = (
  lineWidth: LineWidth,
  n: number,
  lines: number,
): number => {
  // best[i]: the least widest line setting the first i words on k lines.
  let best = new Array<number>(n + 1).fill(Infinity);
  best[0] = 0;
  for (let k = 1; k <= lines; k++) {
    const next = new Array<number>(n + 1).fill(Infinity);
    for (let i = k; i <= n; i++) {
      for (let j = k - 1; j < i; j++) {
        const prev = best[j] as number;
        if (prev === Infinity) continue;
        const cost = Math.max(prev, lineWidth(j, i - 1));
        if (cost < (next[i] as number)) next[i] = cost;
      }
    }
    best = next;
  }
  return best[n] as number;
};

/**
 * Words 0..n-1 as `lines` lines no wider than `limit`, with the smallest sum
 * of squared line widths; ties break each line as late as possible.
 */
const mostEvenBreak = (
  lineWidth: LineWidth,
  n: number,
  lines: number,
  limit: number,
): number[][] => {
  // cost[k][i]: least sum of squares setting the first i words on k lines;
  // cut[k][i]: where that k-th line starts.
  const cost = Array.from({length: lines + 1}, () =>
    new Array<number>(n + 1).fill(Infinity),
  );
  const cut = Array.from({length: lines + 1}, () =>
    new Array<number>(n + 1).fill(-1),
  );
  (cost[0] as number[])[0] = 0;
  for (let k = 1; k <= lines; k++) {
    const row = cost[k] as number[];
    const cutRow = cut[k] as number[];
    for (let i = k; i <= n; i++) {
      for (let j = k - 1; j < i; j++) {
        const prev = (cost[k - 1] as number[])[j] as number;
        if (prev === Infinity) continue;
        const w = lineWidth(j, i - 1);
        if (w > limit) continue;
        const c = prev + w * w;
        const cur = row[i] as number;
        // Later starts win ties (j rises through the loop).
        if (c <= cur + Math.max(1, cur) * 1e-9) {
          row[i] = c;
          cutRow[i] = j;
        }
      }
    }
  }
  const out: number[][] = [];
  let i = n;
  for (let k = lines; k >= 1; k--) {
    const j = (cut[k] as number[])[i] as number;
    out.unshift(Array.from({length: i - j}, (_, q) => j + q));
    i = j;
  }
  return out;
};
