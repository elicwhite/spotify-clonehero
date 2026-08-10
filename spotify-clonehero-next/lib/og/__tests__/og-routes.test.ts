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
  it('finds every route OG file', () => {
    // Update this count when adding or removing a route OG image.
    expect(ogFiles).toHaveLength(10);
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
  it('matches the canonical highway gem colors', () => {
    // LANE_PROPERTIES is in lane order (kick first); LANE_FALLBACKS mirrors
    // the dark values in globals.css, which OG cards use because they are
    // always dark.
    const byProperty = Object.fromEntries(
      LANE_PROPERTIES.map((prop, i) => [prop, LANE_FALLBACKS[i]]),
    );
    expect(OG_LANES).toEqual({
      kick: byProperty['--lane-kick'],
      red: byProperty['--lane-red'],
      yellow: byProperty['--lane-yellow'],
      blue: byProperty['--lane-blue'],
      green: byProperty['--lane-green'],
    });
  });
});
