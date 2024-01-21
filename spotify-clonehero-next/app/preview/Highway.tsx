import React, {FC, useCallback, useEffect, useRef, useState} from 'react';
import {HighwaySettings, setupRenderer} from '@/lib/preview/highway';
import {ChartFile} from '@/lib/preview/interfaces';

export const Highway: FC<{chart?: ChartFile; song: string}> = ({
  chart,
  song,
}) => {
  const [state, setState] = React.useState(0);

  const requestRef = React.useRef<number>();

  const animate = useCallback((time: number) => {
    requestRef.current = requestAnimationFrame(animate);

    // console.log("animate", time / 1000);
    setState(time / 1000);
  }, []);

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
      setupRenderer(chart, ref, audioRef, settingsRef.current).then(res => {
        setSettings(res);
      });
      console.log('setup renderer');
    }
  }, [chart]);

  React.useEffect(() => {
    requestRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(requestRef.current!);
  }, [animate]);

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
        className="flex-1"
        ref={ref}
        onClick={() => {
          if (!audioRef.current) return;

          audioRef.current.paused
            ? audioRef.current.play()
            : audioRef.current.pause();
        }}></div>
    </>
  );
};
