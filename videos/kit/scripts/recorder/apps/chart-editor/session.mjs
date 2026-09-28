// Opening and setting up the real chart editor for a take: the chart
// imported through the load screen, the editor's own readiness signal and
// WebMCP tools, and the view arranged with real clicks and wheel events.
// Built on the generic session (../../session.mjs).

import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {UsageError} from '../../../lib/cli.ts';
import {sleep} from '../../cdp.mjs';
import {roundBox} from '../../manifest.ts';
import {click, clickElement, park, pressKey} from '../../session.mjs';
import {zipFolder} from '../../zip-folder.mjs';
import {rollLayout, rollOffset} from './layout.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** The editor probe (`window.__recEditor`), injected at document start. */
export const PROBE_SOURCE = fs.readFileSync(
  path.join(HERE, 'probe.js'),
  'utf8',
);

/** The viewport every editor take records: 1920x1080 CSS px at 2x. */
export const EDITOR_VIEWPORT = {width: 1920, height: 1080, scale: 2};

/**
 * The charts a command line names (`--chart <name>=<path>`, as many as it
 * likes), by name, as absolute paths.
 */
export const chartsFromFlags = (entries = []) =>
  Object.fromEntries(
    entries.map(entry => {
      const eq = entry.indexOf('=');
      if (eq < 1)
        throw new UsageError(`--chart takes <name>=<path>, got "${entry}"`);
      return [entry.slice(0, eq), path.resolve(entry.slice(eq + 1))];
    }),
  );

/** The chart a spec opens (its `chart`, default 'main'): its name and path. */
export const chartOf = (spec, charts) => {
  const name = spec.chart ?? 'main';
  const file = charts[name];
  if (!file)
    throw new UsageError(
      `${spec.id} opens the "${name}" chart: pass --chart ${name}=<path>`,
    );
  return {name, file};
};

/** The piano-roll height key the product persists in localStorage (160-560 px). */
const PANEL_KEY = 'chart-editor:piano-roll-panel-height';

/** Call a `window.__recEditor` probe method (an expression like `transport()`). */
export const probe = (page, expr) => page.eval(`window.__recEditor.${expr}`);

/** Wait until the editor is mounted, its WebMCP tools are registered and the
 *  project's audio has decoded (editor_state reports a duration). */
async function waitEditor(page, {timeoutMs = 90000} = {}) {
  await page.waitFor(
    `document.querySelectorAll('canvas').length >= 2 && !!navigator.modelContextTesting && !!document.querySelector('[aria-label="Resize piano-roll panel"]')`,
    {timeoutMs},
  );
  await page.waitFor(
    `(async () => { try { let r = await navigator.modelContextTesting.executeTool('editor_state', '{}'); if (typeof r === 'string') r = JSON.parse(r); return JSON.parse(r.content[0].text).durationMs > 0; } catch { return false; } })()`,
    {timeoutMs},
  );
  await sleep(1500);
}

/**
 * Open a chart package (.zip or .sng) in the editor's page (`url`) through
 * the load screen's own file input, then wait for the editor to mount.
 */
async function loadChart(page, {url, file, timeoutMs = 120000}) {
  await page.navigate(url);
  await page.waitFor(
    `document.querySelector('input[type=file][accept=".zip,.sng"]')`,
    {timeoutMs: 60000},
  );
  const {root} = await page.send('DOM.getDocument', {depth: -1, pierce: false});
  const {nodeId} = await page.send('DOM.querySelector', {
    nodeId: root.nodeId,
    selector: 'input[type=file][accept=".zip,.sng"]',
  });
  await page.send('DOM.setFileInputFiles', {nodeId, files: [file]});
  // The page creates an OPFS project and routes to ?project=<id>.
  await page.waitFor(`location.search.includes('project=')`, {timeoutMs});
  // The editor is up once the piano roll canvas and a highway canvas exist.
  await page.waitFor(`document.querySelectorAll('canvas').length >= 2`, {
    timeoutMs,
  });
  await sleep(1500);
  return page.eval('location.href');
}

/**
 * Import the chart as a fresh project and open it. A chart folder is packed
 * into a store .zip in `scratch` first. Every take starts from a new import:
 * the editor autosaves edits into its project, so reopening an earlier
 * take's project would start from that take's edits.
 */
export async function importChart(page, {app, chartPath, scratch}) {
  let file = chartPath;
  if (fs.statSync(chartPath).isDirectory()) {
    file = path.join(scratch, 'chart.zip');
    zipFolder(chartPath, file);
  }
  const href = await loadChart(page, {url: app, file});
  await waitEditor(page);
  return href;
}

/**
 * Store the piano-roll panel height (160-560 px) where the product keeps it
 * and reload the project, so the editor mounts at that height. The reload
 * also clears whatever an earlier setup step left on the page (see
 * clearCharter).
 */
export async function setPanelHeight(page, height) {
  await page.eval(
    `localStorage.setItem(${JSON.stringify(PANEL_KEY)}, ${JSON.stringify(String(height))})`,
  );
  await page.send('Page.reload', {});
  await sleep(1000);
  await waitEditor(page);
}

/**
 * Empty the song's Charter as a user does, in the product's song-details
 * dialog: the song header's "Edit song details" button, the Charter field
 * cleared with Backspace and Delete, Save. With no charter on the chart or
 * the project, the header names only the song and the artist. (A song.ini
 * without `charter` does not do this: the import reads a missing charter as
 * "Unknown Charter".) The dialog leaves anti-aliasing traces on the sidebar
 * until the page reloads, so reload before recording: setPanelHeight does.
 */
export async function clearCharter(page) {
  const OPENER = `document.querySelector('button[title="Edit song details"]')`;
  const FIELD = `document.getElementById('song-details-charter')`;
  await clickElement(page, OPENER);
  await page.waitFor(`!!${FIELD}`, {timeoutMs: 10000});
  await sleep(500);
  await clickElement(page, FIELD);
  // Backspace clears the text before the caret, Delete the text after it.
  const length = await page.eval(`${FIELD}.value.length`);
  for (const key of ['Backspace', 'Delete'])
    for (let i = 0; i < length; i++) await pressKey(page, key);
  const left = await page.eval(`${FIELD}.value`);
  if (left !== '') throw new Error(`the Charter field still reads "${left}"`);
  await clickElement(
    page,
    `[...document.querySelectorAll('[role="dialog"] button')].find(b => b.textContent.trim() === 'Save')`,
  );
  await page.waitFor(`!document.querySelector('[role="dialog"]')`, {
    timeoutMs: 10000,
  });
  // The editor saves an edit as it lands.
  await page.waitFor('!window.__recEditor.editorState().dirty', {
    timeoutMs: 10000,
  });
  const header = await page.eval(`${OPENER}.textContent`);
  if (/charted by/i.test(header))
    throw new Error(`the song header still reads "${header}"`);
  await park(page, EDITOR_VIEWPORT);
}

/** Make exactly `tracks` visible, in this pane order, with real matrix clicks. */
export async function setVisibleTracks(page, tracks) {
  const want = tracks.map(t => t.toLowerCase());
  const current = await probe(page, 'transport().visibleTrackKeys');
  if (current.length === want.length && current.every((k, i) => k === want[i]))
    return;
  const center = c => ({x: c.x + c.width / 2, y: c.y + c.height / 2});
  let cells = await probe(page, 'matrix()');
  for (const t of want)
    if (!cells[t])
      throw new Error(
        `no Chart Matrix cell for ${t}; have ${Object.keys(cells).join(', ')}`,
      );
  // Pane order is the order tracks became visible, and the editor keeps at
  // least one track on: show the first wanted track, hide every other, then
  // show the rest in order.
  if (!cells[want[0]].pressed) {
    const p = center(cells[want[0]]);
    await click(page, p.x, p.y);
    await sleep(500);
  }
  cells = await probe(page, 'matrix()');
  for (const [k, c] of Object.entries(cells)) {
    if (k !== want[0] && c.pressed) {
      const p = center(c);
      await click(page, p.x, p.y);
      await sleep(400);
    }
  }
  for (const t of want.slice(1)) {
    cells = await probe(page, 'matrix()');
    if (!cells[t].pressed) {
      const p = center(cells[t]);
      await click(page, p.x, p.y);
      await sleep(400);
    }
  }
  await park(page, EDITOR_VIEWPORT);
  await sleep(600);
  const now = await probe(page, 'transport().visibleTrackKeys');
  if (now.join() !== want.join())
    throw new Error(`visible tracks are ${now.join()} (wanted ${want.join()})`);
}

// Chrome scales CDP wheel deltas by the real screen's pixel ratio over the
// emulated one (a 2x Mac screen emulating 4x halves them). The loops below
// measure the gain from their own first event and correct for it.

/**
 * Zoom the roll with the product's own wheel zoom to `pxPerMs` (or so that
 * `spanSec` fills the lane width).
 */
export async function zoomRoll(page, {spanSec, pxPerMs}, log = () => {}) {
  let gain = 1;
  let view = null;
  for (let i = 0; i < 12; i++) {
    const roll = await probe(page, 'roll()');
    const L = rollLayout(roll);
    const target = pxPerMs ?? L.width / (spanSec * 1000);
    view = roll.view;
    const ratio = target / view.pxPerMs;
    if (Math.abs(ratio - 1) < 1e-6) return view;
    // The roll zooms by exp(-deltaY * 0.0022), anchored at the pointer.
    const want = -Math.log(ratio) / 0.0022;
    await page.send('Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x: L.originX + L.width / 2,
      y: L.visibleTop + 10,
      deltaX: 0,
      deltaY: want / gain,
      button: 'none',
      buttons: 0,
      pointerType: 'mouse',
    });
    await sleep(200);
    const after = (await probe(page, 'roll()')).view;
    const got = -Math.log(after.pxPerMs / view.pxPerMs) / 0.0022;
    if (Math.abs(want) > 1 && Math.abs(got) > 0.01) gain *= got / want;
  }
  log(`zoom: ended at pxPerMs ${view.pxPerMs}`);
  return view;
}

/**
 * Pan the roll so its left edge sits at `leftMs`, with the product's own
 * horizontal wheel pan (paused, the view then stays put).
 */
export async function panRollTo(page, leftMs) {
  let gain = 1;
  for (let i = 0; i < 12; i++) {
    const roll = await probe(page, 'roll()');
    const L = rollLayout(roll);
    const want = rollOffset(roll.view, leftMs);
    if (Math.abs(want) < 0.001) return roll.view;
    await page.send('Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x: L.originX + L.width / 2,
      y: L.visibleTop + 10,
      deltaX: want / gain,
      deltaY: 0,
      button: 'none',
      buttons: 0,
      pointerType: 'mouse',
    });
    await sleep(200);
    const after = (await probe(page, 'roll()')).view;
    const got = rollOffset(roll.view, after.leftMs);
    if (Math.abs(want) > 1 && Math.abs(got) > 0.001) gain *= got / want;
  }
  return (await probe(page, 'roll()')).view;
}

/** Boxes (CSS px) of the editor's major components as laid out now. */
export async function measureComponents(page) {
  return page.eval(`(() => {
    const rect = window.__recDom.box;
    const grid = document.querySelector('.chart-editor-grid');
    const area = name => grid && [...grid.children].find(c => (c.getAttribute('style') || '').replace(/\\s/g, '').includes('grid-area:' + name));
    const bottom = area('bottom');
    const handle = document.querySelector('[aria-label="Resize piano-roll panel"]');
    const aside = document.querySelector('aside');
    const asideBox = rect(aside);
    // A sidebar section (its heading's section wrapper), clipped to the rail.
    const section = title => {
      const h = aside && [...aside.querySelectorAll('h3')].find(e => e.textContent.trim() === title);
      const b = h ? rect(h.parentElement.parentElement) : null;
      if (!b || !asideBox) return b;
      const top = Math.max(b.y, asideBox.y), bottomY = Math.min(b.y + b.height, asideBox.y + asideBox.height);
      return bottomY > top ? {x: b.x, y: top, width: b.width, height: bottomY - top} : null;
    };
    const out = {
      window: {x: 0, y: 0, width: innerWidth, height: innerHeight},
      siteHeader: rect(document.querySelector('header')),
      songHeader: rect(area('header')),
      sidebar: rect(area('sidebar') || aside),
      chartMatrix: section('Chart Matrix'),
      chartAssist: section('Chart Assist'),
      highways: rect(document.querySelector('section[aria-label="Editing surface"]')),
      transport: rect(bottom && bottom.children[0]),
      pianoRoll: rect(handle && handle.parentElement),
    };
    for (const lane of document.querySelectorAll('[data-testid^="highway-lane-"]')) {
      const key = lane.dataset.testid.slice('highway-lane-'.length).replace(':', '-');
      out['highway-' + key] = rect(lane);
    }
    return out;
  })()`);
}

/** Highway pane boxes this frame (they move when the Chart Matrix changes). */
const PANES_JS = `[...document.querySelectorAll('[data-testid^="highway-lane-"]')].map(l => ({track: l.dataset.testid.slice('highway-lane-'.length), box: window.__recDom.box(l)}))`;

/** The roll's frame geometry and the highway panes, read after every captured frame. */
export const GEOMETRY_JS = `({roll: window.__recEditor.rollFrame(), panes: ${PANES_JS}})`;

/** The panes `GEOMETRY_JS` read, as a take's layout records them (boxes to hundredths of a px). */
export const recordedPanes = panes =>
  panes.map(({track, box}) => ({track, ...roundBox(box)}));
