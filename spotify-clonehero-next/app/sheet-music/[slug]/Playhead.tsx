import {useEffect, useRef, memo} from 'react';
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
}

export const Playhead = memo(function ({
  timePositionMap,
  getChartTimeSec,
  zoom,
}: PlayheadProps) {
  const playheadRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<number>(null);
  const lastYRef = useRef<number>(0);

  function ensurePlayheadInView() {
    playheadRef.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
    });
  }

  useEffect(() => {
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
  }, [timePositionMap, getChartTimeSec]);

  return (
    <div
      ref={playheadRef}
      className="absolute pointer-events-auto cursor-pointer bg-primary z-20"
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
