/**
 * The painters publish a measured width for every lyric syllable, time
 * signature and section in the song on every frame, because that width is
 * also the hit-test rect. Caching it is only safe if a cached width can never
 * be handed back for a different font — these pin that down, and pin down
 * that the cache actually hits (a stub context whose `font` is not a string
 * would miss every time and grow without bound).
 */
import {measureTextWidth} from '../textWidth';

/** A 2D context stub whose width depends on both the text and the font. */
function fakeCtx(): CanvasRenderingContext2D & {calls: number} {
  const ctx = {
    font: '600 9.5px system-ui, sans-serif',
    calls: 0,
    measureText(text: string) {
      ctx.calls++;
      const size = Number(/(\d+(?:\.\d+)?)px/.exec(ctx.font)?.[1] ?? 10);
      return {width: text.length * size} as TextMetrics;
    },
  };
  return ctx as unknown as CanvasRenderingContext2D & {calls: number};
}

describe('measureTextWidth', () => {
  it('measures once per (font, text) and reuses the result', () => {
    const ctx = fakeCtx();
    const first = measureTextWidth(ctx, 'cache-hit-probe');
    const second = measureTextWidth(ctx, 'cache-hit-probe');
    expect(second).toBe(first);
    expect(ctx.calls).toBe(1);
  });

  it('does not reuse a width across fonts', () => {
    const ctx = fakeCtx();
    ctx.font = '600 9.5px system-ui, sans-serif';
    const small = measureTextWidth(ctx, 'across-fonts-probe');
    ctx.font = '700 19px system-ui, sans-serif';
    const large = measureTextWidth(ctx, 'across-fonts-probe');
    expect(large).toBeCloseTo(small * 2, 6);
    expect(ctx.calls).toBe(2);
  });

  it('shares cached widths between contexts using the same font', () => {
    // measureText is independent of the canvas transform and of the device
    // pixel ratio, so one canvas's measurement is valid on another.
    const a = fakeCtx();
    const b = fakeCtx();
    const viaA = measureTextWidth(a, 'shared-context-probe');
    const viaB = measureTextWidth(b, 'shared-context-probe');
    expect(viaB).toBe(viaA);
    expect(b.calls).toBe(0);
  });

  it('returns the live width after the eviction limit is passed', () => {
    const ctx = fakeCtx();
    ctx.font = '600 12px eviction-probe';
    for (let i = 0; i < 5000; i++) measureTextWidth(ctx, `evict-${i}`);
    expect(measureTextWidth(ctx, 'abc')).toBe(36);
  });
});
