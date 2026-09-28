import {useMemo, useRef} from 'react';
import type {Rect} from '../motion';

export interface SplitHighway {
  /** One ref per region, for the canvas that shows it. */
  refs: readonly ((canvas: HTMLCanvasElement | null) => void)[];
  /** Pass to the source `ProductHighway`'s `onDraw`. */
  onDraw: (source: HTMLCanvasElement) => void;
}

/**
 * Parts of one highway stage (its panes, its karaoke band) as canvases of
 * their own, so each part can move independently while the app still draws
 * them as one editor strip. `regions` are boxes of the source
 * `ProductHighway`, in its CSS pixels. Every frame, in the same task as the
 * draw, each region of the source canvas is copied 1:1 into its canvas at
 * the stage's device pixel ratio (`pixelRatio`, the source's own). Render
 * the canvases before the source `ProductHighway` (hide the source with
 * `opacity: 0`), so their refs are set when it draws.
 */
export const useSplitHighway = (
  regions: readonly Rect[],
  pixelRatio: 1 | 2 = 2,
): SplitHighway => {
  const canvases = useRef<(HTMLCanvasElement | null)[]>([]);
  const refs = useMemo(
    () =>
      Array.from(
        {length: regions.length},
        (_, i) => (canvas: HTMLCanvasElement | null) => {
          canvases.current[i] = canvas;
        },
      ),
    [regions.length],
  );
  const onDraw = (source: HTMLCanvasElement) => {
    regions.forEach((region, i) => {
      const target = canvases.current[i];
      const context = target?.getContext('2d');
      if (!target || !context) return;
      const width = Math.round(region.width * pixelRatio);
      const height = Math.round(region.height * pixelRatio);
      if (target.width !== width || target.height !== height) {
        target.width = width;
        target.height = height;
      }
      context.clearRect(0, 0, width, height);
      context.drawImage(
        source,
        Math.round(region.x * pixelRatio),
        Math.round(region.y * pixelRatio),
        width,
        height,
        0,
        0,
        width,
        height,
      );
    });
  };
  return {refs, onDraw};
};
