import React, {FC, useCallback, useEffect, useRef, useState} from 'react';
import {HighwaySettings, setupRenderer} from '@/lib/preview/highway';
import {ChartFile} from '@/lib/preview/interfaces';
import {ChartParser} from '@/lib/preview/chart-parser';
import {MidiParser} from '@/lib/preview/midi-parser';

export const Highway: FC<{
  chart?: ChartParser | MidiParser;
  audioFiles: File[];
}> = ({chart, audioFiles}) => {
  const sizingRef = useRef<HTMLDivElement>(null);
  const ref = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const playingPromise = useRef<Promise<any>>(Promise.resolve(undefined));

  const settingsRef = useRef<HighwaySettings>({
    highwaySpeed: 2,
  });

  useEffect(() => {
    if (!chart) return;

    const renderer = setupRenderer(
      chart,
      sizingRef,
      ref,
      audioRef,
      audioFiles,
      settingsRef.current,
    );

    return () => {
      renderer.destroy();
    };
  }, [audioFiles, chart]);

  return (
    <>
      <audio ref={audioRef} className="w-full" controls></audio>
      <input
        type="range"
        className="w-full"
        step={0.01}
        min={1}
        max={5}
        onChange={e => {
          settingsRef.current.highwaySpeed = Number(e.target.value);
        }}></input>
      <div
        className="relative flex-1"
        ref={sizingRef}
        onClick={() => {
          if (!audioRef.current) return;

          if (audioRef.current.paused) {
            playingPromise.current = playingPromise.current.then(() => {
              if (!audioRef.current) return;
              audioRef.current.play();
            });
          } else {
            playingPromise.current = playingPromise.current.then(() => {
              if (!audioRef.current) return;
              audioRef.current.pause();
            });
          }
        }}>
        <div className="absolute" ref={ref}></div>
      </div>
    </>
  );
};
