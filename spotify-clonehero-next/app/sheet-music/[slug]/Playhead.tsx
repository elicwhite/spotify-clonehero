import React, { useEffect, useRef, useState, memo } from 'react';
import { findPositionForTime } from './renderVexflow';

interface PlayheadProps {
  timePositionMap: Array<{ ms: number; x: number; y: number; flag: 'measure-start' | 'measure-end' | 'note' }>;
  audioManagerRef: React.RefObject<any>;
}

export const Playhead = memo(function ({
  timePositionMap,
  audioManagerRef,
}: PlayheadProps) {
  console.log('timePositionMap', timePositionMap);
  const playheadRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<number>(null);

  window.findPos = (time: number) => {
    return findPositionForTime(timePositionMap, time);
  }
  window.audioRef = audioManagerRef;

  useEffect(() => {
    // Set up animation frame loop for smooth movement
    const animate = () => {
      if (audioManagerRef.current != null) {
        try {
          // Get current time directly from audio manager
          const currentTimeMs = audioManagerRef.current.currentTime * 1000;
          // Find position for current time
          const newPosition = findPositionForTime(timePositionMap, currentTimeMs);
          if (newPosition && playheadRef.current) {
            // Directly manipulate the DOM style properties
            playheadRef.current.style.left = `${newPosition.x}px`;
            playheadRef.current.style.top = `${newPosition.y}px`;
          }
        } catch (error) {
          // Audio manager might not be ready yet
          console.debug('Audio manager not ready for playhead update:', error);
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
      className="absolute pointer-events-auto cursor-pointer bg-primary"
      style={{
        left: 0,
        top: 0,
        width: '2px',
        height: '120px', // Adjust based on your staff height
        zIndex: 1000,
        transform: 'translateX(-50%)',
      }}
    >
      {/* Optional: Add a visual indicator at the top */}
      <div
        className="absolute top-0 left-1/2 transform -translate-x-1/2 w-3 h-3 bg-primary rounded-full"
        style={{ marginTop: '-6px' }}
      />
    </div>
  );
});
