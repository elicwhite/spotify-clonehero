#!/usr/bin/env node
// High-DPI stills of the real piano roll, paused at a fixed view, as a
// stills spec describes it.
//
//   node --import tsx kit/scripts/recorder/apps/chart-editor/roll-stills.mjs \
//     --cdp http://127.0.0.1:9444 --app-url http://localhost:<port>/chart-editor \
//     --chart main=<chart folder | .zip | .sng> [--chart <name>=<path> ...] \
//     --spec <stills>.spec.mjs --out <film>/public/generated/rec
//
// Writes, into <out>/<id>/:
//   <id>-wave@<scale>x.png   ruler + lyrics row + tempo row (the roll's top
//                            bands) across the lane width, default look
//   <id>-flat@<scale>x.png   the same after the lyrics row's own context menu
//                            item "Hide vocals waveform"
//   <id>-panel@<scale>x.png  (spec `panel`) the whole roll panel, default look
//   <id>.json                clip, view, bands, and the lyric pills' extents
//                            (geometry only) with any overlaps
//
// A stills spec default-exports {id, chart (default 'main'), tracks,
// panelHeight, roll: {spanSec | pxPerMs, leftSec}, playheadSec, deviceScale,
// panel}; its `chart` names one of the --chart flags, as a take spec's
// does. The page runs on the recorder's virtual clock, so nothing moves
// between shots; the view is set with the roll's own wheel zoom and pan.
// src/recorder's `useRollStills` reads the result.

import fs from 'node:fs';
import path from 'node:path';
import {importExport, need, parseFlags, runCli} from '../../../lib/cli.ts';
import {withScratchDir} from '../../../lib/files.ts';
import {rollX} from '../../../../src/recorder/roll.ts';
import {connectBrowser, sleep} from '../../cdp.mjs';
import {click, closeTab, openTab, park} from '../../session.mjs';
import {
  dateBaseFor,
  DEFAULT_CLOCK_DATE,
  DEFAULT_CLOCK_START_SEC,
} from '../../take.mjs';
import {frameGeometry} from './layout.mjs';
import {
  chartOf,
  chartsFromFlags,
  EDITOR_VIEWPORT,
  importChart,
  panRollTo,
  PROBE_SOURCE,
  probe,
  setPanelHeight,
  setVisibleTracks,
  zoomRoll,
} from './session.mjs';

const USAGE = `node --import tsx kit/scripts/recorder/apps/chart-editor/roll-stills.mjs \
  --cdp <url> --app-url <url> --chart main=<path> [--chart <name>=<path> ...] \
  --spec <stills>.spec.mjs --out <dir>`;

const log = (...m) => console.error('[roll-stills]', ...m);

async function settle(page, ms = 200) {
  await page.eval(`(async () => {
    await window.__recClock.advance(window.__recClock.now + ${ms});
    await window.__recClock.frame();
  })()`);
}

async function shot(page, file, clip) {
  const {data} = await page.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
    clip: {...clip, scale: 1},
  });
  fs.writeFileSync(file, Buffer.from(data, 'base64'));
  return file;
}

async function main() {
  const {values: args} = parseFlags({
    cdp: {type: 'string'},
    'app-url': {type: 'string'},
    chart: {type: 'string', multiple: true},
    spec: {type: 'string'},
    out: {type: 'string'},
  });
  const app = need(args['app-url'], 'app-url');
  const spec = await importExport(need(args.spec, 'spec'), 'default');
  const chart = chartOf(spec, chartsFromFlags(args.chart));
  const dsf = spec.deviceScale;
  const out = path.resolve(need(args.out, 'out'), spec.id);
  fs.mkdirSync(out, {recursive: true});
  const clockStartMs = DEFAULT_CLOCK_START_SEC * 1000;
  const browser = await connectBrowser(need(args.cdp, 'cdp'));
  const page = await openTab(browser, {
    viewport: {...EDITOR_VIEWPORT, scale: dsf},
    colorScheme: 'dark',
    scripts: [PROBE_SOURCE],
    dateBaseMs: dateBaseFor(Date.parse(DEFAULT_CLOCK_DATE), clockStartMs),
  });
  try {
    await withScratchDir('roll-stills', scratch =>
      importChart(page, {app, chartPath: chart.file, scratch}),
    );
    await setPanelHeight(page, spec.panelHeight);
    await setVisibleTracks(page, spec.tracks);
    await zoomRoll(page, spec.roll, log);
    await park(page, EDITOR_VIEWPORT);
    await sleep(500);

    // Freeze time, park the playhead with the editor's own seek (paused).
    await page.eval(`window.__recClock.enter({at: ${clockStartMs}})`);
    const playheadSec = spec.playheadSec;
    await page.eval(
      `navigator.modelContextTesting.executeTool('editor_seek', ${JSON.stringify(JSON.stringify({timeMs: playheadSec * 1000}))}).then(() => true)`,
    );
    await settle(page);
    const view = await panRollTo(page, spec.roll.leftSec * 1000);
    await park(page, EDITOR_VIEWPORT);
    await settle(page);

    const roll = await probe(page, 'rollFrame()');
    const geo = frameGeometry(roll, playheadSec * 1000);
    const {bands, originX, laneWidth, panel} = geo.layout;
    const clip = {
      x: originX,
      y: bands.ruler.top,
      width: laneWidth,
      height: bands.tempo.bottom - bands.ruler.top,
    };
    const transport = await probe(page, 'transport()');
    if (transport.isPlaying) throw new Error('the editor is playing');

    // Pills: geometry only, in viewport CSS px.
    const pills = (await probe(page, 'lyricPills()'))
      .map(p => {
        const x = rollX({...view, originX}, p.ms);
        return {
          ms: +p.ms.toFixed(3),
          left: +(x - 2).toFixed(2),
          right: +(x + (p.width ?? 24) + 8).toFixed(2),
        };
      })
      .sort((a, b) => a.ms - b.ms);
    const overlaps = [];
    for (let i = 1; i < pills.length; i++) {
      if (pills[i].left < pills[i - 1].right)
        overlaps.push({
          a: pills[i - 1],
          b: pills[i],
          px: +(pills[i - 1].right - pills[i].left).toFixed(2),
        });
    }

    const name = spec.id;
    const files = {};
    files.wave = await shot(
      page,
      path.join(out, `${name}-wave@${dsf}x.png`),
      clip,
    );
    if (spec.panel) {
      const box = await page.eval(
        `window.__recDom.box(document.querySelector('[aria-label="Resize piano-roll panel"]').parentElement)`,
      );
      files.panel = await shot(
        page,
        path.join(out, `${name}-panel@${dsf}x.png`),
        box,
      );
    }

    // "Hide vocals waveform" from the lyrics row's own context menu, opened
    // on empty row space (a gap between pills).
    if (!bands.lyrics)
      throw new Error('the piano roll shows no lyrics row to take stills of');
    const rowY = (bands.lyrics.top + bands.lyrics.bottom) / 2;
    let gapX = null;
    for (let i = 1; i < pills.length && gapX === null; i++) {
      const a = pills[i - 1];
      const b = pills[i];
      const mid = (a.right + b.left) / 2;
      if (
        b.left - a.right > 12 &&
        mid > originX + 20 &&
        mid < originX + laneWidth - 20
      )
        gapX = mid;
    }
    if (gapX === null)
      throw new Error('no empty lyrics-row space to open its menu on');
    await click(page, gapX, rowY, {button: 'right'});
    await settle(page);
    const item = await page.eval(
      `window.__recDom.centre([...document.querySelectorAll('button, [role="menuitem"]')].find(e => e.textContent.trim() === 'Hide vocals waveform' && window.__recDom.box(e).width > 0))`,
    );
    if (!item)
      throw new Error('the lyrics row menu has no "Hide vocals waveform" item');
    await click(page, item.x, item.y);
    await park(page, EDITOR_VIEWPORT);
    await settle(page);
    await settle(page);
    files.flat = await shot(
      page,
      path.join(out, `${name}-flat@${dsf}x.png`),
      clip,
    );

    const meta = {
      dpr: dsf,
      clip,
      view: {leftMs: view.leftMs, pxPerMs: view.pxPerMs},
      originX,
      laneWidth,
      panel,
      bands: {ruler: bands.ruler, lyrics: bands.lyrics, tempo: bands.tempo},
      playheadMs: playheadSec * 1000,
      pills: {
        note: 'lyric pill extents in viewport CSS px (x - 2 to x + textWidth + 8), geometry only',
        items: pills,
      },
      overlaps,
      files: Object.fromEntries(
        Object.entries(files).map(([k, f]) => [k, path.basename(f)]),
      ),
    };
    fs.writeFileSync(
      path.join(out, `${name}.json`),
      JSON.stringify(meta, null, 1),
    );
    log(
      `wrote ${Object.values(meta.files).join(', ')}; ${pills.length} pills, ${overlaps.length} overlaps`,
    );
  } finally {
    await closeTab(browser, page);
    browser.close();
  }
}

runCli(USAGE, main);
