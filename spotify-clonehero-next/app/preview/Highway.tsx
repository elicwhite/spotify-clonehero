import React, {FC, useCallback, useEffect, useRef, useState} from 'react';
import {HighwaySettings, setupRenderer} from '@/lib/preview/highway';
import {ChartFile} from '@/lib/preview/interfaces';

export const Highway: FC<{chart?: ChartFile; song: string}> = ({
  chart,
  song,
}) => {
  const requestRef = React.useRef<number>();

  const sizingRef = useRef<HTMLDivElement>(null);
  const ref = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  const settingsRef = useRef<HighwaySettings>({
    highwaySpeed: 2,
  });

  const [settings, setSettings] = useState<Awaited<
    ReturnType<typeof setupRenderer>
  > | null>(null);

  useEffect(() => {
    if (chart) {
      setupRenderer(chart, sizingRef, ref, audioRef, settingsRef.current).then(
        res => {
          setSettings(res);
        },
      );
      console.log('setup renderer');
    }
  }, [chart]);

  return (
    <>
      <audio src={song} ref={audioRef} className="w-full" controls></audio>
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

          audioRef.current.paused
            ? audioRef.current.play()
            : audioRef.current.pause();
        }}>
        <div className="absolute" ref={ref}></div>
      </div>
    </>
  );
};
