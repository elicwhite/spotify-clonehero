'use client';

import {useEffect, useRef} from 'react';

import {LANE_FALLBACKS, LANE_PROPERTIES} from '@/components/landing/lanes';
import {heroCanvasFrameClass} from '@/components/landing/heroCanvasFrame';

import {
  CORRECTED_INDEX,
  PROPOSED_AT,
  SYLLABLES,
  envelope,
} from './syllableAlignModel';

/**
 * The hero motif for /add-lyrics, the family's edit-pass picture told with
 * syllables.
 *
 * A vocal waveform read left to right, with a burst of energy where each
 * syllable is sung. An analysis head sweeps across it, and as it passes each
 * burst the syllable's text and timestamp drop onto the onset with a tick
 * line. One syllable ("ler") is proposed early, off its burst, and a person
 * drags it onto the vocal. The proposed position stays behind as a dashed
 * tick, so the picture shows both what was predicted and what was changed —
 * the same before-and-after grammar as /tempo's bar-line drag and
 * /drum-transcription's note fixes.
 *
 * The syllables, the corrected syllable's positions, and the waveform
 * envelope live in `syllableAlignModel.ts`, shared with the route's social
 * card. The waveform is a fixed synthetic envelope, so the strip draws the
 * same picture every cycle and nothing here depends on a real audio file.
 *
 * Decorative (aria-hidden), capped at 2x device pixel ratio, and static when
 * the viewer prefers reduced motion. Colors are read from the CSS custom
 * properties at runtime so the strip tracks light and dark.
 */

/** Ease so the correction reads as deliberate rather than mechanical. */
function ease(t: number) {
  const c = Math.min(1, Math.max(0, t));
  return c < 0.5 ? 2 * c * c : 1 - Math.pow(-2 * c + 2, 2) / 2;
}

export function SyllableAlignCanvas() {
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
    const sylCol = rawToken('--lane-blue', LANE_FALLBACKS[3]);
    const fixCol = rawToken(
      '--lane-green',
      LANE_FALLBACKS[LANE_PROPERTIES.indexOf('--lane-green')] ?? '#46c46b',
    );
    const fontFamily = styles.fontFamily || 'sans-serif';

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    function resize() {
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    }

    // p in [0,1): the waveform is there, a head sweeps and drops syllables
    // onto it, one lands early and is dragged onto its burst, hold, fade.
    function draw(p: number) {
      if (!canvas || !ctx) return;
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      // Type sizes match the /chart page's lyric-syllables band: 18/24 px
      // syllables and 10/12 px timestamps across the same sm breakpoint. On
      // narrow strips the timestamps alternate between two rows so the wider
      // type never collides.
      const mobile = w / dpr < 640;
      const padX = w * 0.04;
      const innerW = w - padX * 2;
      const sylPx = (mobile ? 18 : 24) * dpr;
      const timePx = (mobile ? 10 : 12) * dpr;
      const labelY = h * (mobile ? 0.17 : 0.18);
      const timeRow0 = h * (mobile ? 0.32 : 0.33);
      const timeRow1 = h * 0.43;
      const tickTop = h * (mobile ? 0.48 : 0.4);
      const waveMid = h * (mobile ? 0.78 : 0.74);
      const waveH = h * (mobile ? 0.15 : 0.17);

      const SWEEP = 0.32;
      const FIX_AT = 0.46;
      const FADE_FROM = 0.96;
      const sweep = Math.min(1, p / SWEEP);
      const fade = p <= FADE_FROM ? 1 : Math.max(0, 1 - (p - FADE_FROM) / 0.04);
      const xOf = (frac: number) => padX + frac * innerW;

      // The waveform, whole: the audio exists before anything is predicted
      // about it.
      const step = Math.max(1, Math.floor(dpr));
      ctx.globalAlpha = 0.5 * fade;
      ctx.fillStyle = waveCol;
      ctx.beginPath();
      ctx.moveTo(padX, waveMid);
      for (let x = 0; x <= innerW; x += step) {
        ctx.lineTo(padX + x, waveMid - envelope(x / innerW) * waveH);
      }
      for (let x = innerW; x >= 0; x -= step) {
        ctx.lineTo(padX + x, waveMid + envelope(x / innerW) * waveH * 0.7);
      }
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;

      const t = ease((p - FIX_AT) / 0.14);

      ctx.textAlign = 'center';
      for (let i = 0; i < SYLLABLES.length; i++) {
        const syl = SYLLABLES[i];
        // A syllable and its timestamp fade in as the sweep head passes its
        // position, with the family's shared ease. Under reduced motion the
        // settled frame draws at sweep = 1, so everything is fully visible.
        const appear = ease((sweep - syl.at) / 0.08);
        if (appear <= 0) continue;
        const wrong = i === CORRECTED_INDEX;
        const frac = wrong ? PROPOSED_AT + (syl.at - PROPOSED_AT) * t : syl.at;
        const x = xOf(frac);
        const col = wrong && t > 0.5 ? fixCol : sylCol;

        // Where the syllable was first proposed stays behind as a dashed
        // tick once it starts moving.
        if (wrong && t > 0) {
          ctx.strokeStyle = sylCol;
          ctx.globalAlpha = 0.45 * fade;
          ctx.lineWidth = 1.2 * dpr;
          ctx.setLineDash([3 * dpr, 3 * dpr]);
          ctx.beginPath();
          ctx.moveTo(xOf(PROPOSED_AT), tickTop);
          ctx.lineTo(xOf(PROPOSED_AT), waveMid + waveH * 0.7);
          ctx.stroke();
          ctx.setLineDash([]);
        }

        ctx.strokeStyle = col;
        ctx.globalAlpha = 0.9 * fade * appear;
        ctx.lineWidth = (wrong ? 1.8 : 1.4) * dpr;
        ctx.beginPath();
        ctx.moveTo(x, tickTop);
        ctx.lineTo(x, waveMid + waveH * 0.7);
        ctx.stroke();

        ctx.fillStyle = col;
        ctx.globalAlpha = fade * appear;
        ctx.font = `600 ${Math.round(sylPx)}px ${fontFamily}`;
        ctx.fillText(syl.text, x, labelY);
        ctx.globalAlpha = 0.75 * fade * appear;
        ctx.font = `${Math.round(timePx)}px ui-monospace, monospace`;
        ctx.fillText(syl.time, x, mobile && i % 2 === 1 ? timeRow1 : timeRow0);
        ctx.globalAlpha = 1;
      }

      // The analysis head, only while syllables are being placed.
      if (p < SWEEP) {
        const headX = padX + sweep * innerW;
        ctx.strokeStyle = headCol;
        ctx.globalAlpha = 0.85 * fade;
        ctx.lineWidth = 1.5 * dpr;
        ctx.beginPath();
        ctx.moveTo(headX, h * 0.08);
        ctx.lineTo(headX, h * 0.94);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    let raf = 0;
    let start: number | null = null;
    const CYCLE = 8; // seconds per place-and-correct pass

    function frame(ts: number) {
      if (start === null) start = ts;
      draw((((ts - start) / 1000) % CYCLE) / CYCLE);
      raf = window.requestAnimationFrame(frame);
    }

    function run() {
      window.cancelAnimationFrame(raf);
      resize();
      if (reduced.matches) {
        // Settled: the syllable moved, its proposed position still dashed.
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
