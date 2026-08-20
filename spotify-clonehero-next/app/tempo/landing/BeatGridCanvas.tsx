'use client';

import {useEffect, useRef} from 'react';

import {LANE_FALLBACKS, LANE_PROPERTIES} from '@/components/landing/lanes';
import {heroCanvasFrameClass} from '@/components/landing/heroCanvasFrame';

/**
 * The hero motif for /tempo, a lighter variant of the family's edit-pass
 * picture.
 *
 * A waveform strip read left to right, with the predicted grid drawn over it:
 * thin lines for beats, thick ones for bar lines. Every beat's drum transient
 * sits exactly on its nominal grid position, but the model proposes one bar
 * line early, off that position (`START_OFFSET`), and it is dragged onto the
 * beat. The proposed position stays behind as a dashed outline, so the
 * picture shows both what was predicted and what a person changed it to.
 *
 * The end state is a fully on-grid bar line and evenly spaced beats around
 * it, matching every other beat in the strip, so the correction reads as a
 * move to alignment rather than to a merely closer approximation. Dragging
 * the bar line does not move only that line: every beat line between
 * it and the bar lines on either side re-interpolates its position every
 * frame, the same way the piano-roll timeline respaces beats between tempo
 * markers while one of them is being dragged (`tickToMs` in
 * lib/drum-transcription/timing.ts is a piecewise-linear function of tick
 * with a breakpoint at each tempo marker, so moving one marker's ms position
 * changes the slope on both sides of it; components/chart-editor/piano-roll/
 * draw.ts's `drawGrid` then draws each subdivision as a straight interpolation
 * between its two neighboring beat positions). Here the bar lines play the
 * role of anchors and the beats between them are the interpolated
 * subdivisions, so the whole local span reads as skewed before the drag and
 * settles into a tighter, more even arrangement after it.
 *
 * The waveform is a fixed synthetic envelope with a transient on every beat,
 * so the strip draws the same picture every cycle and nothing here depends on
 * a real audio file.
 *
 * Decorative (aria-hidden), capped at 2x device pixel ratio, and static when
 * the viewer prefers reduced motion. Colors are read from the CSS custom
 * properties at runtime so the strip tracks light and dark.
 */

/** Beats drawn across the strip. Four to a bar. */
const BEATS = 24;
const BEATS_PER_BAR = 4;

/** The bar line the picture corrects, and its fixed neighbors on both sides. */
const WRONG_BAR_BEAT = 12;
const LEFT_ANCHOR_BEAT = WRONG_BAR_BEAT - BEATS_PER_BAR;
const RIGHT_ANCHOR_BEAT = WRONG_BAR_BEAT + BEATS_PER_BAR;

/**
 * Where the bar line sits before the drag starts, as an offset from
 * `WRONG_BAR_BEAT` (its correct, nominal position). The subdivisions between
 * the bar line and its neighbors read as visibly skewed while it sits here,
 * and settle into an exactly even grid once it lands back on nominal.
 */
const START_OFFSET = -0.85;

/** Deterministic pseudo-noise, so the waveform is the same on every render. */
function wobble(i: number) {
  return (Math.sin(i * 12.9898) * 43758.5453) % 1;
}

/**
 * Envelope height at position `t`, measured in beats. A sharp transient on
 * every beat that decays across it, with a steadier bed underneath, which is
 * what a drum-led mix looks like at this zoom. Every transient, including the
 * one the picture corrects, sits exactly on its nominal beat: the model's
 * error is a mispredicted line position, not an off-grid drum hit.
 */
function envelope(t: number) {
  const onsetBeat = Math.floor(t);
  const phase = t - onsetBeat;
  const strong =
    onsetBeat % BEATS_PER_BAR === 0 ? 1 : onsetBeat % 2 === 0 ? 0.82 : 0.66;
  const transient = Math.exp(-phase * 7) * strong;
  const bed = 0.24 + 0.1 * Math.sin(t * 1.7);
  const noise = 0.07 * wobble(Math.floor(t * 24));
  return Math.min(1, transient * 0.72 + bed + noise);
}

/** Ease so the correction reads as deliberate rather than mechanical. */
function ease(t: number) {
  const c = Math.min(1, Math.max(0, t));
  return c < 0.5 ? 2 * c * c : 1 - Math.pow(-2 * c + 2, 2) / 2;
}

export function BeatGridCanvas() {
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

    const waveCol = hslToken('--muted-foreground', 'hsl(240 4% 46%)');
    const headCol = hslToken('--primary', 'hsl(298 43% 41%)');
    // The bar line is the one thing the picture is about, so it carries a lane
    // color rather than a chrome color.
    const barCol = rawToken('--lane-blue', LANE_FALLBACKS[3]);
    const fixCol = rawToken(
      '--lane-green',
      LANE_FALLBACKS[LANE_PROPERTIES.indexOf('--lane-green')] ?? '#46c46b',
    );

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    function resize() {
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    }

    // p in [0,1): the waveform is there, the grid is proposed, one bar line is
    // dragged onto the true beat, hold, fade.
    function draw(p: number) {
      if (!canvas || !ctx) return;
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      const padX = w * 0.045;
      const innerW = w - padX * 2;
      const beatW = innerW / BEATS;
      const midY = h * 0.54;
      const waveH = h * 0.3;
      const gridTop = h * 0.14;
      const gridBot = h * 0.9;

      const PROPOSE = 0.28;
      const FIX_AT = 0.44;
      const FADE_FROM = 0.96;
      const readBeats = Math.min(1, p / PROPOSE) * BEATS;
      const fade = p <= FADE_FROM ? 1 : Math.max(0, 1 - (p - FADE_FROM) / 0.04);

      const xOf = (beat: number) => padX + beat * beatW;

      // Waveform: a filled envelope mirrored about the centre line. Drawn
      // whole, since the audio exists before anything is predicted about it.
      const step = Math.max(1, Math.floor(dpr));
      ctx.globalAlpha = 0.5 * fade;
      ctx.fillStyle = waveCol;
      ctx.beginPath();
      ctx.moveTo(padX, midY);
      for (let x = 0; x <= innerW; x += step) {
        ctx.lineTo(padX + x, midY - envelope((x / innerW) * BEATS) * waveH);
      }
      for (let x = innerW; x >= 0; x -= step) {
        ctx.lineTo(padX + x, midY + envelope((x / innerW) * BEATS) * waveH);
      }
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;

      const t = ease((p - FIX_AT) / 0.14);

      // The bar line's current position, and its two fixed neighbors. Beats
      // between a neighbor and the moving line re-interpolate against it
      // every frame — the same piecewise-linear respacing `tickToMs`
      // produces between tempo markers in the real piano-roll timeline. The
      // line's own offset from `WRONG_BAR_BEAT` (its correct, nominal
      // position) runs from `START_OFFSET` at t=0 to exactly 0 at t=1, so it
      // lands squarely on the beat and the grid around it is exactly even.
      const offset = START_OFFSET * (1 - t);
      const movingX = xOf(WRONG_BAR_BEAT + offset);
      const leftAnchorX = xOf(LEFT_ANCHOR_BEAT);
      const rightAnchorX = xOf(RIGHT_ANCHOR_BEAT);
      const respacedX = (beat: number) => {
        if (beat === WRONG_BAR_BEAT) return movingX;
        if (beat > LEFT_ANCHOR_BEAT && beat < WRONG_BAR_BEAT) {
          const frac =
            (beat - LEFT_ANCHOR_BEAT) / (WRONG_BAR_BEAT - LEFT_ANCHOR_BEAT);
          return leftAnchorX + (movingX - leftAnchorX) * frac;
        }
        if (beat > WRONG_BAR_BEAT && beat < RIGHT_ANCHOR_BEAT) {
          const frac =
            (beat - WRONG_BAR_BEAT) / (RIGHT_ANCHOR_BEAT - WRONG_BAR_BEAT);
          return movingX + (rightAnchorX - movingX) * frac;
        }
        return xOf(beat);
      };

      // The predicted grid, appearing under the analysis head.
      for (let b = 0; b <= BEATS; b++) {
        if (readBeats < b) continue;
        const bar = b % BEATS_PER_BAR === 0;
        const wrong = b === WRONG_BAR_BEAT;
        const x = respacedX(b);

        // Where the bar line was first proposed, early of its correct
        // position, stays behind as a dashed outline once it starts moving.
        if (wrong && t > 0) {
          ctx.strokeStyle = barCol;
          ctx.globalAlpha = 0.5 * fade;
          ctx.lineWidth = 1.5 * dpr;
          ctx.setLineDash([3 * dpr, 3 * dpr]);
          ctx.beginPath();
          ctx.moveTo(xOf(b + START_OFFSET), gridTop);
          ctx.lineTo(xOf(b + START_OFFSET), gridBot);
          ctx.stroke();
          ctx.setLineDash([]);
        }

        // Beat lines borrow the waveform's ink rather than the border token:
        // the border is light enough in the light theme to disappear against
        // the card, and the caption promises they are visible.
        ctx.strokeStyle = bar ? (wrong && t > 0.5 ? fixCol : barCol) : waveCol;
        ctx.globalAlpha = (bar ? 0.95 : 0.5) * fade;
        ctx.lineWidth = (bar ? 1.8 : 1) * dpr;
        ctx.beginPath();
        ctx.moveTo(x, bar ? gridTop : gridTop + h * 0.1);
        ctx.lineTo(x, bar ? gridBot : gridBot - h * 0.1);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // The analysis head, only while the grid is being proposed.
      if (p < PROPOSE) {
        const headX = padX + (readBeats / BEATS) * innerW;
        ctx.strokeStyle = headCol;
        ctx.globalAlpha = 0.85 * fade;
        ctx.lineWidth = 1.5 * dpr;
        ctx.beginPath();
        ctx.moveTo(headX, gridTop);
        ctx.lineTo(headX, gridBot);
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
        // Settled: the bar line moved, its predicted position still outlined.
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
      className={heroCanvasFrameClass()}
    />
  );
}
