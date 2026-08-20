/**
 * Guardrails for the OG image system (plan 0099 Track A): every route that
 * exports an OG image uses the shared size constant and carries a non-empty
 * alt, and the OG lane palette stays equal to the canonical highway gem
 * colors in `components/landing/lanes.ts`.
 */
import fs from 'fs';
import path from 'path';

import {LANE_FALLBACKS, LANE_PROPERTIES} from '@/components/landing/lanes';

import {CASCADE_SHAPES, GRID, OgReductionCascade} from '../reduction-cascade';
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

describe('OG cascade note shapes', () => {
  /**
   * The difficulty cards draw a still frame of the difficulty pages' hero
   * canvas, so the gem and sustain-tail shapes in `lib/og/reduction-cascade`
   * restate that canvas's drawing constants — Satori cannot run the canvas
   * code, the same reason `OG_LANES` restates the stylesheet. This pins each
   * restated constant to the literal expression in the canvas source, so a
   * change to the canvas fails here and names the copy to update.
   */
  const canvasSource = fs.readFileSync(
    path.join(
      APP_DIR,
      '..',
      'components',
      'difficulty-generation',
      'landing',
      'illustrations',
      'ReductionCascadeCanvas.tsx',
    ),
    'utf8',
  );

  it('matches the gem head the canvas draws', () => {
    expect(canvasSource).toContain(
      `Math.min(slotW * ${CASCADE_SHAPES.gemWidthOfSlot}, ` +
        `${CASCADE_SHAPES.gemWidthCap} * dpr)`,
    );
    expect(canvasSource).toContain(
      `Math.max(${CASCADE_SHAPES.gemHeightMin} * dpr, ` +
        `rowH * ${CASCADE_SHAPES.gemHeightOfRow})`,
    );
    // The head's corner radius.
    expect(canvasSource).toContain(
      `gemW, gemH, ${CASCADE_SHAPES.gemCornerRadius} * dpr`,
    );
  });

  it('matches the sustain tail the canvas draws', () => {
    expect(canvasSource).toContain(
      `const tailH = gemH * ${CASCADE_SHAPES.tailHeightOfGem};`,
    );
    expect(canvasSource).toContain(
      `ctx.globalAlpha = ${CASCADE_SHAPES.tailAlpha} * alpha * fade`,
    );
    // The complete tail rectangle, argument by argument: from the head's
    // right edge, vertically centered, to slot-end minus half a head, with
    // the corner radius. Pinning the whole call means a change to any part
    // of the tail's geometry fails here, not just its named constants.
    expect(canvasSource.replace(/\s+/g, ' ')).toContain(
      'ctx.roundRect( x + gemW, cy - tailH / 2, ' +
        'tailSlots * slotW - gemW / 2, tailH, ' +
        `Math.min(${CASCADE_SHAPES.tailCornerCap} * dpr, ` +
        `tailH / ${CASCADE_SHAPES.tailCornerDivisor}), )`,
    );
  });

  it('draws the card tail flush against the head, rounded only at the far end', () => {
    /**
     * Per-corner geometry the source-string pins cannot see: render the
     * component's element tree and measure the tail against its head. The
     * canvas's single roundRect radius is at most 3 CSS px at hero scale
     * and sits flush against the head, so the page reads a flat butt edge;
     * the card must not enlarge that corner into a visible seam.
     */
    type El = {
      type: unknown;
      props: {style?: Record<string, unknown>; children?: unknown};
    };
    const collectDivs = (node: unknown, out: El[]): El[] => {
      if (Array.isArray(node)) {
        node.forEach(child => collectDivs(child, out));
        return out;
      }
      if (node === null || typeof node !== 'object') return out;
      const el = node as El;
      if (typeof el.type === 'function') {
        return collectDivs(
          (el.type as (props: object) => unknown)(el.props),
          out,
        );
      }
      if (el.type === 'div') out.push(el);
      return collectDivs(el.props?.children, out);
    };

    const divs = collectDivs(
      OgReductionCascade({
        rows: [{label: 'EXPERT', notes: ['#123456'], sustains: {0: 1}}],
      }),
      [],
    );
    const tail = divs.find(d => d.props.style?.['opacity'] !== undefined);
    const gem = divs.find(
      d =>
        d.props.style?.['opacity'] === undefined &&
        d.props.style?.['background'] === '#123456',
    );
    if (!tail?.props.style || !gem?.props.style) {
      throw new Error('Expected the cascade to render a tail and a gem div');
    }
    const tailStyle = tail.props.style;
    const gemStyle = gem.props.style;

    expect(tailStyle['opacity']).toBe(CASCADE_SHAPES.tailAlpha);
    expect(tailStyle['height']).toBeCloseTo(
      (gemStyle['height'] as number) * CASCADE_SHAPES.tailHeightOfGem,
    );
    // Flush against the head's right edge, vertically centered on it.
    expect(tailStyle['left']).toBeCloseTo(
      (gemStyle['left'] as number) + (gemStyle['width'] as number),
    );
    expect(
      (tailStyle['top'] as number) * 2 + (tailStyle['height'] as number),
    ).toBeCloseTo(gemStyle['height'] as number);

    /**
     * The card-side grid, pinned. `rowHeight` is the nominal the px-valued
     * shapes scale from: the tool panel's inner height (300 tall, 1px
     * border, 16 panel padding, 8 cascade padding, each on both sides)
     * over the four rows, rounded up to a whole px.
     */
    expect(GRID).toEqual({
      labelWidth: 200,
      slots: 16,
      slotWidth: 50,
      rowHeight: 63,
    });
    const toolCardSource = fs.readFileSync(
      path.join(__dirname, '..', 'tool-og-image.tsx'),
      'utf8',
    );
    expect(toolCardSource).toContain(
      "<OgPanel padding={16} style={{width: '100%', height: 300}}>",
    );
    expect(GRID.rowHeight).toBe(Math.ceil((300 - 2 * 1 - 2 * 16 - 2 * 8) / 4));

    // The gem head and tail geometry, computed from the canvas-pinned
    // shapes at the card's scale. The string pins above tie the formulas
    // to the canvas source; this ties the card's arithmetic to them.
    const scale = GRID.rowHeight / CASCADE_SHAPES.baseRowHeight;
    const gemW = Math.min(
      GRID.slotWidth * CASCADE_SHAPES.gemWidthOfSlot,
      CASCADE_SHAPES.gemWidthCap * scale,
    );
    const gemH = Math.max(
      CASCADE_SHAPES.gemHeightMin * scale,
      GRID.rowHeight * CASCADE_SHAPES.gemHeightOfRow,
    );
    expect(gemStyle['width']).toBeCloseTo(gemW);
    expect(gemStyle['height']).toBeCloseTo(gemH);
    expect(gemStyle['borderRadius']).toBeCloseTo(
      CASCADE_SHAPES.gemCornerRadius * scale,
    );
    // The single note sits in slot 0, centered in its slot.
    expect(gemStyle['left']).toBeCloseTo((GRID.slotWidth - gemW) / 2);
    // A one-slot sustain: from the head's right edge to slot-end minus
    // half a head, as the canvas draws it.
    expect(tailStyle['width']).toBeCloseTo(1 * GRID.slotWidth - gemW / 2);
    // Left corners square, far end rounded, at the canvas's capped radius.
    const tailH = gemH * CASCADE_SHAPES.tailHeightOfGem;
    const tailRadius = Math.min(
      CASCADE_SHAPES.tailCornerCap * scale,
      tailH / CASCADE_SHAPES.tailCornerDivisor,
    );
    const radiusMatch = /^0 ([\d.]+)px ([\d.]+)px 0$/.exec(
      String(tailStyle['borderRadius']),
    );
    if (!radiusMatch) {
      throw new Error(
        `Tail borderRadius has the wrong shape: ${tailStyle['borderRadius']}`,
      );
    }
    expect(Number(radiusMatch[1])).toBeCloseTo(tailRadius);
    expect(Number(radiusMatch[2])).toBeCloseTo(tailRadius);
  });

  it('reads the px-valued shapes at the hero canvas desktop row height', () => {
    // The hero canvas is the tall frame variant, sm:h-44 (176 CSS px), over
    // the four cascade rows; the card scales the canvas's px-valued shapes
    // from that row height. The frame class lives in
    // `components/landing/heroCanvasFrame.ts`, so the pin follows the canvas
    // to the variant and the variant to the pixel height.
    expect(canvasSource).toContain("heroCanvasFrameClass('tall')");
    const frameSource = fs.readFileSync(
      path.join(
        __dirname,
        '..',
        '..',
        '..',
        'components',
        'landing',
        'heroCanvasFrame.ts',
      ),
      'utf8',
    );
    expect(frameSource).toContain("'h-36 sm:h-44'");
    expect(canvasSource).toContain(
      "const ROW_LABELS = ['EXPERT', 'HARD', 'MEDIUM', 'EASY'] as const;",
    );
    expect(CASCADE_SHAPES.baseRowHeight).toBe(176 / 4);
  });
});

describe('OG cascade note patterns', () => {
  /**
   * The difficulty cards also restate the canvas's note patterns — which
   * lane sits in which slot, which slots each tier keeps, and the per-tier
   * sustain lengths (`DRUM_SPEC` / `GUITAR_SPEC`). Neither module exports
   * its data, so both literals are parsed out of the source and evaluated,
   * the rows the canvas would draw are derived exactly as its `rowNotes`
   * derivation does, and the route's `ROWS` must equal them — lane colors
   * included, through the kick/red/yellow/blue/green lane order that
   * `LANE_PROPERTIES` fixes (the guitar card reads lane 0, the kick slot,
   * as the orange fret).
   */
  const stripComments = (source: string) =>
    source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/[^\n:]\/\/.*$/gm, '');

  const canvasSource = stripComments(
    fs.readFileSync(
      path.join(
        APP_DIR,
        '..',
        'components',
        'difficulty-generation',
        'landing',
        'illustrations',
        'ReductionCascadeCanvas.tsx',
      ),
      'utf8',
    ),
  );

  interface SpecNote {
    slot: number;
    lane: number;
    sustain?: readonly [number, number, number, number];
  }
  interface Spec {
    expert: readonly SpecNote[];
    keeps: readonly (readonly number[])[];
  }

  const extractSpec = (name: 'DRUM_SPEC' | 'GUITAR_SPEC'): Spec => {
    const match = canvasSource.match(
      new RegExp(`const ${name}: CascadeSpec = (\\{[\\s\\S]*?\\n\\});`),
    );
    if (!match?.[1]) {
      throw new Error(`Could not find ${name} in ReductionCascadeCanvas.tsx`);
    }
    return new Function(`return (${match[1]});`)() as Spec;
  };

  /** Lane index → OG color, in the canvas's kick-first lane order. */
  const laneColors = LANE_PROPERTIES.map(
    property =>
      (OG_LANES as Record<string, string>)[property.replace('--lane-', '')],
  );

  /** The rows the canvas draws: Expert, then Expert filtered by each tier's
   *  kept slots, with tier `rowIndex`'s sustain length — its `rowNotes`
   *  derivation and `drawGem`'s `note.sustain?.[rowIndex]` read. */
  const expectedRows = (spec: Spec) =>
    [
      spec.expert,
      ...spec.keeps.map(kept =>
        spec.expert.filter(note => kept.includes(note.slot)),
      ),
    ].map((notes, rowIndex) => {
      const slots: (string | null)[] = Array.from({length: 16}, () => null);
      const sustains: Record<number, number> = {};
      for (const note of notes) {
        slots[note.slot] = laneColors[note.lane] ?? null;
        const tail = note.sustain?.[rowIndex] ?? 0;
        if (tail > 0) sustains[note.slot] = tail;
      }
      return {slots, sustains};
    });

  interface RouteRow {
    label: string;
    notes: readonly (string | null)[];
    sustains?: Readonly<Record<number, number>>;
  }

  const routeRows = (route: string): RouteRow[] => {
    const source = stripComments(
      fs.readFileSync(path.join(APP_DIR, route, 'opengraph-image.tsx'), 'utf8'),
    );
    const decls = [...source.matchAll(/const [A-Z] = OG_LANES\.\w+;/g)]
      .map(m => m[0])
      .join('\n');
    const rows = source.match(
      /const ROWS: readonly OgCascadeRow\[\] = (\[[\s\S]*?\n\]);/,
    );
    if (!rows?.[1]) {
      throw new Error(
        `Could not find ROWS in app/${route}/opengraph-image.tsx`,
      );
    }
    return new Function('OG_LANES', `${decls}\nreturn (${rows[1]});`)(
      OG_LANES,
    ) as RouteRow[];
  };

  it.each([
    ['drum-difficulties', 'DRUM_SPEC'],
    ['guitar-difficulties', 'GUITAR_SPEC'],
  ] as const)('%s ROWS restate the canvas %s', (route, specName) => {
    const expected = expectedRows(extractSpec(specName));
    const rows = routeRows(route);
    // The declaration is only worth pinning if it is what the card draws:
    // the default export must hand ROWS, whole and unsliced, to the
    // cascade.
    expect(
      fs.readFileSync(path.join(APP_DIR, route, 'opengraph-image.tsx'), 'utf8'),
    ).toContain('<OgReductionCascade rows={ROWS} />');
    expect(rows.map(row => row.label)).toEqual([
      'EXPERT',
      'HARD',
      'MEDIUM',
      'EASY',
    ]);
    expect(rows.map(row => [...row.notes])).toEqual(
      expected.map(row => row.slots),
    );
    expect(rows.map(row => row.sustains ?? {})).toEqual(
      expected.map(row => row.sustains),
    );
  });
});
