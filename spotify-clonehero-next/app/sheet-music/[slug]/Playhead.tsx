import React, {useEffect, useRef, memo} from 'react';
import {findPositionForTime} from './renderVexflow';

interface PlayheadProps {
  timePositionMap: Array<{
    ms: number;
    x: number;
    y: number;
    flag: 'measure-start' | 'measure-end' | 'note';
  }>;
  audioManagerRef: React.RefObject<any>;
  zoom: number;
}

export const Playhead = memo(function ({
  timePositionMap,
  audioManagerRef,
  zoom,
}: PlayheadProps) {
  const playheadRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<number>(null);
  const lastYRef = useRef<number>(0);

  function ensurePlayheadInView(y: number) {
    playheadRef.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
    });
  }

  useEffect(() => {
    // Set up animation frame loop for smooth movement
    const animate = () => {
      if (audioManagerRef.current != null) {
        // Get current time directly from audio manager
        const currentTimeMs = audioManagerRef.current.currentTime * 1000;
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
            ensurePlayheadInView(newPosition.y);
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
  }, [timePositionMap, audioManagerRef]);

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
