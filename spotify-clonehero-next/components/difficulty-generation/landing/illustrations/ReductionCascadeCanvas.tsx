'use client';

import {useEffect, useRef} from 'react';

import {LANE_FALLBACKS, LANE_PROPERTIES} from '@/components/landing/lanes';
import {heroCanvasFrameClass} from '@/components/landing/heroCanvasFrame';

import type {DifficultyGenerationInstrument} from '../../DifficultyGenerationFlow';

/**
 * The hero motif for the difficulty-generation pages: one bar of Expert at
 * the top, and the three generated tiers written below it by copying down.
 * Each tier is written by the surviving notes of the row above sliding down
 * one row; a note the tier drops never travels, it simply stays behind in
 * the row above. A row never contains a note or a color the row above
 * lacks. That strict subset is the picture's simplification, not a tool
 * invariant: the real reducers also move notes (the drum decode relanes
 * cymbals and toms, and the guitar decoder can land on a fret the Expert
 * moment never played). The picture keeps to removal, the dominant effect.
 *
 * The note patterns are fixed per instrument (one note per column per row,
 * each lower tier a strict subset of the tier above), so the strip draws the
 * same picture every cycle and nothing here depends on a real chart. On the
 * guitar rows one mid-bar note carries a sustain tail whose per-tier length
 * follows the reducer's real sustain rules, so the picture agrees with the
 * page's copy about what a sustain becomes on the lower tiers.
 *
 * Decorative (aria-hidden), capped at 2x device pixel ratio, and static when
 * the viewer prefers reduced motion. Lane colors are read from the CSS
 * custom properties at runtime so the gems track light and dark.
 */

/** Lane index into `LANE_PROPERTIES`: kick, red, yellow, blue, green. On the
 *  guitar rows the kick slot is read as the orange fret, which is what that
 *  color is. */
type LaneIndex = 0 | 1 | 2 | 3 | 4;

interface CascadeNote {
  /** Sixteenth-grid position, 0..15. */
  slot: number;
  lane: LaneIndex;
  /** Sustain tail past the head, in sixteenth slots, one length per row
   *  (Expert, Hard, Medium, Easy). Guitar only. The lengths follow the
   *  reducer's actual sustain rules: capped at the next note on the fret,
   *  and on Medium and Easy ending at least a beat (four slots) before the
   *  tier's next note, which can reduce a sustain to a plain hit. */
  sustain?: readonly [number, number, number, number];
}

interface CascadeSpec {
  /** The Expert bar, at most one note per slot. */
  expert: readonly CascadeNote[];
  /** The slots each generated tier keeps, Hard/Medium/Easy order. Each list
   *  is a strict subset of the one before it, so every tier is the tier
   *  above with notes removed. */
  keeps: readonly [readonly number[], readonly number[], readonly number[]];
}

const SLOTS = 16;
const ROW_LABELS = ['EXPERT', 'HARD', 'MEDIUM', 'EASY'] as const;

const DRUM_SPEC: CascadeSpec = {
  // Crash opener on green, hi-hat eighths on yellow, snare backbeats on red,
  // kicks and a blue ride accent filling out the bar.
  expert: [
    {slot: 0, lane: 4},
    {slot: 1, lane: 2},
    {slot: 2, lane: 2},
    {slot: 3, lane: 0},
    {slot: 4, lane: 1},
    {slot: 5, lane: 2},
    {slot: 6, lane: 0},
    {slot: 7, lane: 2},
    {slot: 8, lane: 0},
    {slot: 9, lane: 2},
    {slot: 10, lane: 3},
    {slot: 11, lane: 0},
    {slot: 12, lane: 1},
    {slot: 13, lane: 2},
    {slot: 14, lane: 3},
    {slot: 15, lane: 2},
  ],
  keeps: [
    [0, 2, 3, 4, 6, 8, 10, 12, 14],
    [0, 4, 8, 12],
    [4, 8, 12], // kick and snare only
  ],
};

const GUITAR_SPEC: CascadeSpec = {
  // A run across the five frets; lane 0 reads as orange here. One note
  // carries a sustain: the mid-bar green at slot 8, held over a clear
  // span (no note lands inside its tail on any row). Its per-tier tail
  // follows the reducer's arithmetic. On Expert and Hard the tail is one
  // slot, inside the cap of the next note on that fret (slot 12). On
  // Medium the tier's next note is at slot 12, so the one-beat gap rule
  // leaves 12 - 8 - 4 = 0 slots and the note survives as a plain hit.
  // Easy drops the note entirely.
  expert: [
    {slot: 0, lane: 4},
    {slot: 1, lane: 1},
    {slot: 2, lane: 2},
    {slot: 3, lane: 3},
    {slot: 4, lane: 0},
    {slot: 5, lane: 3},
    {slot: 6, lane: 2},
    {slot: 7, lane: 1},
    {slot: 8, lane: 4, sustain: [1, 1, 0, 0]},
    {slot: 10, lane: 3},
    {slot: 11, lane: 1},
    {slot: 12, lane: 4},
    {slot: 13, lane: 2},
    {slot: 14, lane: 3},
    {slot: 15, lane: 1},
  ],
  keeps: [
    [0, 1, 3, 4, 6, 8, 10, 12, 14],
    [0, 6, 8, 12],
    [0, 6, 12],
  ],
};

/** Ease so each copy-down reads as a deliberate drop rather than a slide. */
function ease(t: number) {
  const c = Math.min(1, Math.max(0, t));
  return c < 0.5 ? 2 * c * c : 1 - Math.pow(-2 * c + 2, 2) / 2;
}

export function ReductionCascadeCanvas({
  instrument,
}: {
  instrument: DifficultyGenerationInstrument;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const spec = instrument === 'drums' ? DRUM_SPEC : GUITAR_SPEC;

    // Row k's notes: the Expert bar filtered by tier k's kept slots. The
    // kept-slot lists are chained subsets, so filtering Expert directly gives
    // the same rows as filtering each row by the next list.
    const rowNotes: readonly (readonly CascadeNote[])[] = [
      spec.expert,
      ...spec.keeps.map(kept =>
        spec.expert.filter(note => kept.includes(note.slot)),
      ),
    ];

    const styles = getComputedStyle(canvas);
    const hslToken = (name: string, fallback: string) => {
      const v = styles.getPropertyValue(name).trim();
      return v ? `hsl(${v})` : fallback;
    };
    const laneColors = LANE_PROPERTIES.map(
      (property, index) =>
        styles.getPropertyValue(property).trim() || LANE_FALLBACKS[index],
    );
    const labelCol = hslToken('--muted-foreground', 'hsl(240 4% 46%)');

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    function resize() {
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    }

    // Timeline: the Expert row appears, then each generated tier is written
    // by the surviving notes of the row above sliding down one row.
    // `DROPS[k]` writes row k+1.
    const DROPS: readonly [number, number][] = [
      [0.1, 0.3],
      [0.36, 0.56],
      [0.62, 0.82],
    ];
    const FADE_FROM = 0.95;

    function draw(p: number) {
      if (!canvas || !ctx) return;
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      const fade = p <= FADE_FROM ? 1 : Math.max(0, 1 - (p - FADE_FROM) / 0.05);
      const labelW = Math.min(w * 0.17, 76 * dpr);
      const padX = w * 0.03;
      const innerX = padX + labelW;
      const innerW = w - innerX - padX;
      const rowH = h / rowNotes.length;
      const slotW = innerW / SLOTS;
      const gemW = Math.min(slotW * 0.62, 15 * dpr);
      const gemH = Math.max(5 * dpr, rowH * 0.34);

      ctx.font = `${Math.max(9 * dpr, rowH * 0.24)}px ui-monospace, monospace`;
      ctx.textBaseline = 'middle';

      const rowCenter = (rowIndex: number) => rowIndex * rowH + rowH * 0.55;

      /** One note at a row's y. The sustain tail mirrors the chart
       *  editor's piano roll (`paintFretSustain` in
       *  `components/chart-editor/piano-roll/draw.ts`): a slightly
       *  narrower rounded bar in the lane color at reduced alpha, from
       *  the head's right edge to the sustain's end, painted before the
       *  head. `rowIndex` selects the tier's sustain length. */
      const drawGem = (
        note: CascadeNote,
        cy: number,
        alpha: number,
        rowIndex: number,
      ) => {
        if (alpha <= 0) return;
        const x = innerX + note.slot * slotW + (slotW - gemW) / 2;
        ctx.fillStyle = laneColors[note.lane];
        const tailSlots = note.sustain?.[rowIndex] ?? 0;
        if (tailSlots > 0) {
          const tailH = gemH * 0.76;
          ctx.globalAlpha = 0.78 * alpha * fade;
          ctx.beginPath();
          ctx.roundRect(
            x + gemW,
            cy - tailH / 2,
            tailSlots * slotW - gemW / 2,
            tailH,
            Math.min(3 * dpr, tailH / 3),
          );
          ctx.fill();
        }
        ctx.globalAlpha = alpha * fade;
        ctx.beginPath();
        ctx.roundRect(x, cy - gemH / 2, gemW, gemH, 2.5 * dpr);
        ctx.fill();
      };

      // How settled each row is: 1 when fully written, 0 before its drop.
      const rowAlpha = (rowIndex: number): number => {
        if (rowIndex === 0) return Math.min(1, p / 0.06);
        const [start, end] = DROPS[rowIndex - 1];
        if (p < start) return 0;
        return p >= end ? 1 : ease((p - start) / (end - start));
      };

      rowNotes.forEach((notes, rowIndex) => {
        const alpha = rowAlpha(rowIndex);
        if (alpha <= 0) return;

        ctx.globalAlpha = 0.9 * alpha * fade;
        ctx.fillStyle = labelCol;
        ctx.fillText(ROW_LABELS[rowIndex], padX, rowCenter(rowIndex));

        if (rowIndex === 0) {
          for (const note of notes) drawGem(note, rowCenter(0), alpha, 0);
          return;
        }

        const [start, end] = DROPS[rowIndex - 1];
        if (p >= end) {
          for (const note of notes)
            drawGem(note, rowCenter(rowIndex), 1, rowIndex);
          return;
        }

        // Mid-drop: only the surviving notes travel, sliding from the row
        // above into this row, already reshaped to the tier being written
        // (its sustain lengths included). Dropped notes never move; they
        // are already on screen as part of the settled row above.
        const q = ease((p - start) / (end - start));
        const from = rowCenter(rowIndex - 1);
        const to = rowCenter(rowIndex);
        for (const note of notes) {
          drawGem(note, from + (to - from) * q, 1, rowIndex);
        }
      });
      ctx.globalAlpha = 1;
    }

    let raf = 0;
    let start: number | null = null;
    const CYCLE = 5.5; // seconds per write-all-three-tiers pass

    function frame(ts: number) {
      if (start === null) start = ts;
      draw((((ts - start) / 1000) % CYCLE) / CYCLE);
      raf = window.requestAnimationFrame(frame);
    }

    function run() {
      window.cancelAnimationFrame(raf);
      resize();
      if (reduced.matches) {
        // Settled: all four rows written.
        draw(0.9);
      } else {
        start = null;
        raf = window.requestAnimationFrame(frame);
      }
    }

    run();
    window.addEventListener('resize', run);
    reduced.addEventListener('change', run);

    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener('resize', run);
      reduced.removeEventListener('change', run);
    };
  }, [instrument]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={heroCanvasFrameClass('tall')}
    />
  );
}
