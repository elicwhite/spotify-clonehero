import {useEffect, useRef, memo} from 'react';

import {cn} from '@/lib/utils';
import {findPositionForTime} from './renderVexflow';

interface PlayheadProps {
  timePositionMap: Array<{
    ms: number;
    x: number;
    y: number;
    flag: 'measure-start' | 'measure-end' | 'note';
  }>;
  /**
   * Returns the current chart-relative playback time in seconds (or null when
   * unavailable). A lightweight getter rather than the AudioManager itself —
   * passing the manager object as a prop makes React's dev "Performance Track"
   * try to structured-clone its (huge, cyclic) Web Audio graph, which throws a
   * DataCloneError and can freeze the tab.
   */
  getChartTimeSec: () => number | null | undefined;
  zoom: number;
  /**
   * The position is being estimated from the room rather than read off the
   * audio clock.
   *
   * Two things follow, and they always follow together. The marker is hidden,
   * because an estimate good to a section would be claiming note-level precision
   * by drawing a hairline. And the page re-centres only once the playhead has
   * drifted out of the middle of the view, because a live estimate jitters by a
   * fraction of a second either way and scrolling on every change turns that
   * jitter into constant motion under the reader's eyes.
   */
  fromLiveEstimate?: boolean;
}

/** The box the reader is actually looking at, so the dead band is measured
 *  against it. Below the `md` breakpoint the sheet container stops scrolling and
 *  the document scrolls instead, so falling back to the document matters: with
 *  no fallback the dead band silently does nothing on a phone. */
function scrollViewOf(element: HTMLElement): HTMLElement | null {
  let node: HTMLElement | null = element.parentElement;
  while (node) {
    const overflowY = getComputedStyle(node).overflowY;
    if (
      (overflowY === 'auto' || overflowY === 'scroll') &&
      node.scrollHeight > node.clientHeight
    ) {
      return node;
    }
    node = node.parentElement;
  }
  const doc = document.scrollingElement as HTMLElement | null;
  return doc && doc.scrollHeight > doc.clientHeight ? doc : null;
}

/** Distance between consecutive rows of music, from the rendered position map.
 *  The dead band is expressed in rows rather than as a fraction of the view
 *  because rows are what the reader tracks, and how many fit on screen varies
 *  enormously: at 150% zoom a laptop shows about 3.6 rows of three bars each,
 *  while an iPhone shows about 3 rows of one bar each. */
function rowPitchOf(map: {y: number}[]): number | null {
  const tops = [...new Set(map.map(p => Math.round(p.y)))].sort(
    (a, b) => a - b,
  );
  if (tops.length < 3) return null;
  const gaps: number[] = [];
  for (let i = 1; i < tops.length; i++) {
    const gap = tops[i] - tops[i - 1];
    if (gap > 1) gaps.push(gap);
  }
  if (gaps.length === 0) return null;
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)];
}

/** How far from the centre the playhead may drift before the page re-centres.
 *  Half a row keeps the reader's eye in the middle row without the page moving
 *  for every wobble in the estimate. */
const DEAD_BAND_ROWS = 0.5;
/** Smooth scrolling needs time to finish; asking again mid-animation fights it. */
const MIN_SCROLL_INTERVAL_MS = 500;

export const Playhead = memo(function ({
  timePositionMap,
  getChartTimeSec,
  zoom,
  fromLiveEstimate = false,
}: PlayheadProps) {
  const playheadRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<number>(null);
  const lastYRef = useRef<number>(0);
  const lastScrollAtRef = useRef<number>(0);

  useEffect(() => {
    // Declared inside the effect so it closes over the current props without
    // becoming a dependency that re-creates the animation loop every render.
    const ensurePlayheadInView = () => {
      const playhead = playheadRef.current;
      if (!playhead) return;

      if (fromLiveEstimate) {
        const now = performance.now();
        if (now - lastScrollAtRef.current < MIN_SCROLL_INTERVAL_MS) return;

        const view = scrollViewOf(playhead);
        const rowPitch = rowPitchOf(timePositionMap);
        if (view && rowPitch) {
          const playheadBox = playhead.getBoundingClientRect();
          const viewBox = view.getBoundingClientRect();
          const offsetFromCentre =
            playheadBox.top +
            playheadBox.height / 2 -
            (viewBox.top + viewBox.height / 2);
          if (Math.abs(offsetFromCentre) < rowPitch * DEAD_BAND_ROWS) return;
        }
        lastScrollAtRef.current = now;
      }

      playhead.scrollIntoView({behavior: 'smooth', block: 'center'});
    };

    // Set up animation frame loop for smooth movement
    const animate = () => {
      const chartTimeSec = getChartTimeSec();
      if (chartTimeSec != null) {
        const currentTimeMs = chartTimeSec * 1000;
        // Find position for current time
        const newPosition = findPositionForTime(timePositionMap, currentTimeMs);
        if (newPosition && playheadRef.current) {
          // Directly manipulate the DOM style properties
          playheadRef.current.style.left = `${newPosition.x}px`;
          playheadRef.current.style.top = `${newPosition.y}px`;

          // Only check scrolling when Y actually changes (with a tiny threshold)
          const prevY = lastYRef.current;
          if (prevY == null || Math.abs(newPosition.y - prevY) > 0.5) {
            lastYRef.current = newPosition.y;
            ensurePlayheadInView();
          }
        }
      }
      animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [timePositionMap, getChartTimeSec, fromLiveEstimate]);

  return (
    <div
      ref={playheadRef}
      className={cn(
        'absolute pointer-events-auto cursor-pointer bg-primary z-20',
        fromLiveEstimate ? 'opacity-0' : '',
      )}
      style={{
        left: 0,
        top: 0,
        width: '2px',
        height: `${120 * zoom}px`, // Adjust based on your staff height
        transform: 'translateX(-50%)',
      }}>
      {/* Optional: Add a visual indicator at the top */}
      <div
        className="absolute top-0 left-1/2 transform -translate-x-1/2 w-3 h-3 bg-primary rounded-full"
        style={{marginTop: '-6px'}}
      />
    </div>
  );
});

Playhead.displayName = 'Playhead';
