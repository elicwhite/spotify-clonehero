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
 * Asserted from the compiled stylesheet rather than from a class list — see
 * `tailwindContrast.ts` for why.
 */

import {render, screen} from '@testing-library/react';

import ContextMenuPopover from '../ContextMenuPopover';
import {
  compile,
  contrast,
  hslTokenToRgb,
  declaration,
  textColor,
  themeColor,
} from './tailwindContrast';

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
      const text = textColor(root, selector, theme);
      expect(
        contrast(text, themeColor(root, '--popover', theme)),
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrast(text, themeColor(root, '--accent', theme)),
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
