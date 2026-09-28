// What a chart editor spec needs beyond the generic plan (../../gestures.mjs):
// live targets resolved from the product's own state every frame, calls into
// the editor's own WebMCP editing tools, and the roll's held views. See
// README.md in this folder.

import {
  laneBand,
  rollLayout,
  rollOffset,
  rollPoint,
  tickToMs,
} from './layout.mjs';

/** The components most editor takes export (those on screen are kept). */
export const EDITOR_COMPONENTS = [
  'window',
  'siteHeader',
  'songHeader',
  'sidebar',
  'chartMatrix',
  'chartAssist',
  'highways',
  'transport',
  'pianoRoll',
];

/** Index of a lane by its product name ("Red", "Kick", "Open") in a roll row. */
const laneIndex = (roll, name, row = 0) => {
  const lanes = rollLayout(roll).rows[row].lanes;
  const i = lanes.findIndex(l => l.toLowerCase() === name.toLowerCase());
  if (i < 0)
    throw new Error(`no lane ${name} in row ${row} (${lanes.join(', ')})`);
  return i;
};

/** The point of (song ms, lane) in the roll this frame; see `at`. */
const pointAt = (live, ms, lane, {dx = 0, dy = 0, row = 0, edge} = {}) => {
  const i = laneIndex(live.roll, lane, row);
  const p = rollPoint(live.roll, {ms, lane: i, row, dx});
  if (edge === 'top') p.y = laneBand(live.roll, i, row).top + 3;
  else if (edge === 'bottom') p.y = laneBand(live.roll, i, row).bottom - 3;
  p.y += dy;
  return p;
};

/**
 * A live target at (song seconds, lane) in the piano roll, resolved against
 * the roll's view and layout on the frame it is used. `edge: 'top'|'bottom'`
 * puts it 3 px inside that lane edge; dx/dy offset in CSS px.
 */
export const at = (sec, lane, opts) => live =>
  pointAt(live, sec * 1000, lane, opts);

/** `at` for a chart tick, timed by the roll's own tempo map (`tickToMs`). */
export const atTick = (tick, lane, opts) => live =>
  pointAt(live, tickToMs(live.roll, tick), lane, opts);

/**
 * Call one of the editor's own WebMCP tools (editor_add_note, editor_seek,
 * editor_select_note, ...) from a plan step: `plan.call(frame, tool('editor_add_note', {...}))`.
 * Several calls on one frame are fine: each waits for the editor to commit.
 */
export const tool =
  (name, input = {}) =>
  async page => {
    const result = await page.eval(`(async () => {
    const r = await navigator.modelContextTesting.executeTool(${JSON.stringify(name)}, ${JSON.stringify(JSON.stringify(input))});
    await window.__recClock.settle();
    return r;
  })()`);
    const text = (() => {
      try {
        return JSON.parse(result).content[0].text;
      } catch {
        return String(result);
      }
    })();
    if (/^(No |Unknown|Not editing|Provide)/.test(text))
      throw new Error(`${name}: ${text}`);
    return text;
  };

/**
 * Scroll the roll (horizontal wheel over it, the product's own pan) so its
 * left edge lands on `leftSec`, on `frame`. While playing, that also turns
 * the roll's follow mode off, so the view then holds still while the
 * playhead moves. The pointer parks again on the next frame.
 */
export const panRoll = (plan, frame, leftSec) => {
  plan.wheel(
    frame,
    live => {
      const L = rollLayout(live.roll);
      // Over the waveform row: no note under the pointer, no hover halo.
      return {x: L.originX + L.width / 2, y: L.visibleBottom + 20};
    },
    {
      deltaX: live => rollOffset(live.roll.view, leftSec * 1000),
      hidden: true,
    },
  );
  plan.park(frame + 1);
  plan.note(
    frame,
    frame,
    'view',
    `horizontal wheel over the roll: follow off, left edge at ${leftSec} s`,
  );
  return plan;
};
