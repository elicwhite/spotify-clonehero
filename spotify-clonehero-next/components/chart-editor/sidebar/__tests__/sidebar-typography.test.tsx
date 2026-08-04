/**
 * @jest-environment jsdom
 */
/**
 * Compiled-CSS pins for plan 0077 items 3 and 4: the sidebar section heading's
 * type scale, and the icon size inside Chart Assist card action buttons.
 *
 * These assert against the CSS Tailwind actually emits for the classes the
 * components actually render, because both bugs were classes that compiled to
 * the wrong declaration (or to nothing at all) while looking correct in the
 * source. A class-presence test would have passed the whole time.
 *
 * jsdom's `getComputedStyle` cannot resolve `var()`, so the var-backed values
 * are asserted at the two places that decide them: the utility's declaration
 * and the `:root[data-density='compact']` token block. Manual verification:
 * open a chart editor page, inspect a sidebar `h3` (expect font-size 11px,
 * uppercase, letter-spacing 0.66px) and a Chart Assist action button's svg
 * (expect a 12px box inside a 24px button).
 */

import path from 'node:path';
import fs from 'node:fs';

import {render, screen} from '@testing-library/react';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import type {Config} from 'tailwindcss';
import {Clock} from 'lucide-react';

import {Button} from '@/components/ui/button';
import SectionHeading from '../SectionHeading';
import {CardAction} from '../CardShell';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const GLOBALS_CSS = path.join(REPO_ROOT, 'app/globals.css');
const tailwindConfig = require(
  path.join(REPO_ROOT, 'tailwind.config.js'),
) as Config;

/**
 * Compiles the project's real stylesheet with the project's real Tailwind
 * config, generating utilities for exactly `classNames` — the strings the
 * rendered components carry — so the result is what a browser would receive.
 */
async function compile(classNames: string[]): Promise<postcss.Root> {
  const result = await postcss([
    tailwindcss({
      ...tailwindConfig,
      content: [{raw: classNames.join(' '), extension: 'html'}],
    }),
  ]).process(fs.readFileSync(GLOBALS_CSS, 'utf8'), {from: GLOBALS_CSS});
  return result.root;
}

/** Tailwind escapes `[`, `:`, `.` and encodes `,` as `\2c `. */
function unescapeSelector(selector: string): string {
  return selector.replace(/\\2c\s/g, ',').replace(/\\/g, '');
}

/**
 * Every declaration Tailwind emitted for one class, keyed by property. When
 * `descendant` is given, only rules targeting that descendant are read (the
 * `[&_svg]:*` arbitrary variants).
 */
function declarationsFor(
  root: postcss.Root,
  className: string,
  descendant?: string,
): Record<string, string> {
  const wanted = descendant ? `.${className} ${descendant}` : `.${className}`;
  const out: Record<string, string> = {};
  root.walkRules(rule => {
    const matches = rule.selectors.some(
      selector => unescapeSelector(selector) === wanted,
    );
    if (!matches) return;
    rule.walkDecls(decl => {
      out[decl.prop] = decl.value;
    });
  });
  return out;
}

/** Declarations on the editor density scope's token block. */
function densityTokens(root: postcss.Root): Record<string, string> {
  const out: Record<string, string> = {};
  root.walkRules(rule => {
    if (!rule.selector.includes("[data-density='compact']")) return;
    rule.walkDecls(decl => {
      out[decl.prop] = decl.value;
    });
  });
  return out;
}

function classesOf(element: Element): string[] {
  return Array.from(element.classList);
}

describe('sidebar section heading typography (plan 0077 item 3)', () => {
  it('compiles to a font size, not a colour, and to the 11px label token', async () => {
    render(<SectionHeading title="Chart Assist" />);
    const heading = screen.getByRole('heading', {name: 'Chart Assist'});
    const classes = classesOf(heading);

    const root = await compile(classes);

    const sizeClass = classes.find(name => name.startsWith('text-['));
    expect(sizeClass).toBeDefined();
    const sizeDecls = declarationsFor(root, sizeClass as string);

    // The regression: `text-[var(--x)]` is ambiguous and Tailwind resolves an
    // untyped `var()` to the colour plugin, emitting `color:` and leaving the
    // heading at the inherited 16px body size.
    expect(sizeDecls['color']).toBeUndefined();
    expect(sizeDecls['font-size']).toBe('var(--ed-text-label,0.6875rem)');

    // 11px is both the no-scope fallback above and the compact token below,
    // so the heading is 11px whether or not an editor is mounted.
    expect(densityTokens(root)['--ed-text-label']).toBe('0.6875rem');

    const uppercase = classes.find(name => name === 'uppercase');
    expect(declarationsFor(root, uppercase as string)['text-transform']).toBe(
      'uppercase',
    );

    const tracking = classes.find(name => name.startsWith('tracking-'));
    expect(declarationsFor(root, tracking as string)['letter-spacing']).toBe(
      '0.06em',
    );

    const weight = classes.find(name => name.startsWith('font-'));
    expect(declarationsFor(root, weight as string)['font-weight']).toBe('600');
  });
});

describe('Chart Assist action button icons (plan 0077 item 4)', () => {
  it('compiles a 12px icon box inside the 24px compact button', async () => {
    render(<CardAction onClick={() => {}} icon={Clock} label="Set" />);
    const button = screen.getByRole('button', {name: 'Set'});
    const classes = classesOf(button);

    const root = await compile(classes);

    // The regression: `size-*` is a Tailwind 3.4 utility and this app is on
    // 3.3.5, so `[&_svg]:size-3` emitted no rule at all and lucide's own 24px
    // width/height attributes stood — a 24px glyph in a 24px button. The
    // `size` plugin in `tailwind.config.js` backfills the utility; the block
    // at the bottom of this file pins that it does.
    const iconClasses = classes.filter(name => name.startsWith('[&_svg]:'));
    expect(iconClasses).not.toHaveLength(0);
    const iconDecls: Record<string, string> = {};
    for (const name of iconClasses) {
      Object.assign(iconDecls, declarationsFor(root, name, 'svg'));
    }
    expect(iconDecls['height']).toBe('0.75rem');
    expect(iconDecls['width']).toBe('0.75rem');

    const heightClass = classes.find(name => name.startsWith('h-['));
    expect(declarationsFor(root, heightClass as string)['height']).toBe(
      'var(--ed-control-h-sm,1.75rem)',
    );
    expect(densityTokens(root)['--ed-control-h-sm']).toBe('1.5rem');
  });

  it('sizes the card icon tile glyph at 14px in the 22px tile', async () => {
    // The tile sizes its glyph through descendant selectors so a lucide svg
    // and an `InstrumentIcon` image land the same; both spellings are pinned.
    const {CardShell} = await import('../CardShell');
    render(
      <CardShell
        icon={<Clock />}
        name="Tempo map"
        explanation="Explanation."
        learnKey="tempo"
        onLearnMore={() => {}}
      />,
    );
    const tile = screen.getByRole('group', {name: 'Tempo map'})
      .firstElementChild?.firstElementChild as Element;
    const classes = classesOf(tile);

    const root = await compile(classes);

    const svgDecls: Record<string, string> = {};
    const imgDecls: Record<string, string> = {};
    for (const name of classes) {
      if (name.startsWith('[&_svg]:')) {
        Object.assign(svgDecls, declarationsFor(root, name, 'svg'));
      }
      if (name.startsWith('[&_img]:')) {
        Object.assign(imgDecls, declarationsFor(root, name, 'img'));
      }
    }
    expect(svgDecls['height']).toBe('0.875rem');
    expect(svgDecls['width']).toBe('0.875rem');
    expect(imgDecls['height']).toBe('0.875rem');
    expect(imgDecls['width']).toBe('0.875rem');
  });
});

describe('Button icon sizing blast radius (plan 0077 item 4)', () => {
  it('leaves icons that size themselves alone', async () => {
    // Backfilling `size-*` made every `[&_svg]:size-*` in the tree real for
    // the first time, including the one upstream shadcn puts in
    // `buttonVariants`' base string. That rule is `.<btn> svg`, specificity
    // (0,1,1), which outranks a `.h-3\.5` (0,1,0) on the icon itself -- so a
    // base declaration would have resized roughly forty call-site-sized icons
    // across the app to 16px in one go, including the transport bar's. The
    // base string deliberately carries no icon size; `xs` is the only variant
    // that sets one, and its call sites all pass unsized lucide glyphs.
    render(
      <Button size="sm">
        <Clock className="h-3.5 w-3.5" />
        Go
      </Button>,
    );
    const button = screen.getByRole('button', {name: 'Go'});
    const classes = classesOf(button);

    expect(classes.filter(name => name.startsWith('[&_svg]:size-'))).toEqual(
      [],
    );

    const root = await compile([...classes, 'h-3.5', 'w-3.5']);
    for (const name of classes) {
      expect(declarationsFor(root, name, 'svg')['height']).toBeUndefined();
      expect(declarationsFor(root, name, 'svg')['width']).toBeUndefined();
    }
    expect(declarationsFor(root, 'h-3.5')['height']).toBe('0.875rem');
  });

  it('still sizes the unsized glyphs in xs buttons', async () => {
    render(
      <Button size="xs">
        <Clock />
        Go
      </Button>,
    );
    const classes = classesOf(screen.getByRole('button', {name: 'Go'}));
    const root = await compile(classes);

    const iconDecls: Record<string, string> = {};
    for (const name of classes.filter(n => n.startsWith('[&_svg]:'))) {
      Object.assign(iconDecls, declarationsFor(root, name, 'svg'));
    }
    expect(iconDecls['height']).toBe('0.75rem');
    expect(iconDecls['width']).toBe('0.75rem');
  });
});

describe('the `size-*` utility (plan 0077 item 4)', () => {
  it('emits width and height, including under an arbitrary variant', async () => {
    // `size-*` is Tailwind 3.4 and this app is on 3.3.5, so without the
    // `size` plugin in `tailwind.config.js` this compiles to nothing and
    // every icon spelled that way silently keeps its intrinsic size. Compiled
    // rather than asserted from the config, because the failure mode is a
    // rule that never reaches the browser.
    const root = await compile(['size-3', 'size-3.5', '[&_svg]:size-3']);

    expect(declarationsFor(root, 'size-3')).toEqual({
      width: '0.75rem',
      height: '0.75rem',
    });
    expect(declarationsFor(root, 'size-3.5')).toEqual({
      width: '0.875rem',
      height: '0.875rem',
    });
    expect(declarationsFor(root, '[&_svg]:size-3', 'svg')).toEqual({
      width: '0.75rem',
      height: '0.75rem',
    });
  });
});
