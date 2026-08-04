/**
 * @jest-environment jsdom
 */
/**
 * Contrast pin for the editor context menu's destructive items.
 *
 * The Chart Matrix menu marks every item `danger`, so this colour decides
 * whether the whole menu is readable. `text-destructive` is not usable for it:
 * `--destructive` is a *fill* in this theme (a red button behind white text),
 * and its dark value `0 62.8% 30.6%` sits at 1.79:1 on the `0 0% 9%` popover.
 *
 * Asserted from the compiled stylesheet rather than from a class list, because
 * the failure was invisible in the source (the class name looked right and
 * the emitted colour was unreadable) and jsdom's `getComputedStyle` cannot
 * resolve the `var()` the theme is built from.
 */

import path from 'node:path';
import fs from 'node:fs';

import {render, screen} from '@testing-library/react';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import type {Config} from 'tailwindcss';

import ContextMenuPopover from '../ContextMenuPopover';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const GLOBALS_CSS = path.join(REPO_ROOT, 'app/globals.css');
const tailwindConfig = require(
  path.join(REPO_ROOT, 'tailwind.config.js'),
) as Config;

type Rgb = [number, number, number];

/** WCAG 2.1 relative luminance. */
function luminance([r, g, b]: Rgb): number {
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** `0 0% 9%` (the shape every theme token in `globals.css` uses) to RGB. */
function hslTokenToRgb(token: string): Rgb {
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
function tailwindColorToRgb(value: string): Rgb {
  const match = value.match(/rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/);
  if (!match) throw new Error(`not an rgb colour: ${value}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

async function compile(classNames: string[]): Promise<postcss.Root> {
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
 * the `prefers-color-scheme: dark` block. `darkMode` is `media` in this app,
 * so both themes' values live in the same stylesheet.
 */
function declaration(
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

/** The classes a destructive menu item actually renders with. */
function dangerItemClasses(): string[] {
  render(
    <ContextMenuPopover
      x={0}
      y={0}
      items={[{label: 'Delete instrument', danger: true, onSelect: () => {}}]}
    />,
  );
  return Array.from(
    screen.getByRole('button', {name: 'Delete instrument'}).classList,
  );
}

describe('context menu destructive items', () => {
  it('clears 4.5:1 against the popover and the hover fill in both themes', async () => {
    const classes = dangerItemClasses();
    const root = await compile(classes);

    const themes = [
      {theme: 'light' as const, selector: '.text-red-700'},
      {theme: 'dark' as const, selector: '.dark:text-red-400'},
    ];

    for (const {theme, selector} of themes) {
      const colorValue = declaration(root, selector, 'color', theme);
      expect(colorValue).toBeDefined();
      const text = tailwindColorToRgb(colorValue as string);

      const popover = declaration(root, ':root', '--popover', theme);
      const accent = declaration(root, ':root', '--accent', theme);
      expect(popover).toBeDefined();
      expect(accent).toBeDefined();

      expect(
        contrast(text, hslTokenToRgb(popover as string)),
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrast(text, hslTokenToRgb(accent as string)),
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('would fail with `text-destructive`, which is why it is not used', async () => {
    // The regression this pins, stated as a measurement: `--destructive` on
    // `--popover` is 1.79:1 in dark mode.
    const root = await compile(['text-destructive']);
    const destructive = declaration(root, ':root', '--destructive', 'dark');
    const popover = declaration(root, ':root', '--popover', 'dark');

    expect(
      contrast(
        hslTokenToRgb(destructive as string),
        hslTokenToRgb(popover as string),
      ),
    ).toBeLessThan(2);
  });

  it('keeps the danger colour on hover, over the accent fill', () => {
    // The base class list sets `hover:text-accent-foreground`; without an
    // explicit hover spelling the item would turn grey under the cursor and
    // stop reading as destructive.
    const classes = dangerItemClasses();
    expect(classes).toContain('hover:text-red-700');
    expect(classes).toContain('dark:hover:text-red-400');
  });
});
