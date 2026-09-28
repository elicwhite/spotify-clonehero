#!/usr/bin/env node
// Check the recorder on this machine: record a small test page twice under
// the virtual clock and compare the takes byte for byte.
//
//   node --import tsx kit/scripts/recorder/selftest.mjs --cdp http://127.0.0.1:9444 \
//     [--length 45] [--keep <folder of takes>]
//
// The page is written to a scratch folder and served from 127.0.0.1. It
// has CSS animations, a CSS transition on a button the plan hovers and
// clicks, a canvas animation drawn from its rAF timestamps, a clock readout
// driven by an interval started before the clock stops, the page's date as
// it formats it and its language (so the date base, time zone and locale
// are under the byte-identity gate too), a key readout, and a Web Worker
// the click starts, whose three messages the worker gate hands to the page
// on planned frames. Each take is recorded into its own folder;
// every component video, the manifests (minus `recordedAt`) and every
// frame's screenshot must be identical, and the frames must differ from each
// other (the page really moves). `--keep` copies the first take there (the
// gallery's recorder block plays it). Exits 1 when the takes differ.

import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {int, need, parseFlags, runCli} from '../lib/cli.ts';
import {withScratchDir} from '../lib/files.ts';
import {compareTakes} from './compare-takes.mjs';
import {Plan} from './gestures.mjs';
import {elementBoxesJs, measureSelectors} from './session.mjs';
import {
  DEFAULT_CLOCK_DATE,
  DEFAULT_CLOCK_START_SEC,
  recordTake,
} from './take.mjs';
import {armWorkerGate, deliverWhen} from './worker-gate.mjs';

const USAGE = `node --import tsx kit/scripts/recorder/selftest.mjs --cdp <url> [--length 45] [--keep <folder of takes>]`;

const ID = 'recorder-selftest';
/** The self-test page's own frame rate: its plan below is written in these frames. */
const FPS = 60;
const VIEWPORT = {width: 960, height: 540, scale: 2};
const log = (...m) => console.error('[selftest]', ...m);

const PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>Recorder self-test</title><style>
  body { margin: 0; background: #0b0a12; color: #eee; font: 600 22px/1.3 system-ui, sans-serif; overflow: hidden; }
  .tile { position: absolute; left: 60px; top: 60px; width: 120px; height: 120px; border-radius: 20px;
          background: linear-gradient(135deg, #a855b7, #4c8dff); animation: spin 2s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .bar { position: absolute; left: 60px; top: 230px; height: 16px; border-radius: 8px; background: #46c46b;
         animation: grow 0.8s ease-in-out infinite alternate; }
  @keyframes grow { from { width: 40px; } to { width: 360px; } }
  canvas { position: absolute; left: 520px; top: 40px; width: 380px; height: 380px; }
  button { position: absolute; left: 60px; top: 300px; padding: 14px 26px; font: inherit; color: #fff;
           border: 0; border-radius: 12px; background: #27272a; transition: background 250ms, transform 250ms; }
  button:hover { background: #3f3f46; }
  button.on { background: #e5484d; transform: scale(1.12); }
  #readout { position: absolute; left: 60px; top: 436px; font-variant-numeric: tabular-nums; white-space: pre; }
</style></head><body>
<div class="tile"></div><div class="bar"></div>
<canvas id="c" width="760" height="760"></canvas>
<button id="b">Press me</button>
<div id="readout"></div>
<script>
  const g = document.getElementById('c').getContext('2d');
  const draw = t => {
    g.fillStyle = '#111'; g.fillRect(0, 0, 760, 760);
    for (let i = 0; i < 12; i++) {
      const a = t / 400 + (i * Math.PI) / 6;
      g.fillStyle = 'hsl(' + i * 30 + ' 80% 60%)';
      g.beginPath(); g.arc(380 + 280 * Math.cos(a), 380 + 280 * Math.sin(a), 30, 0, 2 * Math.PI); g.fill();
    }
    requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);
  let presses = 0, key = '-', heard = [];
  const show = () => { document.getElementById('readout').textContent = 'clock ' + (performance.now() / 1000).toFixed(3) + ' s · presses ' + presses + ' · key ' + key + ' · worker ' + (heard.join(' ') || '-') + '\\n' + new Date().toLocaleString() + ' · ' + navigator.language; };
  setInterval(show, 50);
  const WORKER = URL.createObjectURL(new Blob(["postMessage({type: 'progress'}); postMessage({type: 'progress'}); postMessage({type: 'result'});"], {type: 'text/javascript'}));
  document.getElementById('b').addEventListener('click', e => {
    presses++; e.currentTarget.classList.toggle('on'); show();
    if (presses === 1) new Worker(WORKER).onmessage = m => { heard.push(m.data.type); show(); };
  });
  addEventListener('keydown', e => { key = e.key; show(); });
  show();
</script>
</body></html>
`;

const sha = buf => crypto.createHash('sha256').update(buf).digest('hex');

/** Serve `dir` on 127.0.0.1 (any free port). */
const serve = dir =>
  new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const file = path.join(dir, req.url === '/' ? 'index.html' : req.url);
      if (!file.startsWith(dir) || !fs.existsSync(file)) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, {'content-type': 'text/html; charset=utf-8'});
      res.end(fs.readFileSync(file));
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });

const record = ({cdp, length, url, out, keepDir}) =>
  recordTake({
    cdp,
    viewport: VIEWPORT,
    colorScheme: 'dark',
    id: ID,
    app: 'web',
    description:
      'The recorder self-test page: CSS animations, a CSS transition on a clicked button, a canvas loop drawn from rAF time, an interval-driven clock readout, the page date and language, a key readout and a gated Web Worker.',
    fps: FPS,
    clockStartMs: DEFAULT_CLOCK_START_SEC * 1000,
    dateMs: Date.parse(DEFAULT_CLOCK_DATE),
    start: -10,
    from: 0,
    to: length - 1,
    out,
    keepDir,
    keepFrames: new Set(Array.from({length}, (_, f) => f)),
    async setup(page) {
      await page.navigate(url);
    },
    components: async page => ({
      window: {x: 0, y: 0, width: VIEWPORT.width, height: VIEWPORT.height},
      ...(await measureSelectors(page, {canvas: 'canvas', button: 'button'})),
    }),
    plan() {
      const p = new Plan({fps: FPS});
      const button = live => {
        const b = live.elements.button;
        return {x: b.x + b.width / 2, y: b.y + b.height / 2};
      };
      p.glide(button, 4, 16);
      // The gate holds the worker the click starts (on the release, frame 24).
      p.call(20, armWorkerGate);
      p.click(button, 20, {holdFrames: 4});
      p.note(
        20,
        24,
        'press',
        'click the button (its transition runs, its worker starts)',
      );
      p.key(28, 'k');
      p.note(28, 28, 'key', 'press K (the readout shows it)');
      for (const f of [27, 30, 33])
        p.call(f, page =>
          deliverWhen(
            page,
            s => s.held.length > s.delivered,
            'the next worker message',
          ),
        );
      p.note(
        27,
        33,
        'worker',
        "the worker's three messages reach the page on frames 27, 30 and 33",
      );
      p.park(34);
      return p;
    },
    hooks: {
      live: `({elements: ${elementBoxesJs({button: 'button'})}})`,
      read: () => `document.getElementById('readout').textContent`,
      frameData: value => ({readout: value}),
    },
    log,
  });

async function main() {
  const {values: args} = parseFlags({
    cdp: {type: 'string'},
    length: {type: 'string'},
    keep: {type: 'string'},
  });
  const cdp = need(args.cdp, 'cdp');
  // The plan below ends by parking the pointer on frame 34.
  const length = int(args.length, 'length', 45, 35);
  await withScratchDir('recorder-selftest', tmp =>
    selftest({cdp, length, keep: args.keep, tmp}),
  );
}

async function selftest({cdp, length, keep, tmp}) {
  const site = path.join(tmp, 'site');
  fs.mkdirSync(site);
  fs.writeFileSync(path.join(site, 'index.html'), PAGE);
  const server = await serve(site);
  const url = `http://127.0.0.1:${server.address().port}/`;
  log(`page at ${url}, takes in ${tmp}`);
  const takes = [];
  try {
    for (const name of ['a', 'b']) {
      const out = path.join(tmp, name, ID);
      const refs = path.join(tmp, name, 'frames');
      await record({cdp, length, url, out, keepDir: refs});
      takes.push({out, refs});
    }
  } finally {
    // The browser may hold a keep-alive connection open; drop it, or the
    // process cannot exit.
    server.close();
    server.closeAllConnections();
  }

  const [a, b] = takes;
  // The landing check: every video and the manifest.
  const problems = compareTakes(a.out, b.out);
  const videos = fs
    .readdirSync(a.out)
    .filter(f => f.endsWith('.mp4'))
    .sort();
  for (const file of videos) {
    const bytes = fs.readFileSync(path.join(a.out, file));
    log(`${file}: ${bytes.length} bytes, sha256 ${sha(bytes).slice(0, 12)}`);
  }
  const frames = fs.readdirSync(a.refs).sort();
  const hashes = new Set();
  let same = 0;
  for (const file of frames) {
    const one = fs.readFileSync(path.join(a.refs, file));
    const two = fs.readFileSync(path.join(b.refs, file));
    hashes.add(sha(one));
    if (one.equals(two)) same++;
    else problems.push(`screenshot ${file} differs`);
  }
  log(
    `screenshots: ${same} of ${frames.length} identical; ${hashes.size} distinct frames in a take`,
  );
  if (hashes.size < frames.length)
    problems.push(
      `only ${hashes.size} distinct frames: the page did not move every frame`,
    );
  const readouts = JSON.parse(
    fs.readFileSync(path.join(a.out, 'manifest.json'), 'utf8'),
  ).frames.map(f => f.readout);
  log(
    `readout at the first and last frame: "${readouts[0]}", "${readouts[readouts.length - 1]}"`,
  );

  if (keep) {
    const kept = path.resolve(keep, ID);
    fs.rmSync(kept, {recursive: true, force: true});
    fs.cpSync(a.out, kept, {recursive: true});
    log(`kept take a in ${kept}`);
  }
  if (problems.length) {
    console.error(`FAIL: ${problems.join('; ')}`);
    process.exitCode = 1;
  } else {
    console.error(
      `PASS: ${videos.length} videos, the manifest and ${frames.length} screenshots are byte-identical across two takes`,
    );
  }
}

runCli(USAGE, main);
