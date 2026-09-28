// One take of a running web app under the virtual clock: a fresh tab, the
// app's setup in real time, then the clock stops and the frame loop records
// every frame into one video per component plus a manifest. App adapters and
// the generic `record.mjs` differ only in the steps they pass in.

import fs from 'node:fs';
import path from 'node:path';
import {connectBrowser, sleep} from './cdp.mjs';
import {deviceCrop, openEncoder} from './encoder.mjs';
import {runFrameLoop} from './frame-loop.mjs';
import {Plan} from './gestures.mjs';
import {buildManifest, writeManifest} from './manifest.ts';
import {closeTab, openTab, park, parkPoint} from './session.mjs';

/**
 * The page's clock at the pre-roll start, by default: past any page's setup
 * (the clock cannot start behind the page's real one), and the same in every
 * take, so absolute timestamps (rAF times, performance.now()) are too.
 */
export const DEFAULT_CLOCK_START_SEC = 60;

/** The page's date at the pre-roll start, by default: fixed, never the real one. */
export const DEFAULT_CLOCK_DATE = '2026-01-01T12:00:00.000Z';

/**
 * The page's date as the tab opens, for a clock that starts at
 * `clockStartMs` on the date `dateMs`: its date then runs from there (real
 * time until the clock stops, virtual time after), reaching `dateMs` at
 * the clock start.
 */
export const dateBaseFor = (dateMs, clockStartMs) => dateMs - clockStartMs;

/**
 * Record one take. Options:
 * - cdp: the Chrome's CDP http endpoint.
 * - viewport {width, height, scale}, colorScheme, scripts (page sources
 *   injected at document start, e.g. an app probe).
 * - id, app, description: for the manifest.
 * - fps; start, from, to: the first frame played (the pre-roll starts
 *   there) and the first and last frames captured, all film frames.
 * - clockStartMs: the page's performance.now() at frame `start`. It must
 *   not be behind the page's real clock when the clock stops.
 * - dateMs: the page's Date.now() at frame `start` (see virtual-clock.js:
 *   before the clock stops, the page's date runs in real time from the tab
 *   opening, `clockStartMs` before `dateMs`).
 * - out: the take's folder (videos + manifest.json); null records nothing.
 * - encoding {crf, preset, pixFmt}; keepDir + keepFrames (a Set of film
 *   frames): also keep those frames as PNG.
 * - songAt(f) -> {songSec, segment, pinned}: for a take that follows a song.
 * - setup(page): everything before the clock stops (navigate, app setup).
 * - begin(page, {now0}): after the clock stops, before frame `start`.
 * - components(page) -> {name: box}: the crops, in CSS px ('window' is the
 *   whole viewport); `only`: the names to keep.
 * - plan() -> Plan: scripted input.
 * - hooks: the frame loop's (pin, live, read, frameData, assertSync).
 * - extra() -> fields the app adds to the manifest (after the loop).
 * - log.
 */
export async function recordTake(o) {
  const log = o.log ?? (() => {});
  const browser = await connectBrowser(o.cdp);
  const page = await openTab(browser, {
    viewport: o.viewport,
    colorScheme: o.colorScheme ?? null,
    scripts: o.scripts ?? [],
    dateBaseMs: dateBaseFor(o.dateMs, o.clockStartMs),
  });
  const exceptions = [];
  browser.on(msg => {
    if (
      msg.sessionId === page.sessionId &&
      msg.method === 'Runtime.exceptionThrown'
    ) {
      exceptions.push(
        (
          msg.params.exceptionDetails.exception?.description ??
          msg.params.exceptionDetails.text ??
          ''
        ).slice(0, 500),
      );
    }
  });
  let encoder = null;
  try {
    await o.setup(page);
    await page.eval(
      'document.activeElement && document.activeElement.blur && document.activeElement.blur()',
    );
    await park(page, o.viewport);
    await sleep(800);

    // Freeze time. From here on the page only sees the frames' own times.
    const now0 = await page.eval(
      `window.__recClock.enter(${JSON.stringify({at: o.clockStartMs})})`,
    );
    if (o.begin) await o.begin(page, {now0});

    const measured = await o.components(page);
    const names = (o.only ?? Object.keys(measured)).filter(n => measured[n]);
    const frameSize = {
      width: o.viewport.width * o.viewport.scale,
      height: o.viewport.height * o.viewport.scale,
    };
    const outputs = names.map(name => ({
      name,
      box: measured[name],
      crop: deviceCrop(measured[name], o.viewport.scale, frameSize),
      file: o.out ? path.join(o.out, `${name}.mp4`) : null,
    }));
    const encoding = {
      crf: o.encoding?.crf ?? 12,
      preset: o.encoding?.preset ?? 'slow',
      pixFmt: o.encoding?.pixFmt ?? 'yuv444p',
    };
    if (o.out) {
      fs.mkdirSync(o.out, {recursive: true});
      encoder = openEncoder({outputs, fps: o.fps, ...encoding});
    }
    if (o.keepDir) fs.mkdirSync(o.keepDir, {recursive: true});

    const plan = o.plan ? o.plan() : new Plan({fps: o.fps});
    const {frames, seconds} = await runFrameLoop({
      page,
      fps: o.fps,
      now0,
      start: o.start,
      from: o.from,
      to: o.to,
      plan,
      parkAt: parkPoint(o.viewport),
      components: measured,
      songAt: o.songAt ?? null,
      hooks: o.hooks ?? {},
      log,
      async onShot(png, f) {
        if (encoder) await encoder.write(png);
        if (o.keepDir && o.keepFrames?.has(f))
          fs.writeFileSync(path.join(o.keepDir, `${o.id}-${f}.png`), png);
      },
    });
    if (encoder) await encoder.close();
    encoder = null;
    const errors = await page.eval('window.__recClock.errors()');
    const manifest = buildManifest({
      id: o.id,
      app: o.app,
      description: o.description,
      fps: o.fps,
      viewport: o.viewport,
      from: o.from,
      to: o.to,
      songAt: o.songAt ?? null,
      outputs,
      interactions: plan.notes,
      frames,
      encoding: o.out
        ? {codec: 'h264', ...encoding, colorspace: 'bt709 limited'}
        : null,
      pageErrors: [...errors, ...exceptions],
      extra: o.extra ? o.extra() : {},
    });
    if (o.out) writeManifest(o.out, manifest);
    log(
      `done: ${frames.length} frames in ${seconds.toFixed(1)} s, page errors ${manifest.pageErrors.length}`,
    );
    if (manifest.pageErrors.length) log(manifest.pageErrors.join('\n'));
    return manifest;
  } catch (error) {
    if (encoder) encoder.kill();
    throw error;
  } finally {
    await closeTab(browser, page);
    browser.close();
  }
}
