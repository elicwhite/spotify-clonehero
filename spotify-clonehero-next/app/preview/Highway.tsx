import React, {FC, useEffect, useRef, useState} from 'react';
import {ChartFile} from '@/lib/preview/chart';
import {HighwaySettings, setupRenderer} from '@/lib/preview/highway';
import styles from './Highway.module.css';

export const Highway: FC<{chart?: ChartFile; song: string}> = ({
  chart,
  song,
}) => {
  const [state, setState] = React.useState(0);

  const requestRef = React.useRef<number>();

  const animate = (time: number) => {
    requestRef.current = requestAnimationFrame(animate);

    // console.log("animate", time / 1000);
    setState(time / 1000);
  };

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
  }, []);

  return (
    <>
      <div
        className={styles.container}
        ref={ref}
        onClick={() => {
          if (!audioRef.current) return;

          audioRef.current.paused
            ? audioRef.current.play()
            : audioRef.current.pause();
        }}></div>
      <audio
        src={song}
        ref={audioRef}
        style={{
          position: 'absolute',
          zIndex: 1,
          top: 0,
          left: 0,
          width: '100vw',
        }}
        controls></audio>
      <input
        type="range"
        style={{
          position: 'absolute',
          zIndex: 1,
          top: '40px',
          left: 0,
          width: '100vw',
        }}
        step={0.01}
        min={1}
        max={5}
        onChange={e => {
          settingsRef.current.highwaySpeed = Number(e.target.value);
        }}></input>
      {/* <div className={styles.chart}>
        {chart?.expertSingle &&
          chart.expertSingle
            .slice(0, 100)
            .map(note => (
              <NoteRow
                style={{ bottom: `${(note.time! - state) * 400}px` }}
                note={note.fret}
              />
            ))}
      </div> */}
    </>
  );
};
