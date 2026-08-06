/**
 * Contrast measurement against the app's COMPILED stylesheet.
 *
 * Colour bugs in this app are invisible in the source — the class name looks
 * right and the emitted colour is unreadable — and jsdom's
 * `getComputedStyle` cannot resolve the `var()` chain the theme is built
 * from. So a contrast test compiles `app/globals.css` with the real Tailwind
 * config and reads the declarations back out.
 *
 * `darkMode` is `media` in this app, so both themes' values live in the same
 * stylesheet and {@link declaration} picks a theme by whether the rule sits
 * inside the `prefers-color-scheme: dark` block.
 */

import path from 'node:path';
import fs from 'node:fs';

import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import type {Config} from 'tailwindcss';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const GLOBALS_CSS = path.join(REPO_ROOT, 'app/globals.css');
const tailwindConfig = require(
  path.join(REPO_ROOT, 'tailwind.config.js'),
) as Config;

export type Rgb = [number, number, number];

/** WCAG 2.1 relative luminance. */
function luminance([r, g, b]: Rgb): number {
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio between two colours, order-independent. */
export function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** `0 0% 9%` (the shape every theme token in `globals.css` uses) to RGB. */
export function hslTokenToRgb(token: string): Rgb {
  const [h, s, l] = token
    .trim()
    .split(/\s+/)
    .map(part => Number.parseFloat(part));
  const sat = s / 100;
  const lum = l / 100;
  const c = (1 - Math.abs(2 * lum - 1)) * sat;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = lum - c / 2;
  const sector = Math.floor(h / 60) % 6;
  const [r, g, b] = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ][sector];
  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ];
}

/** `rgb(248 113 113 / var(--tw-text-opacity))` to RGB. */
export function tailwindColorToRgb(value: string): Rgb {
  const match = value.match(/rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/);
  if (!match) throw new Error(`not an rgb colour: ${value}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** Compile `globals.css` with only `classNames` in the content set, so the
 *  result carries exactly the utilities under test. */
export async function compile(classNames: string[]): Promise<postcss.Root> {
  const result = await postcss([
    tailwindcss({
      ...tailwindConfig,
      content: [{raw: classNames.join(' '), extension: 'html'}],
    }),
  ]).process(fs.readFileSync(GLOBALS_CSS, 'utf8'), {from: GLOBALS_CSS});
  return result.root;
}

/** Tailwind escapes `[`, `:`, `.` and `&` in generated selectors. */
function unescapeSelector(selector: string): string {
  return selector.replace(/\\/g, '');
}

/**
 * A declaration's value, read from either the top-level rules or from inside
 * the `prefers-color-scheme: dark` block.
 */
export function declaration(
  root: postcss.Root,
  selector: string,
  prop: string,
  theme: 'light' | 'dark',
): string | undefined {
  let found: string | undefined;
  root.walkRules(rule => {
    const inDark = (() => {
      let node: postcss.Container | undefined = rule.parent as
        | postcss.Container
        | undefined;
      while (node) {
        if (
          node.type === 'atrule' &&
          (node as postcss.AtRule).params.includes('prefers-color-scheme: dark')
        ) {
          return true;
        }
        node = node.parent as postcss.Container | undefined;
      }
      return false;
    })();
    if (inDark !== (theme === 'dark')) return;
    if (!rule.selectors.some(s => unescapeSelector(s) === selector)) return;
    rule.walkDecls(prop, decl => {
      found = decl.value;
    });
  });
  return found;
}

/**
 * The colour a utility class emits for a theme, as RGB. Throws when the
 * class emitted no `color` declaration — which is itself the bug worth
 * catching, since a misspelled or non-existent utility renders as nothing.
 */
export function textColor(
  root: postcss.Root,
  selector: string,
  theme: 'light' | 'dark',
): Rgb {
  const value = declaration(root, selector, 'color', theme);
  if (value === undefined) {
    throw new Error(`no color declaration for ${selector} (${theme})`);
  }
  return tailwindColorToRgb(value);
}

/** A theme token (`--background`, `--popover`, …) as RGB. */
export function themeColor(
  root: postcss.Root,
  token: string,
  theme: 'light' | 'dark',
): Rgb {
  const value = declaration(root, ':root', token, theme);
  if (value === undefined) {
    throw new Error(`no ${token} token for ${theme}`);
  }
  return hslTokenToRgb(value);
}
