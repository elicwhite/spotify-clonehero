/**
 * Guardrails for the OG image system (plan 0099 Track A): every route that
 * exports an OG image uses the shared size constant and carries a non-empty
 * alt, and the OG lane palette stays equal to the canonical highway gem
 * colors in `components/landing/lanes.ts`.
 */
import fs from 'fs';
import path from 'path';

import {LANE_FALLBACKS, LANE_PROPERTIES} from '@/components/landing/lanes';

import {OG_LANES, OG_SIZE} from '../tokens';

const APP_DIR = path.join(__dirname, '..', '..', '..', 'app');

function findOgImageFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findOgImageFiles(full));
    } else if (entry.name === 'opengraph-image.tsx') {
      results.push(full);
    }
  }
  return results;
}

const ogFiles = findOgImageFiles(APP_DIR);

describe('opengraph-image routes', () => {
  // No hardcoded count. One used to live here and was pure maintenance tax:
  // it asserted nothing the per-file cases below don't, and adding the /why
  // card meant editing a number in an unrelated file. An empty list would
  // make `it.each` throw on its own, so the coverage is unchanged.
  it('finds route OG files to check', () => {
    expect(ogFiles.length).toBeGreaterThan(0);
  });

  it.each(ogFiles.map(file => [path.relative(APP_DIR, file), file]))(
    '%s exports OG_SIZE as size and a non-empty alt',
    async (_label, file) => {
      const mod = await import(file);
      expect(mod.size).toEqual(OG_SIZE);
      expect(typeof mod.alt).toBe('string');
      expect(mod.alt.length).toBeGreaterThan(0);
      expect(mod.contentType).toBe('image/png');
      expect(typeof mod.default).toBe('function');
    },
  );

  it.each(ogFiles.map(file => [path.relative(APP_DIR, file), file]))(
    '%s takes its palette from lib/og, not raw hex literals',
    (_label, file) => {
      const source = fs.readFileSync(file, 'utf8');
      const withoutComments = source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      // Illustration-internal colors (SVG strokes, per-page artwork) are
      // allowed; frame/brand colors must come from lib/og/tokens. The
      // specific regressions this guards: a page-local brand background
      // gradient and a page-local lane palette.
      expect(withoutComments).not.toMatch(/linear-gradient\(135deg, #1a0a1f/);
      expect(withoutComments).not.toMatch(
        /#facc15|#ef4444|#3b82f6|#22c55e|#f97316/i,
      );
      expect(withoutComments).not.toMatch(/#1DB954/i);
    },
  );
});

describe('OG lane palette', () => {
  /**
   * `app/globals.css` is where the gem colors actually live. Satori cannot
   * read CSS custom properties, so `OG_LANES` restates them and
   * `LANE_FALLBACKS` mirrors them again for canvases that paint before the
   * stylesheet applies. Three copies, so the test parses the stylesheet
   * rather than comparing two TypeScript constants to each other — which is
   * what it used to do, and would have stayed green while all three drifted
   * away from the CSS together.
   *
   * OG cards are always dark, so the dark block is the one that governs.
   */
  const darkLanes = (() => {
    const css = fs.readFileSync(path.join(APP_DIR, 'globals.css'), 'utf8');
    const darkBlock = css.match(
      /@media \(prefers-color-scheme: dark\) \{\s*\.landing-lanes \{([^}]*)\}/,
    );
    if (!darkBlock?.[1]) {
      throw new Error(
        'Could not find the dark .landing-lanes block in app/globals.css',
      );
    }
    return Object.fromEntries(
      [...darkBlock[1].matchAll(/(--lane-[a-z]+):\s*([^;]+);/g)].map(m => [
        m[1],
        m[2]!.trim(),
      ]),
    );
  })();

  it('restates the dark .landing-lanes values from globals.css', () => {
    expect(OG_LANES).toEqual({
      kick: darkLanes['--lane-kick'],
      red: darkLanes['--lane-red'],
      yellow: darkLanes['--lane-yellow'],
      blue: darkLanes['--lane-blue'],
      green: darkLanes['--lane-green'],
    });
  });

  it('keeps the canvas fallbacks equal to the same values', () => {
    // LANE_PROPERTIES is in lane order (kick first).
    expect(LANE_PROPERTIES.map(prop => darkLanes[prop])).toEqual([
      ...LANE_FALLBACKS,
    ]);
  });
});
