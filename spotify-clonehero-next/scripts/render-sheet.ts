/**
 * Headless sheet-music renderer for Clone Hero drum charts.
 *
 * Renders a notes.chart / notes.mid (+ its own tempo/time-sig map) to a PNG
 * or SVG using the SAME VexFlow engine the app's /sheet-music page uses
 * (convertToVexflow.ts + renderVexflow.ts), so the output matches what a
 * user sees in the product. No browser needed — VexFlow's SVG backend runs
 * against a jsdom document, then sharp rasterizes to PNG.
 *
 * Usage:
 *   pnpm exec tsx scripts/render-sheet.ts <chartDir-or-notes.chart> -o out.png
 *   pnpm exec tsx scripts/render-sheet.ts <chart> -o out.png --measures 135-150
 *   pnpm exec tsx scripts/render-sheet.ts <chart> -o out.svg --difficulty expert
 *
 *   # Side-by-side/stacked A/B/GT comparison (each dir holds a notes.chart):
 *   pnpm exec tsx scripts/render-sheet.ts --ab dirA dirB dirGT -o outDir --measures 135-150
 *
 * Flags:
 *   -o, --out <path>       output file (.png or .svg); for --ab mode, an output DIRECTORY
 *   --measures A-B         1-indexed inclusive measure range (bar numbers restart at 1
 *                          within the rendered range, same as the app's practice-mode
 *                          window — the console output prints the true starting measure)
 *   --difficulty <diff>    expert (default) | hard | medium | easy
 *   --width <px>           layout width used for stave wrapping (default 1400)
 *   --zoom <n>              VexFlow zoom factor (default 1)
 *   --no-colors            disable per-instrument notehead coloring (default: on)
 *   --no-bar-numbers       hide measure numbers (default: on)
 *   --ab dirA dirB dirGT   render three chart dirs and also emit a stacked comparison PNG
 *
 * Input resolution: a bare directory is expected to contain notes.chart or notes.mid;
 * a direct file path is used as-is.
 */

import * as fs from 'fs';
import * as path from 'path';
import {JSDOM} from 'jsdom';
import sharp from 'sharp';

// --- jsdom shim, installed before any vexflow/app-module import touches globals ---
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  pretendToBeVisual: true,
});
(global as any).window = dom.window;
(global as any).document = dom.window['document'];
(global as any).HTMLElement = dom.window.HTMLElement;
(global as any).SVGElement = dom.window.SVGElement;
Object.defineProperty(global, 'navigator', {
  value: dom.window['navigator'],
  configurable: true,
});

// jsdom doesn't implement SVG layout (getBBox), which VexFlow's SVG backend
// calls to measure text (bar numbers, section/lyric labels) for positioning.
// A real browser gets exact glyph metrics here; this stub approximates from
// character count and the element's font-size, which is precise enough for
// text VexFlow only uses for layout nudges, not for note engraving itself
// (notehead/stem/beam geometry comes from VexFlow's own glyph metrics, not
// getBBox).
(dom.window as any).SVGElement.prototype.getBBox = function (this: SVGElement) {
  const text = this.textContent ?? '';
  const styleFontSize = /font-size:\s*([\d.]+)px/.exec(
    this.getAttribute('style') ?? '',
  );
  const fontSize = styleFontSize ? Number(styleFontSize[1]) : 10;
  return {
    x: 0,
    y: 0,
    width: text.length * fontSize * 0.6,
    height: fontSize * 1.2,
  };
};

// Imports below intentionally come after the jsdom shim: convertToVexflow.ts /
// renderVexflow.ts are written for the browser and read `document` at call time.
async function loadAppModules() {
  const {parseChartFile, defaultIniChartModifiers} = await import(
    '@eliwhite/scan-chart'
  );
  const convertToVexFlow = (
    await import('../app/sheet-music/[slug]/convertToVexflow')
  ).default;
  const {renderMusic} = await import('../app/sheet-music/[slug]/renderVexflow');
  return {
    parseChartFile,
    defaultIniChartModifiers,
    convertToVexFlow,
    renderMusic,
  };
}

const PRO_DRUMS_MODIFIERS_EXTRA = {pro_drums: true} as const;

interface Args {
  input?: string;
  out?: string;
  measures?: [number, number];
  difficulty: string;
  width: number;
  zoom: number;
  colors: boolean;
  barNumbers: boolean;
  ab?: [string, string, string];
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    difficulty: 'expert',
    width: 1400,
    zoom: 1,
    colors: true,
    barNumbers: true,
  };
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-o' || a === '--out') {
      args.out = argv[++i];
    } else if (a === '--measures') {
      const [s, e] = argv[++i].split('-').map(Number);
      args.measures = [s, e];
    } else if (a === '--difficulty') {
      args.difficulty = argv[++i];
    } else if (a === '--width') {
      args.width = Number(argv[++i]);
    } else if (a === '--zoom') {
      args.zoom = Number(argv[++i]);
    } else if (a === '--no-colors') {
      args.colors = false;
    } else if (a === '--no-bar-numbers') {
      args.barNumbers = false;
    } else if (a === '--ab') {
      args.ab = [argv[++i], argv[++i], argv[++i]];
    } else {
      positional.push(a);
    }
  }
  args.input = positional[0];
  return args;
}

function resolveChartFile(inputPath: string): string {
  const stat = fs.statSync(inputPath);
  if (stat.isFile()) return inputPath;
  const chartPath = path.join(inputPath, 'notes.chart');
  if (fs.existsSync(chartPath)) return chartPath;
  const midPath = path.join(inputPath, 'notes.mid');
  if (fs.existsSync(midPath)) return midPath;
  throw new Error(`No notes.chart/notes.mid found in ${inputPath}`);
}

async function renderChartToSvg(
  chartFilePath: string,
  opts: {
    difficulty: string;
    measures?: [number, number];
    width: number;
    zoom: number;
    colors: boolean;
    barNumbers: boolean;
  },
): Promise<{
  svg: string;
  heightPx: number;
  trueStartMeasure: number;
  totalMeasures: number;
}> {
  const {
    parseChartFile,
    defaultIniChartModifiers,
    convertToVexFlow,
    renderMusic,
  } = await loadAppModules();

  const format = chartFilePath.endsWith('.mid') ? 'mid' : 'chart';
  const bytes = new Uint8Array(fs.readFileSync(chartFilePath));
  const chart = parseChartFile(bytes, format as 'chart' | 'mid', {
    ...defaultIniChartModifiers,
    ...PRO_DRUMS_MODIFIERS_EXTRA,
  });

  const drumTracks = chart.trackData.filter(
    (t: any) => t.instrument === 'drums',
  );
  if (drumTracks.length === 0) {
    throw new Error(`No drum track found in ${chartFilePath}`);
  }
  const track =
    drumTracks.find((t: any) => t.difficulty === opts.difficulty) ??
    drumTracks[0];
  if (track.difficulty !== opts.difficulty) {
    console.warn(
      `Difficulty '${opts.difficulty}' not present; using '${track.difficulty}' instead.`,
    );
  }

  const allMeasures = convertToVexFlow(chart, track);
  let measures = allMeasures;
  let trueStartMeasure = 1;
  if (opts.measures) {
    const [startBar, endBar] = opts.measures;
    trueStartMeasure = startBar;
    measures = allMeasures.slice(startBar - 1, endBar);
    if (measures.length === 0) {
      throw new Error(
        `Measure range ${startBar}-${endBar} is out of bounds (chart has ${allMeasures.length} measures).`,
      );
    }
  }

  // Fake HTMLDivElement ref, detached from the document tree so renderMusic's
  // `elementRef.current?.parentElement?.offsetWidth ?? window.innerWidth`
  // width lookup falls through to window.innerWidth (jsdom never computes
  // real layout, so an attached div's offsetWidth would read as 0).
  Object.defineProperty(dom.window, 'innerWidth', {
    value: opts.width,
    configurable: true,
  });
  const div = document.createElement('div') as unknown as HTMLDivElement;
  const elementRef = {current: div};

  renderMusic(
    elementRef as any,
    measures,
    chart.sections ?? [],
    opts.zoom,
    [],
    opts.barNumbers,
    opts.colors,
    null,
    false,
  );

  const svgEl = div.querySelector('svg');
  if (!svgEl) {
    throw new Error('VexFlow did not produce an <svg> element.');
  }
  const heightAttr = svgEl.getAttribute('height');
  const heightPx = heightAttr ? Math.ceil(Number(heightAttr)) : 0;

  return {
    svg: svgEl.outerHTML,
    heightPx,
    trueStartMeasure,
    totalMeasures: allMeasures.length,
  };
}

async function svgToPngBuffer(svg: string): Promise<Buffer> {
  return sharp(Buffer.from(svg), {density: 150})
    .flatten({background: '#ffffff'})
    .png()
    .toBuffer();
}

async function renderOne(inputPath: string, outPath: string, opts: Args) {
  const chartFile = resolveChartFile(inputPath);
  const {svg, heightPx, trueStartMeasure, totalMeasures} =
    await renderChartToSvg(chartFile, opts);
  console.log(
    `${chartFile}: ${totalMeasures} measures total` +
      (opts.measures
        ? `, rendering ${opts.measures[0]}-${opts.measures[1]} (starts at true measure ${trueStartMeasure})`
        : '') +
      `, svg height=${heightPx}px`,
  );

  fs.mkdirSync(path.dirname(outPath), {recursive: true});
  if (outPath.endsWith('.svg')) {
    fs.writeFileSync(outPath, svg);
  } else {
    const png = await svgToPngBuffer(svg);
    fs.writeFileSync(outPath, new Uint8Array(png));
  }
  console.log(`Wrote ${outPath}`);
  return outPath;
}

async function renderAb(
  dirs: [string, string, string],
  outDir: string,
  opts: Args,
) {
  const labels = ['A', 'B', 'GT'];
  fs.mkdirSync(outDir, {recursive: true});
  const pngPaths: string[] = [];
  for (let i = 0; i < dirs.length; i++) {
    const outPath = path.join(outDir, `${labels[i]}.png`);
    await renderOne(dirs[i], outPath, opts);
    pngPaths.push(outPath);
  }

  // Stack the three PNGs vertically with a text-label banner above each,
  // via an SVG frame (bypasses needing sharp's pango-dependent text()).
  const metas = await Promise.all(pngPaths.map(p => sharp(p).metadata()));
  const bannerHeight = 40;
  const gap = 12;
  const maxWidth = Math.max(...metas.map(m => m.width ?? 0));
  const totalHeight =
    metas.reduce((sum, m) => sum + bannerHeight + (m.height ?? 0), 0) +
    gap * (dirs.length - 1);

  const banners = labels.map(
    (label, i) =>
      `<text x="10" y="${28}" font-family="Arial" font-size="24" font-weight="bold" fill="#111">${label} — ${path.basename(dirs[i])}</text>`,
  );

  let y = 0;
  const composites: sharp.OverlayOptions[] = [];
  for (let i = 0; i < pngPaths.length; i++) {
    const h = metas[i].height ?? 0;
    const bannerSvg = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${maxWidth}" height="${bannerHeight}">` +
        `<rect width="100%" height="100%" fill="#ffffff"/>${banners[i]}</svg>`,
    );
    composites.push({input: bannerSvg, top: y, left: 0});
    y += bannerHeight;
    composites.push({input: pngPaths[i], top: y, left: 0});
    y += h + gap;
  }

  const combined = await sharp({
    create: {
      width: maxWidth,
      height: totalHeight,
      channels: 3,
      background: '#ffffff',
    },
  })
    .composite(composites)
    .png()
    .toBuffer();

  const combinedPath = path.join(outDir, 'combined.png');
  fs.writeFileSync(combinedPath, new Uint8Array(combined));
  console.log(`Wrote ${combinedPath}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.out) {
    throw new Error('Missing -o/--out output path.');
  }

  if (args.ab) {
    await renderAb(args.ab, args.out, args);
    return;
  }

  if (!args.input) {
    throw new Error(
      'Missing input chart path. Usage: render-sheet.ts <chart> -o out.png [--measures A-B]',
    );
  }
  await renderOne(args.input, args.out, args);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
