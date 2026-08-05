/**
 * Pure canvas-2D painters for the piano-roll panel's bands: the beat grid,
 * note glyphs (with drag/resize/placement previews and the add-mode ghost),
 * the tempo lane, the lyrics row, the time ruler with its section and A/B
 * loop flags, the waveform row, the lane labels, and the stacked-view
 * gutter. Every function takes an already-transformed context plus the
 * derived scene and view — no React, no store access, no state of its own.
 */

import {msToTick, tickToMs} from '@/lib/drum-transcription/timing';
import {drums4LaneSchema, padLaneRange} from '@/lib/chart-edit';
import type {LoopRegion} from '@/lib/preview/loopRegion';
import type {ProspectiveNote} from '../editing/prospectiveNote';
import {
  glyphWidth,
  msToX,
  visibleMsRange,
  xToMs,
  type PianoRollView,
} from './viewMath';
import {
  isGuitarBassSchema,
  noteIntersectsPianoRollWindow,
  techniqueForFlags,
  type FretTechnique,
  type PianoRollLane,
  type PianoRollNote,
} from './notes';
import {LYRIC_CHIP_PAD_LEFT, LYRIC_CHIP_PAD_RIGHT} from './hitTest';
import {TS_CHIP_H, TS_CHIP_TOP, tsChipRect} from './tempoHitTest';
import {
  lyricChipPreviewTick,
  phraseEdgeMarkers,
  PHRASE_EDGE_FLAG_H,
  PHRASE_EDGE_FLAG_W,
  PHRASE_EDGE_LINE_W,
} from './lyricsScene';
import {loopFlagXs} from './loopFlags';
import {sampleAmpRange, type AmpPyramid} from './wavePeaks';
import {
  COLORS,
  OVERLAY_COLORS,
  RULER_H,
  TEMPO_H,
  rowLabel,
  type ChartScene,
  type LyricDrag,
  type PanelNoteDrag,
  type PanelNoteResize,
  type PanelPlaceNote,
  type PhraseEdgeDrag,
  type SectionDrag,
  type TempoMarkerDrag,
  type TimeSignatureDrag,
  type TrackRowGeometry,
} from './sceneTypes';

export function drawGrid(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  laneTop: number,
  laneBottom: number,
  view: PianoRollView,
  scene: ChartScene,
): void {
  const [msA, msB] = visibleMsRange(view, w);
  const beats = scene.beats;
  // Visible beat window.
  let a = 0;
  while (a < beats.length && beats[a].ms < msA - 50) a++;
  let b = beats.length - 1;
  while (b > a && beats[b].ms > msB + 50) b--;
  const visibleCount = Math.max(1, b - a);
  const avgBeatPx = w / visibleCount;

  ctx.lineWidth = 1;
  for (let i = a; i <= b && i < beats.length; i++) {
    const beat = beats[i];
    const x = Math.round(msToX(beat.ms, view)) + 0.5;
    if (beat.isDownbeat) {
      ctx.strokeStyle = COLORS.gridBar;
      ctx.beginPath();
      ctx.moveTo(x, RULER_H);
      ctx.lineTo(x, laneBottom);
      ctx.stroke();
      ctx.strokeStyle = COLORS.gridSub;
      ctx.beginPath();
      ctx.moveTo(x, laneBottom);
      ctx.lineTo(x, h);
      ctx.stroke();
    } else if (avgBeatPx > 10) {
      ctx.strokeStyle = COLORS.gridBeat;
      ctx.beginPath();
      ctx.moveTo(x, laneTop);
      ctx.lineTo(x, laneBottom);
      ctx.stroke();
    }
    // Subdivisions appear progressively with zoom.
    if (i + 1 < beats.length && avgBeatPx > 46) {
      const per = avgBeatPx > 110 ? 4 : 2;
      ctx.strokeStyle = COLORS.gridSub;
      const beatMs = beat.ms;
      const nextMs = beats[i + 1].ms;
      for (let s = 1; s < per; s++) {
        const sx =
          Math.round(msToX(beatMs + ((nextMs - beatMs) * s) / per, view)) + 0.5;
        ctx.beginPath();
        ctx.moveTo(sx, laneTop);
        ctx.lineTo(sx, laneBottom);
        ctx.stroke();
      }
    }
  }
}

export function drawNotes(
  ctx: CanvasRenderingContext2D,
  w: number,
  laneTop: number,
  laneH: number,
  view: PianoRollView,
  scene: ChartScene,
  selection: ReadonlySet<string>,
  hoverId: string | null,
  drag: PanelNoteDrag | null,
  resize: PanelNoteResize | null,
  place: PanelPlaceNote | null,
  ghost: ProspectiveNote | null,
): void {
  const [msA, msB] = visibleMsRange(view, w);
  const nh = Math.min(laneH - 6, 13);
  // Local ms-per-tick near the viewport center for glyph sizing.
  const centerMs = (msA + msB) / 2;
  const centerTick = msToTick(centerMs, scene.timedTempos, scene.resolution);
  const msPerTick =
    (tickToMs(
      centerTick + scene.resolution,
      scene.timedTempos,
      scene.resolution,
    ) -
      tickToMs(centerTick, scene.timedTempos, scene.resolution)) /
    scene.resolution;
  const nw = glyphWidth({
    gridStepTicks: scene.resolution / 4,
    msPerTick,
    pxPerMs: view.pxPerMs,
    glyphHeight: nh,
  });
  const guitarBass = isGuitarBassSchema(scene.schema);

  // One glyph painter (triangle for cymbals, rounded rect for kick/tom) so the
  // ghost preview is pixel-identical to a real note at the same size.
  const paintGlyph = (gx: number, gcy: number, isCymbal: boolean): void => {
    if (isCymbal) {
      ctx.beginPath();
      ctx.moveTo(gx, gcy - nh * 0.62);
      ctx.lineTo(gx + nw * 0.6, gcy + nh * 0.5);
      ctx.lineTo(gx - nw * 0.6, gcy + nh * 0.5);
      ctx.closePath();
      ctx.fill();
    } else {
      roundRect(ctx, gx - nw / 2, gcy - nh / 2, nw, nh, Math.min(2.5, nw / 3));
      ctx.fill();
    }
  };

  const paintFretGlyph = (
    gx: number,
    gcy: number,
    technique: FretTechnique,
    open: boolean,
    color: string,
  ): void => {
    const glyphW = open ? Math.max(nw * 1.35, nh * 1.05) : nw;
    if (technique === 'tap') {
      ctx.beginPath();
      ctx.moveTo(gx, gcy - nh * 0.68);
      ctx.lineTo(gx + glyphW * 0.58, gcy);
      ctx.lineTo(gx, gcy + nh * 0.68);
      ctx.lineTo(gx - glyphW * 0.58, gcy);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.beginPath();
      ctx.arc(gx, gcy, Math.max(1.5, nh * 0.16), 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    if (technique === 'hopo') {
      roundRect(
        ctx,
        gx - glyphW / 2,
        gcy - nh / 2,
        glyphW,
        nh,
        Math.min(3, glyphW / 3),
      );
      ctx.fillStyle = 'rgba(14,18,28,0.85)';
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1.25, nh * 0.14);
      ctx.stroke();
      return;
    }
    roundRect(
      ctx,
      gx - glyphW / 2,
      gcy - nh / 2,
      glyphW,
      nh,
      Math.min(3, glyphW / 3),
    );
    ctx.fill();
    if (technique === 'strum') {
      ctx.fillStyle = 'rgba(255,255,255,0.72)';
      ctx.fillRect(
        gx - Math.min(1, glyphW / 8),
        gcy - nh * 0.34,
        Math.min(2, glyphW / 4),
        nh * 0.68,
      );
    }
  };

  const paintFretSustain = (
    startX: number,
    endX: number,
    centerY: number,
    color: string,
  ): void => {
    const sustainHeight = Math.max(6, nh * 0.76);
    ctx.fillStyle = color;
    roundRect(
      ctx,
      startX,
      centerY - sustainHeight / 2,
      Math.max(2, endX - startX),
      sustainHeight,
      Math.min(3, sustainHeight / 3),
    );
    ctx.fill();
  };

  const dragActive = drag?.active === true;
  const halfW = Math.max(nw, nh) / 2 + 2.5;
  const visibleNotes: Array<{
    note: PianoRollNote;
    lane: number;
    cymbal: boolean;
    length: number;
    ms: number;
    endMs: number;
    x: number;
    cy: number;
    technique: FretTechnique;
    selected: boolean;
  }> = [];
  for (const note of scene.notes) {
    const selected = selection.has(note.id);
    // Drag preview: selected notes render at their would-be drop position.
    let lane = note.lane;
    let tick = note.tick;
    let cymbal = note.cymbal;
    let length = guitarBass ? Math.max(0, note.length ?? 0) : 0;
    if (dragActive && selected) {
      tick = Math.max(0, note.tick + drag.tickDelta);
      const {min: minPadLane, max: maxPadLane} = padLaneRange(
        scene.schema ?? drums4LaneSchema,
      );
      const isPad = note.lane >= minPadLane && note.lane <= maxPadLane;
      if (drag.laneDelta !== 0 && isPad) {
        lane = Math.max(
          minPadLane,
          Math.min(maxPadLane, note.lane + drag.laneDelta),
        );
      }
      // Would-be drop on an illegal lane renders as a tom.
      cymbal = cymbal && !!scene.lanes[lane]?.cymbalOk;
    }
    const ms = tickToMs(tick, scene.timedTempos, scene.resolution);
    if (resize?.active) {
      const resizeDelta = resize.currentLength - resize.originalLength;
      if (selected) length = Math.max(0, length + resizeDelta);
    }
    if (resize?.noteId === note.id && resize.active)
      length = resize.currentLength;
    const endMs = guitarBass
      ? tickToMs(tick + length, scene.timedTempos, scene.resolution)
      : ms;
    if (
      !noteIntersectsPianoRollWindow(ms, endMs, msA, msB) &&
      !(dragActive && selected)
    ) {
      continue;
    }
    if (ms > msB + 50 && !(dragActive && selected)) {
      // Notes are tick-sorted, so when nothing is dragging nothing later is
      // visible; during a drag a selected note may be shifted off-window so
      // we keep scanning.
      if (!dragActive) break;
      continue;
    }
    const x = msToX(ms, view);
    const cy = laneTop + lane * laneH + laneH / 2;
    const technique = techniqueForFlags(note.flags ?? 0);
    visibleNotes.push({
      note,
      lane,
      cymbal,
      length,
      ms,
      endMs,
      x,
      cy,
      technique,
      selected,
    });
  }

  // Paint every sustain before any note head. A long tail may overlap the
  // head-time window of a later note, but it must never cover that note.
  if (guitarBass) {
    for (const rendered of visibleNotes) {
      if (rendered.length <= 0) continue;
      const endX = msToX(rendered.endMs, view);
      const tailLeft = rendered.x + nw / 2;
      ctx.globalAlpha = rendered.selected ? 0.9 : 0.78;
      paintFretSustain(
        tailLeft,
        endX,
        rendered.cy,
        scene.lanes[rendered.lane]?.color ?? COLORS.laneLabel,
      );
      ctx.globalAlpha = 1;
    }
  }

  // Heads and their interaction affordances are painted after all tails.
  for (const rendered of visibleNotes) {
    const {note, lane, cymbal, x, cy, technique, selected} = rendered;
    if (selected) {
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      roundRect(ctx, x - halfW, cy - nh / 2 - 2.5, halfW * 2, nh + 5, 3);
      ctx.fill();
    } else if (note.id === hoverId) {
      ctx.fillStyle = OVERLAY_COLORS.hoverHalo;
      roundRect(ctx, x - halfW, cy - nh / 2 - 2.5, halfW * 2, nh + 5, 3);
      ctx.fill();
    }
    ctx.fillStyle = scene.lanes[lane]?.color ?? COLORS.laneLabel;
    if (guitarBass) {
      paintFretGlyph(
        x,
        cy,
        technique,
        lane === 0,
        scene.lanes[lane]?.color ?? COLORS.laneLabel,
      );
    } else {
      paintGlyph(x, cy, cymbal);
    }

    if (
      rendered.length > 0 &&
      (selected || note.id === hoverId || resize?.noteId === note.id)
    ) {
      const endX = msToX(rendered.endMs, view);
      ctx.globalAlpha = 0.95;
      ctx.fillRect(endX - 1, cy - nh * 0.42, 2, nh * 0.84);
    }
    ctx.globalAlpha = 1;
  }

  // Add-mode ghost: the note a click would place, drawn semi-transparent on
  // the hovered lane at the snapped tick. Never hit-tested (it's paint only).
  if (ghost) {
    const gms = tickToMs(ghost.tick, scene.timedTempos, scene.resolution);
    const gx = msToX(gms, view);
    const gcy = laneTop + ghost.lane * laneH + laneH / 2;
    if (gx >= -halfW && gx <= w + halfW) {
      if (guitarBass && place?.active) {
        const length = Math.max(0, place.currentTick - place.startTick);
        if (length > 0) {
          const endX = msToX(
            tickToMs(
              place.startTick + length,
              scene.timedTempos,
              scene.resolution,
            ),
            view,
          );
          ctx.globalAlpha = 0.35;
          paintFretSustain(
            gx + nw / 2,
            endX,
            gcy,
            scene.lanes[ghost.lane]?.color ?? COLORS.laneLabel,
          );
          ctx.globalAlpha = 1;
        }
      }
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = scene.lanes[ghost.lane]?.color ?? COLORS.laneLabel;
      if (guitarBass) {
        const ghostTechnique = techniqueForFlags(ghost.flags);
        paintFretGlyph(
          gx,
          gcy,
          ghostTechnique,
          ghost.lane === 0,
          scene.lanes[ghost.lane]?.color ?? COLORS.laneLabel,
        );
      } else {
        paintGlyph(gx, gcy, ghost.cymbal);
      }
      ctx.globalAlpha = 1;
    }
  }
}

/**
 * The tempo lane: sparse BPM markers and one chip per authored time
 * signature. `tsWidthsOut` is populated with each chip's measured label width
 * so `hitTsChip` tests the SAME pill that was painted — the menu and the drag
 * can only ever target a signature that is really drawn here.
 */
export function drawTempoLane(
  ctx: CanvasRenderingContext2D,
  w: number,
  view: PianoRollView,
  scene: ChartScene,
  hoverMarker: number,
  tempoDrag: TempoMarkerDrag | null,
  top: number,
  tsWidthsOut: Map<number, number>,
  tsDrag: TimeSignatureDrag | null,
  hoverTsTick: number | null,
): void {
  ctx.fillStyle = COLORS.tempoBg;
  ctx.fillRect(0, top, w, TEMPO_H);
  ctx.strokeStyle = COLORS.gridBeat;
  ctx.beginPath();
  ctx.moveTo(0, top + TEMPO_H + 0.5);
  ctx.lineTo(w, top + TEMPO_H + 0.5);
  ctx.stroke();

  const cy = top + TEMPO_H * 0.62;
  ctx.font = '600 9.5px ui-monospace, Menlo, monospace';
  for (let k = 0; k < scene.tempos.length; k++) {
    const marker = scene.tempos[k];
    const x = msToX(marker.ms, view);
    if (x < -60 || x > w + 20) continue;
    // Marker 0 (song-start anchor) is never a drag/hover target.
    const hot = k > 0 && (hoverMarker === k || tempoDrag?.index === k);
    if (hot) {
      ctx.fillStyle = 'rgba(122,184,255,0.25)';
      ctx.beginPath();
      ctx.arc(x, cy, 9, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = hot ? COLORS.tempoNodeHot : COLORS.tempoNode;
    ctx.beginPath();
    ctx.moveTo(x, cy - 5.5);
    ctx.lineTo(x + 5, cy);
    ctx.lineTo(x, cy + 5.5);
    ctx.lineTo(x - 5, cy);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = COLORS.tempoInk;
    ctx.fillText(marker.bpm.toFixed(1), x + 8, cy + 3.5);
  }

  // One chip per authored time-signature event. Every event gets a chip: an
  // event is the only thing that makes a bar line an authored meter change,
  // and it is what the lane's hit test, remove item and drag all target.
  ctx.font = '700 9.5px system-ui, sans-serif';
  tsWidthsOut.clear();
  for (const ts of scene.timeSignatures) {
    const dragging = tsDrag?.moved === true && tsDrag.originalTick === ts.tick;
    const tw = ctx.measureText(ts.label).width;
    tsWidthsOut.set(ts.tick, tw);
    let ms = ts.ms;
    if (dragging) {
      const gx = Math.round(msToX(ts.ms, view)) + 0.5;
      ctx.strokeStyle = COLORS.ghost;
      ctx.setLineDash([4, 4]);
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      ctx.moveTo(gx, top);
      ctx.lineTo(gx, top + TEMPO_H);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      ms = tickToMs(tsDrag!.currentTick, scene.timedTempos, scene.resolution);
    }
    const x = msToX(ms, view);
    if (x < -50 || x > w + 10) continue;
    const rect = tsChipRect(ms, view, tw);
    const hot = dragging || hoverTsTick === ts.tick;
    ctx.fillStyle = hot ? 'rgba(122,184,255,0.34)' : 'rgba(122,184,255,0.16)';
    roundRect(
      ctx,
      rect.left,
      top + TS_CHIP_TOP,
      rect.right - rect.left,
      TS_CHIP_H,
      3,
    );
    ctx.fill();
    ctx.fillStyle = COLORS.tempoInk;
    ctx.fillText(ts.label, rect.left + 4, top + TS_CHIP_TOP + 9.5);
  }
}

/**
 * Lyrics row: an optional faint vocals waveform (behind everything else), a
 * background band per vocal phrase
 * (line structure at a glance, live-adjusted for an in-flight phrase-edge
 * drag), a solid boundary line with an inward pennant at each phrase start
 * and end, and a small pill per syllable, showing its text. A chip mid-drag
 * renders at its live (unsnapped) tick; a dashed ghost line marks either the
 * drag's original tick or (when idle) the hovered chip's tick, so the grab
 * point is visible before a drag even starts — the same ghost-line
 * convention the tempo-marker and section-flag drags use elsewhere in this
 * file. `widthsOut` is populated with each chip's measured pill width so
 * `pickLyricChipAt` can hit-test the SAME rect that's painted here.
 */
export function drawLyricsRow(
  ctx: CanvasRenderingContext2D,
  w: number,
  view: PianoRollView,
  scene: ChartScene,
  top: number,
  height: number,
  selection: ReadonlySet<string>,
  hoverId: string | null,
  drag: LyricDrag | null,
  ghostTick: number | null,
  widthsOut: Map<string, number>,
  vocalsWave: AmpPyramid | null,
  phraseEdgeDrag: PhraseEdgeDrag | null,
  /** Tick delta from an active NOTE-anchored drag (mode 'drag'), so
   *  co-selected lyrics preview moving together with the notes rather than
   *  only snapping into place when the note drag commits. Null when no
   *  note drag is active; ignored when `drag` (a lyric-anchored drag) is
   *  active — that one already carries its own per-chip deltas below. */
  noteDragTickDelta: number | null,
): void {
  widthsOut.clear();

  ctx.fillStyle = COLORS.lyricsBg;
  ctx.fillRect(0, top, w, height);

  if (vocalsWave && vocalsWave.levels.length > 0) {
    drawWave(
      ctx,
      w,
      top,
      top + height,
      view,
      vocalsWave,
      COLORS.lyricWave,
      0.35,
    );
  }

  ctx.strokeStyle = COLORS.gridBeat;
  ctx.beginPath();
  ctx.moveTo(0, top + height + 0.5);
  ctx.lineTo(w, top + height + 0.5);
  ctx.stroke();

  // Live-preview a phrase-edge drag: the dragged edge renders at its current
  // (unsnapped) tick rather than the band's static bound, so the band visibly
  // grows/shrinks under the pointer during the resize. These are the ms
  // values the row actually paints, shared by the band fills and the phrase
  // boundary lines below.
  const paintedBands = scene.lyricBands.map(band => {
    let ms = band.ms;
    let msEnd = band.msEnd;
    if (phraseEdgeDrag) {
      if (
        phraseEdgeDrag.kind === 'phrase-start' &&
        band.tick === phraseEdgeDrag.originalTick
      ) {
        ms = tickToMs(
          phraseEdgeDrag.currentTick,
          scene.timedTempos,
          scene.resolution,
        );
      } else if (
        phraseEdgeDrag.kind === 'phrase-end' &&
        band.tickEnd === phraseEdgeDrag.originalTick
      ) {
        msEnd = tickToMs(
          phraseEdgeDrag.currentTick,
          scene.timedTempos,
          scene.resolution,
        );
      }
    }
    return {ms, msEnd};
  });

  for (const band of paintedBands) {
    const x0 = msToX(band.ms, view);
    const x1 = msToX(band.msEnd, view);
    if (x1 < 0 || x0 > w) continue;
    const bx = Math.max(0, x0);
    const bw = Math.min(w, x1) - bx;
    if (bw <= 0) continue;
    ctx.fillStyle = COLORS.lyricBand;
    ctx.fillRect(bx, top + 2, bw, height - 4);
  }

  // Phrase boundaries: a solid full-height line at each edge, topped with a
  // pennant pointing into the phrase. Green + right-pointing marks a start,
  // orange + left-pointing marks an end, which keeps both apart from each
  // other, from the amber and purple DASHED drag ghosts drawn just below,
  // and from the ruler's bar ticks and gold section flags. Painted before
  // the syllable chips so the pills and their text sit on top.
  ctx.lineWidth = PHRASE_EDGE_LINE_W;
  for (const marker of phraseEdgeMarkers(paintedBands, view, w)) {
    const color =
      marker.kind === 'start' ? COLORS.phraseStart : COLORS.phraseEnd;
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.moveTo(marker.x, top + 1);
    ctx.lineTo(marker.x, top + height - 1);
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(marker.x, top + 1);
    ctx.lineTo(marker.x + marker.flagDirection * PHRASE_EDGE_FLAG_W, top + 1);
    ctx.lineTo(marker.x, top + 1 + PHRASE_EDGE_FLAG_H);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  ctx.lineWidth = 1;

  // Phrase-edge drag ghost: a dashed line at the edge's original position,
  // once the drag has actually moved past its origin.
  if (phraseEdgeDrag && phraseEdgeDrag.moved) {
    const gx =
      Math.round(
        msToX(
          tickToMs(
            phraseEdgeDrag.originalTick,
            scene.timedTempos,
            scene.resolution,
          ),
          view,
        ),
      ) + 0.5;
    ctx.strokeStyle = COLORS.phraseEdge;
    ctx.setLineDash([3, 3]);
    ctx.globalAlpha = 0.6;
    ctx.beginPath();
    ctx.moveTo(gx, top);
    ctx.lineTo(gx, top + height);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  // Chip drag/hover ghost line: drag origin while dragging, else the
  // hovered chip's tick.
  if (ghostTick !== null) {
    const gx =
      Math.round(
        msToX(tickToMs(ghostTick, scene.timedTempos, scene.resolution), view),
      ) + 0.5;
    ctx.strokeStyle = COLORS.ghost;
    ctx.setLineDash([3, 3]);
    ctx.globalAlpha = 0.6;
    ctx.beginPath();
    ctx.moveTo(gx, top);
    ctx.lineTo(gx, top + height);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  ctx.font = '600 9.5px system-ui, sans-serif';
  for (const chip of scene.lyricChips) {
    // The drag's own chip tracks the pointer directly; every OTHER selected
    // chip previews riding along at the same tick delta (a lyric-anchored
    // drag's, or a note-anchored drag's when notes+lyrics are dragged
    // together), clamped to its own phrase — mirroring the group-move
    // commit in `endPointer` — so a group drag visibly moves together
    // instead of only the grabbed chip animating and the rest snapping into
    // place on release. See `lyricChipPreviewTick`.
    const previewTick = lyricChipPreviewTick(
      chip,
      selection.has(chip.id),
      drag,
      noteDragTickDelta,
    );
    const ms = tickToMs(previewTick, scene.timedTempos, scene.resolution);
    const x = msToX(ms, view);
    const tw = ctx.measureText(chip.text).width;
    widthsOut.set(chip.id, tw);
    if (x < -60 || x > w + 10) continue;
    const selected = selection.has(chip.id);
    const hovered = chip.id === hoverId;
    ctx.globalAlpha = selected ? 0.42 : hovered ? 0.28 : 0.16;
    ctx.fillStyle = COLORS.lyricChip;
    roundRect(
      ctx,
      x - LYRIC_CHIP_PAD_LEFT,
      top + 3,
      tw + LYRIC_CHIP_PAD_LEFT + LYRIC_CHIP_PAD_RIGHT,
      height - 6,
      3,
    );
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = selected ? '#f4e9ff' : COLORS.lyricChip;
    ctx.fillText(chip.text, x + 2, top + height - 7);
  }
}

export function drawRuler(
  ctx: CanvasRenderingContext2D,
  w: number,
  view: PianoRollView,
  scene: ChartScene,
  laneBottom: number,
  sectionDrag: SectionDrag | null,
  loop: LoopRegion | null,
): void {
  ctx.fillStyle = COLORS.rulerBg;
  ctx.fillRect(0, 0, w, RULER_H);
  ctx.strokeStyle = COLORS.gridBeat;
  ctx.beginPath();
  ctx.moveTo(0, RULER_H + 0.5);
  ctx.lineTo(w, RULER_H + 0.5);
  ctx.stroke();

  // A/B loop band, painted before the bar ticks and section flags so the
  // translucent blue never sits on top of them.
  if (loop) {
    const {startX, endX} = loopFlagXs(loop, view);
    const left = Math.min(startX, endX);
    ctx.fillStyle = COLORS.loopShade;
    ctx.fillRect(left, 0, Math.abs(endX - startX), RULER_H);
  }

  const bars = scene.beats.filter(b => b.isDownbeat);
  const [msA, msB] = visibleMsRange(view, w);
  // Average bar spacing in px over the visible window, for label thinning.
  let visibleBars = 0;
  for (const bar of bars)
    if (bar.ms >= msA - 100 && bar.ms <= msB + 100) visibleBars++;
  const avgBarPx = w / Math.max(1, visibleBars);
  const labelEvery =
    avgBarPx > 44 ? 1 : avgBarPx > 22 ? 2 : avgBarPx > 11 ? 4 : 8;

  ctx.font = '500 10px ui-monospace, Menlo, monospace';
  for (const bar of bars) {
    const x = msToX(bar.ms, view);
    if (x < -40 || x > w + 40) continue;
    ctx.strokeStyle = COLORS.gridBar;
    ctx.beginPath();
    ctx.moveTo(Math.round(x) + 0.5, RULER_H - 7);
    ctx.lineTo(Math.round(x) + 0.5, RULER_H);
    ctx.stroke();
    if ((bar.barNumber - 1) % labelEvery === 0) {
      ctx.fillStyle = COLORS.rulerInk;
      ctx.fillText(String(bar.barNumber), x + 3, RULER_H - 9);
    }
  }

  // Section flags (colored stem + label) — click-to-seek targets, and
  // draggable: a flag being dragged renders at the pointer's
  // grid-snapped tick with a dashed ghost line marking its original
  // position, mirroring the tempo-marker drag's ghost.
  ctx.font = '600 10px system-ui, sans-serif';
  for (const s of scene.sections) {
    const dragging =
      sectionDrag?.moved === true && sectionDrag.originalTick === s.tick;
    let x = msToX(s.ms, view);
    if (dragging) {
      const gx = Math.round(x) + 0.5;
      ctx.strokeStyle = COLORS.ghost;
      ctx.setLineDash([4, 4]);
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      ctx.moveTo(gx, 2);
      ctx.lineTo(gx, laneBottom);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      x = msToX(
        tickToMs(sectionDrag!.currentTick, scene.timedTempos, scene.resolution),
        view,
      );
    }
    if (x > w + 10) continue;
    const tw = ctx.measureText(s.name).width;
    if (x + tw + 14 < 0) continue;
    ctx.fillStyle = COLORS.sectionFlag;
    ctx.fillRect(x, 2, 2, RULER_H - 4);
    ctx.globalAlpha = dragging ? 0.3 : 0.18;
    ctx.fillRect(x + 2, 2, tw + 10, 12);
    ctx.globalAlpha = 1;
    ctx.fillStyle = COLORS.sectionFlag;
    ctx.fillText(s.name, x + 6, 11.5);
  }

  // Loop flags last: they're the drag targets, so they sit on top of any
  // section flag that happens to share their x.
  if (loop) drawLoopFlags(ctx, w, view, loop);
}

/** The loop's START/END pennants: a full-height stem at each edge with a
 *  small inward-pointing tab carrying the A/B letters the transport's loop
 *  buttons use. */
function drawLoopFlags(
  ctx: CanvasRenderingContext2D,
  w: number,
  view: PianoRollView,
  loop: LoopRegion,
): void {
  const {startX, endX} = loopFlagXs(loop, view);
  const TAB_W = 11;
  const TAB_H = 11;
  ctx.font = '700 8px system-ui, sans-serif';
  const flag = (x: number, label: string, inward: 1 | -1) => {
    if (x < -TAB_W - 2 || x > w + TAB_W + 2) return;
    const sx = Math.round(x) + 0.5;
    ctx.fillStyle = COLORS.loopFlag;
    ctx.fillRect(sx - 1, 0, 2, RULER_H);
    const tabLeft = inward === 1 ? sx : sx - TAB_W;
    ctx.fillRect(tabLeft, RULER_H - TAB_H, TAB_W, TAB_H);
    ctx.fillStyle = '#0d1017';
    ctx.fillText(label, tabLeft + 3, RULER_H - 3);
  };
  flag(startX, 'A', 1);
  flag(endX, 'B', -1);
}

export function drawWave(
  ctx: CanvasRenderingContext2D,
  w: number,
  top: number,
  bottom: number,
  view: PianoRollView,
  pyramid: AmpPyramid,
  color: string = COLORS.waveRow,
  alpha: number = 0.9,
): void {
  if (pyramid.levels.length === 0) return;
  const mid = (top + bottom) / 2;
  const half = (bottom - top) / 2;
  const STEP_PX = 2;
  // Peaks per zoom bucket: each screen column samples the
  // MAX amplitude over the ms range it actually spans, from the mip-map
  // level matching that width — not a single point-sample per column, which
  // would drop transients between samples whenever pxPerMs makes a column
  // wider than the base bin.
  const sample = (x: number): number => {
    const msA = xToMs(x, view);
    const msB = xToMs(x + STEP_PX, view);
    return sampleAmpRange(pyramid, msA, msB);
  };
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, mid);
  for (let x = 0; x <= w; x += STEP_PX) {
    ctx.lineTo(x, mid - sample(x) * half * 0.92);
  }
  for (let x = w; x >= 0; x -= STEP_PX) {
    ctx.lineTo(x, mid + sample(x) * half * 0.92);
  }
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;
}

export function drawLaneLabels(
  ctx: CanvasRenderingContext2D,
  laneTop: number,
  laneH: number,
  lanes: PianoRollLane[],
): void {
  ctx.font = '600 9.5px system-ui, sans-serif';
  for (let l = 0; l < lanes.length; l++) {
    const y = laneTop + l * laneH;
    ctx.fillStyle = 'rgba(13,16,23,0.72)';
    ctx.fillRect(0, y + 2, 44, 13);
    ctx.fillStyle = COLORS.laneLabel;
    ctx.fillText(lanes[l].name.toUpperCase(), 5, y + 12);
  }
}

export function drawStackedGutter(
  ctx: CanvasRenderingContext2D,
  width: number,
  rows: readonly TrackRowGeometry[],
  height: number,
): void {
  ctx.fillStyle = COLORS.chrome;
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = COLORS.gridBeat;
  ctx.beginPath();
  ctx.moveTo(width - 0.5, 0);
  ctx.lineTo(width - 0.5, height);
  ctx.stroke();

  for (const row of rows) {
    const instrument = rowLabel(row.row.key.instrument);
    const difficulty = rowLabel(row.row.key.difficulty);
    ctx.fillStyle = COLORS.tempoBg;
    ctx.fillRect(0, row.top, width, row.bottom - row.top);
    ctx.strokeStyle = COLORS.gridBeat;
    ctx.beginPath();
    ctx.moveTo(0, row.top + 0.5);
    ctx.lineTo(width, row.top + 0.5);
    ctx.stroke();

    ctx.fillStyle = COLORS.rulerInk;
    ctx.font = '600 10px system-ui, sans-serif';
    ctx.fillText(`${instrument} · ${difficulty}`, 7, row.top + 15);

    ctx.font = '600 9.5px system-ui, sans-serif';
    for (let lane = 0; lane < row.row.lanes.length; lane++) {
      const laneInfo = row.row.lanes[lane];
      const y = row.laneTop + lane * row.laneH;
      ctx.fillStyle = 'rgba(13,16,23,0.72)';
      ctx.fillRect(4, y + 2, width - 8, Math.max(14, row.laneH - 4));
      ctx.fillStyle = laneInfo.color || COLORS.laneLabel;
      ctx.fillText(laneInfo.name.toUpperCase(), 9, y + 13.5);
    }
  }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
