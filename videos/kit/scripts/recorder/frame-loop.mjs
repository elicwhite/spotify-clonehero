// The frame loop. For every film frame: pin the app's own clock (a hook),
// move the virtual clock to the frame's time firing due timers, send the
// frame's input, let the page run one animation frame and paint, take one
// screenshot, read the frame's data back (a hook) and check that the app
// kept time (a hook). Nothing in the page can see real time pass, so
// capture speed never shows in the result.
//
// Frames before `from` are played (the pre-roll: the app settles into
// playback, scripted setup input lands) but not captured.

import {Executor} from './gestures.mjs';
import {overComponent} from './manifest.ts';

/**
 * Hooks, all optional:
 * - pin(f): page statements run first on frame f, before the clock moves
 *   (pin the app's own clock to the film's time; may `await`).
 * - live: a page expression read on frames whose plan steps need targets.
 * - read(f): a page expression read after each captured frame.
 * - frameData(value, {f, page, cursor}): fields for the frame's record,
 *   from what `read` returned (may be async).
 * - assertSync(value, f): throw when the app is out of step with the film.
 */
export async function runFrameLoop({
  page,
  fps,
  now0,
  start,
  from,
  to,
  plan,
  parkAt,
  components,
  songAt = null,
  hooks = {},
  onShot,
  log = () => {},
}) {
  const executor = new Executor(page, plan, parkAt);
  const frames = [];
  const t = Date.now();
  let last = null;
  for (let f = start; f <= to; f++) {
    const vNow = now0 + ((f - start) * 1000) / fps;
    const live = await page.eval(`(async () => {
      ${hooks.pin ? hooks.pin(f) : ''}
      await window.__recClock.advance(${vNow});
      return ${hooks.live && plan.needsLive(f) ? hooks.live : 'null'};
    })()`);
    let cursor;
    try {
      cursor = await executor.frame(f, live);
      last = await page.eval('window.__recClock.frame()');
    } catch (error) {
      throw new Error(`frame ${f}: ${error.message}`);
    }
    if (f < from) continue;
    const shot = await page.send('Page.captureScreenshot', {
      format: 'png',
      optimizeForSpeed: true,
      captureBeyondViewport: false,
    });
    await onShot(Buffer.from(shot.data, 'base64'), f);
    const value = hooks.read ? await page.eval(hooks.read(f)) : null;
    if (hooks.assertSync) {
      try {
        hooks.assertSync(value, f);
      } catch (error) {
        throw new Error(`frame ${f}: ${error.message}`);
      }
    }
    const data = hooks.frameData
      ? await hooks.frameData(value, {f, page, cursor})
      : {};
    frames.push({
      f,
      ...(songAt ? {songSec: +songAt(f).songSec.toFixed(6)} : {}),
      cursor: {
        x: +cursor.x.toFixed(2),
        y: +cursor.y.toFixed(2),
        down: cursor.down,
        visible: !cursor.parked,
        over: cursor.parked ? null : overComponent(cursor, components),
        events: cursor.events.length ? cursor.events : undefined,
      },
      ...data,
    });
    // Progress once per second of film.
    if ((f - from) % Math.round(fps) === 0) {
      const rate = (f - from + 1) / ((Date.now() - t) / 1000);
      log(
        `frame ${f}: rafs ${last.callbacks} anim ${last.animations} (${rate.toFixed(2)} fps)`,
      );
    }
  }
  return {frames, seconds: (Date.now() - t) / 1000};
}
