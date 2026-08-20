import {cn} from '@/lib/utils';

/**
 * The frame every hero illustration canvas draws inside: full width of the
 * hero, rounded hairline border, card surface.
 *
 * Height is the one knob. `'standard'` (`h-32 sm:h-40`) fits a single
 * horizontal band — a waveform, a syllable row. `'tall'` (`h-36 sm:h-44`)
 * fits stacked lanes — the drum highway, the reduction cascade. The string
 * was forked into four canvases before this owned it, and the height split
 * existed there undocumented.
 */
export type HeroCanvasHeight = 'standard' | 'tall';

export function heroCanvasFrameClass(
  height: HeroCanvasHeight = 'standard',
): string {
  return cn(
    'w-full rounded-lg border border-border bg-card',
    height === 'tall' ? 'h-36 sm:h-44' : 'h-32 sm:h-40',
  );
}
