// Where things are in the running chart editor, from what the product
// reports (the probe in probe.js) plus the piano roll's band layout. A song
// time's x is src/recorder's `rollX`, the one films place overlays with.
//
// The band constants below are the piano roll's own layout
// (APP/components/chart-editor/piano-roll/sceneTypes.ts): ruler, lyrics row,
// tempo lane, note lanes and waveform row, and in the stacked layout a
// 112 px gutter and 20 px lanes under a 22 px row header. `rollLayout`
// checks them against the canvases it can measure.

import {rollX} from '../../../../src/recorder/roll.ts';

const ROLL = {
  RULER_H: 24,
  LYRICS_ROW_H: 22,
  TEMPO_H: 26,
  WAVE_ROW_H: 40,
  GUTTER_W: 112,
  ROW_HEADER_H: 22,
  STACKED_LANE_H: 20,
};

/** Tick -> ms under the chart's tempo map (as the roll reports it). */
export function tickToMs(roll, tick) {
  let t = roll.timedTempos[0];
  for (const x of roll.timedTempos) if (x.tick <= tick) t = x;
  return t.msTime + ((tick - t.tick) * 60000) / (t.bpm * roll.resolution);
}

/** Distance (CSS px) from a roll view's left edge (`leftMs`) to song time `ms`. */
export const rollOffset = (view, ms) => rollX({...view, originX: 0}, ms);

/** The roll's lane geometry in viewport CSS px. */
export function rollLayout(roll) {
  const laneTop =
    ROLL.RULER_H + (roll.lyricsVisible ? ROLL.LYRICS_ROW_H : 0) + ROLL.TEMPO_H;
  const rowsCanvas = roll.canvases.find(c => c.region === 'rows');
  const stacked = Boolean(rowsCanvas) && roll.rows.length > 1;
  if (stacked) {
    const top = roll.canvases.find(c => c.region === 'top');
    if (Math.abs(top.height - laneTop) > 0.5) {
      throw new Error(
        `piano roll layout changed: top band is ${top.height}px, expected ${laneTop}px`,
      );
    }
    let cursor = 0;
    const rows = roll.rows.map(r => {
      const g = {
        key: r.key,
        lanes: r.lanes,
        notes: r.notes,
        // Row-local lane band, in the rows canvas' coordinates.
        laneTopY: rowsCanvas.y + cursor + ROLL.ROW_HEADER_H,
        laneH: ROLL.STACKED_LANE_H,
      };
      cursor += ROLL.ROW_HEADER_H + r.lanes.length * ROLL.STACKED_LANE_H;
      return g;
    });
    return {
      stacked,
      originX: top.x + ROLL.GUTTER_W,
      width: top.width - ROLL.GUTTER_W,
      rulerY: top.y,
      rows,
      // The rows scroll inside the panel; only this band is on screen.
      visibleTop: top.y + top.height,
      visibleBottom: roll.canvases.find(c => c.region === 'waveform').y,
    };
  }
  const canvas = roll.canvases.find(c => c.region === null && c.width > 0);
  const laneBottom = canvas.height - ROLL.WAVE_ROW_H;
  const laneH = (laneBottom - laneTop) / roll.lanes.length;
  return {
    stacked,
    originX: canvas.x,
    width: canvas.width,
    rulerY: canvas.y,
    rows: [
      {
        key: roll.activeTrackKey,
        lanes: roll.lanes,
        notes: roll.notes,
        laneTopY: canvas.y + laneTop,
        laneH,
      },
    ],
    visibleTop: canvas.y + laneTop,
    visibleBottom: canvas.y + laneBottom,
  };
}

/** Viewport point of (song ms, lane) in a row of the roll. */
export function rollPoint(roll, {ms, lane, row = 0, dx = 0, dy = 0}) {
  const L = rollLayout(roll);
  const r = L.rows[row];
  if (!r) throw new Error(`no piano-roll row ${row}`);
  return {
    x: rollX({...roll.view, originX: L.originX}, ms) + dx,
    y: r.laneTopY + (lane + 0.5) * r.laneH + dy,
  };
}

/** Lane edges (top/bottom y) of a lane in a row. */
export function laneBand(roll, lane, row = 0) {
  const r = rollLayout(roll).rows[row];
  return {
    top: r.laneTopY + lane * r.laneH,
    bottom: r.laneTopY + (lane + 1) * r.laneH,
    height: r.laneH,
  };
}

const trackId = key => (key ? `${key.instrument}:${key.difficulty}` : null);
const r2 = v => Math.round(v * 100) / 100;

/**
 * The roll's geometry for one frame, split into the part that only changes
 * with the layout (`layout`) and the part that moves every frame (`view`).
 * All in viewport CSS px.
 */
export function frameGeometry(roll, songMs) {
  const L = rollLayout(roll);
  const top = L.rulerY;
  const lyricsH = roll.lyricsVisible ? ROLL.LYRICS_ROW_H : 0;
  const tempoTop = top + ROLL.RULER_H + lyricsH;
  const wave = L.stacked
    ? roll.canvases.find(c => c.region === 'waveform')
    : (() => {
        const c = roll.canvases.find(x => x.region === null && x.width > 0);
        return {y: c.y + c.height - ROLL.WAVE_ROW_H, height: ROLL.WAVE_ROW_H};
      })();
  const band = (a, b) => ({top: r2(a), bottom: r2(b)});
  const layout = {
    stacked: L.stacked,
    panel: {
      x: r2(roll.container.x),
      y: r2(roll.container.y),
      width: r2(roll.container.width),
      height: r2(roll.container.height),
    },
    originX: r2(L.originX),
    laneWidth: r2(L.width),
    gutter: L.stacked
      ? {left: r2(roll.container.x), right: r2(L.originX)}
      : null,
    bands: {
      ruler: band(top, top + ROLL.RULER_H),
      lyrics: lyricsH
        ? band(top + ROLL.RULER_H, top + ROLL.RULER_H + lyricsH)
        : null,
      tempo: band(tempoTop, tempoTop + ROLL.TEMPO_H),
      lanes: band(L.visibleTop, L.visibleBottom),
      waveform: band(wave.y, wave.y + wave.height),
    },
    rows: L.rows.map(r => ({
      track: trackId(r.key),
      headerTop: L.stacked ? r2(r.laneTopY - ROLL.ROW_HEADER_H) : null,
      laneTop: r2(r.laneTopY),
      laneH: r2(r.laneH),
      lanes: r.lanes.map((name, i) => ({
        name,
        top: r2(r.laneTopY + i * r.laneH),
        bottom: r2(r.laneTopY + (i + 1) * r.laneH),
      })),
    })),
  };
  const v = roll.view;
  return {
    layout,
    view: {
      leftMs: +v.leftMs.toFixed(4),
      pxPerMs: +v.pxPerMs.toFixed(8),
      follow: v.follow,
      playheadX: r2(rollX({...v, originX: L.originX}, songMs)),
    },
  };
}
