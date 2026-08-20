'use client';

import {useEffect, useRef} from 'react';

import {LANE_FALLBACKS, LANE_PROPERTIES} from '@/components/landing/lanes';
import {heroCanvasFrameClass} from '@/components/landing/heroCanvasFrame';

/**
 * The hero motif: the edit pass.
 *
 * A strip of piano-roll timeline, read left to right. The model's proposed
 * gems land on their lanes, and then three of them are corrected the way a
 * charter would correct them in the editor: one cymbal moves to a different
 * lane, one spurious note is deleted, and one off-grid note is nudged onto
 * the beat. The original position stays behind as a hollow outline, so the
 * picture always shows both what was proposed and what a person changed it
 * to.
 *
 * Gem shapes reproduce the chart editor's piano roll
 * (`components/chart-editor/piano-roll/draw.ts`): cymbals are upward
 * triangles, pads and the kick are rounded rects, and the kick is simply the
 * bottom lane. Every note sits on a grid line, except the one whose whole
 * point is that it starts off-grid and gets nudged on.
 *
 * Decorative (aria-hidden), capped at 2x device pixel ratio, and static when
 * the viewer prefers reduced motion. Lane colors are read from the CSS custom
 * properties at runtime so the strip tracks light and dark.
 */

/** Rows, top to bottom, matching the piano roll's drum lane order. */
const ROWS = [
  {prop: '--lane-red', fallback: '#e5484d'},
  {prop: '--lane-yellow', fallback: '#f5c531'},
  {prop: '--lane-blue', fallback: '#4c8dff'},
  {prop: '--lane-green', fallback: '#46c46b'},
  {prop: '--lane-kick', fallback: '#ff9a3d'},
] as const;

const SNARE = 0;
const HIHAT = 1;
const RIDE = 2;
const TOM = 3;
const KICK = 4;

/** Two bars of 16 columns; a column is an eighth note, a beat is 4 columns. */
const COLS = 32;

/** One proposed note. `fix` describes the correction a charter makes to it. */
interface Gem {
  col: number;
  row: number;
  /** Cymbal gems draw as triangles, pad/kick gems as rounded rects. */
  cymbal?: boolean;
  fix?:
    | {kind: 'lane'; toRow: number; at: number}
    | {kind: 'delete'; at: number}
    | {kind: 'nudge'; toCol: number; at: number};
}

// A fixed two-bar rock beat, so the strip draws the same chart every cycle.
// Hi-hat eighths, backbeat snare, kick on the strong beats, a crash into
// bar two. Every column is on the eighth-note grid except the nudged snare.
const GEMS: Gem[] = [
  {col: 0, row: KICK},
  {col: 0, row: HIHAT, cymbal: true},
  {col: 2, row: HIHAT, cymbal: true},
  {col: 4, row: SNARE},
  {col: 4, row: HIHAT, cymbal: true},
  {col: 6, row: HIHAT, cymbal: true},
  {col: 6, row: KICK},
  {col: 8, row: KICK},
  {col: 8, row: HIHAT, cymbal: true},
  {col: 10, row: HIHAT, cymbal: true},
  {col: 12, row: SNARE},
  {col: 12, row: HIHAT, cymbal: true},
  {col: 14, row: HIHAT, cymbal: true},
  {col: 16, row: KICK},
  {col: 16, row: TOM, cymbal: true},
  // The cymbal choice the model gets wrong: proposed on yellow, moved to blue.
  {
    col: 18,
    row: HIHAT,
    cymbal: true,
    fix: {kind: 'lane', toRow: RIDE, at: 0.3},
  },
  {col: 20, row: SNARE},
  {col: 20, row: HIHAT, cymbal: true},
  // A spurious tom the model added. Deleted.
  {col: 22, row: TOM, fix: {kind: 'delete', at: 0.42}},
  {col: 22, row: HIHAT, cymbal: true},
  {col: 24, row: KICK},
  {col: 24, row: HIHAT, cymbal: true},
  {col: 26, row: HIHAT, cymbal: true},
  // Landed between grid lines. Nudged onto the beat.
  {col: 27.4, row: SNARE, fix: {kind: 'nudge', toCol: 28, at: 0.54}},
  {col: 28, row: HIHAT, cymbal: true},
  {col: 30, row: HIHAT, cymbal: true},
  {col: 30, row: KICK},
];

/** Ease so a correction reads as deliberate rather than mechanical. */
function ease(t: number) {
  const c = Math.min(1, Math.max(0, t));
  return c < 0.5 ? 2 * c * c : 1 - Math.pow(-2 * c + 2, 2) / 2;
}

export function EditPassCanvas() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const styles = getComputedStyle(canvas);
    const hslToken = (name: string, fallback: string) => {
      const v = styles.getPropertyValue(name).trim();
      return v ? `hsl(${v})` : fallback;
    };
    const rawToken = (name: string, fallback: string) =>
      styles.getPropertyValue(name).trim() || fallback;

    const gridCol = hslToken('--border', 'hsl(240 6% 90%)');
    const headCol = hslToken('--primary', 'hsl(298 43% 41%)');
    const laneCols = ROWS.map(r =>
      rawToken(
        r.prop,
        LANE_FALLBACKS[LANE_PROPERTIES.indexOf(r.prop)] ?? r.fallback,
      ),
    );

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    function resize() {
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    }

    /**
     * One gem, in the piano roll's shapes (`draw.ts` `paintGlyph`): cymbals
     * are upward triangles, pads and the kick are rounded rects with the
     * piano roll's corner-radius rule scaled to the hero's glyph size.
     * `scale` shrinks the glyph around its center for landing/deleting.
     */
    function drawGem(
      x: number,
      y: number,
      nw: number,
      nh: number,
      color: string,
      hollow: boolean,
      cymbal: boolean,
      scale = 1,
    ) {
      if (!ctx) return;
      const gw = nw * scale;
      const gh = nh * scale;
      ctx.beginPath();
      if (cymbal) {
        ctx.moveTo(x, y - gh * 0.62);
        ctx.lineTo(x + gw * 0.6, y + gh * 0.5);
        ctx.lineTo(x - gw * 0.6, y + gh * 0.5);
        ctx.closePath();
      } else {
        ctx.roundRect(
          x - gw / 2,
          y - gh / 2,
          gw,
          gh,
          Math.min(gw / 3, gh * 0.19),
        );
      }
      if (hollow) {
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(1, dpr);
        ctx.setLineDash([2 * dpr, 2 * dpr]);
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
        ctx.fillStyle = color;
        ctx.fill();
      }
    }

    // p in [0,1): propose (head sweeps) -> three corrections -> hold -> fade.
    function draw(p: number) {
      if (!canvas || !ctx) return;
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      const padX = w * 0.045;
      const innerW = w - padX * 2;
      const colW = innerW / COLS;
      const rowTop = h * 0.16;
      const rowBot = h * 0.84;
      const rowGap = (rowBot - rowTop) / (ROWS.length - 1);
      // Glyph sizing follows the piano roll: height from the lane, width
      // tracking the grid step but never wider than the height.
      const nh = Math.max(6 * dpr, Math.min(rowGap * 0.62, 15 * dpr));
      const nw = Math.min(2 * colW * 0.72, nh);

      const PROPOSE = 0.2;
      const FADE_FROM = 0.96;
      const readCols = Math.min(1, p / PROPOSE) * COLS;
      const fade = p <= FADE_FROM ? 1 : Math.max(0, 1 - (p - FADE_FROM) / 0.04);

      // Notes sit ON the grid lines, so a column's x is its grid line's x.
      const xOf = (col: number) => padX + col * colW;
      const yOf = (row: number) => rowTop + row * rowGap;

      // Eighth-note grid, with beats and bars emphasized. Every gem column
      // has a line under it.
      ctx.strokeStyle = gridCol;
      ctx.lineWidth = dpr;
      for (let c = 0; c <= COLS; c += 2) {
        const bar = c % 16 === 0;
        const beat = c % 4 === 0;
        ctx.globalAlpha = (bar ? 0.9 : beat ? 0.5 : 0.26) * fade;
        const x = xOf(c);
        ctx.beginPath();
        ctx.moveTo(x, rowTop - rowGap * 0.5);
        ctx.lineTo(x, rowBot + rowGap * 0.5);
        ctx.stroke();
      }

      // Lane lines.
      ctx.globalAlpha = 0.5 * fade;
      for (let r = 0; r < ROWS.length; r++) {
        const y = yOf(r);
        ctx.beginPath();
        ctx.moveTo(padX, y);
        ctx.lineTo(w - padX, y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      for (const gem of GEMS) {
        if (readCols < gem.col) continue;

        const landing = Math.min(1, (readCols - gem.col) / 1.6);
        const baseX = xOf(gem.col);
        const baseY = yOf(gem.row);
        const baseColor = laneCols[gem.row];
        const cymbal = gem.cymbal === true;

        if (!gem.fix) {
          ctx.globalAlpha = fade;
          drawGem(
            baseX,
            baseY,
            nw,
            nh,
            baseColor,
            false,
            cymbal,
            0.65 + 0.35 * landing,
          );
          continue;
        }

        const t = ease((p - gem.fix.at) / 0.09);

        // What the model proposed stays behind as a hollow outline.
        if (t > 0) {
          ctx.globalAlpha = 0.55 * fade;
          drawGem(baseX, baseY, nw, nh, baseColor, true, cymbal);
        }

        ctx.globalAlpha = fade;
        if (gem.fix.kind === 'lane') {
          const y = baseY + (yOf(gem.fix.toRow) - baseY) * t;
          const color = t > 0.5 ? laneCols[gem.fix.toRow] : baseColor;
          drawGem(baseX, y, nw, nh, color, false, cymbal);
        } else if (gem.fix.kind === 'delete') {
          if (t < 1) {
            ctx.globalAlpha = (1 - t) * fade;
            drawGem(
              baseX,
              baseY,
              nw,
              nh,
              baseColor,
              false,
              cymbal,
              1 - 0.4 * t,
            );
          }
        } else {
          const x = baseX + (xOf(gem.fix.toCol) - baseX) * t;
          drawGem(x, baseY, nw, nh, baseColor, false, cymbal);
        }
      }
      ctx.globalAlpha = 1;

      // The analysis head, only while the model is proposing notes.
      if (p < PROPOSE) {
        const headX = padX + (readCols / COLS) * innerW;
        ctx.strokeStyle = headCol;
        ctx.globalAlpha = 0.85 * fade;
        ctx.lineWidth = 1.5 * dpr;
        ctx.beginPath();
        ctx.moveTo(headX, rowTop - rowGap * 0.5);
        ctx.lineTo(headX, rowBot + rowGap * 0.5);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    let raf = 0;
    let start: number | null = null;
    const CYCLE = 8; // seconds per propose-and-correct pass

    function frame(ts: number) {
      if (start === null) start = ts;
      draw((((ts - start) / 1000) % CYCLE) / CYCLE);
      raf = window.requestAnimationFrame(frame);
    }

    function run() {
      window.cancelAnimationFrame(raf);
      resize();
      if (reduced.matches) {
        // Settled: every correction made, every original still outlined.
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
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={heroCanvasFrameClass('tall')}
    />
  );
}
