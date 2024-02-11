import {ChartResponseEncore} from '@/lib/chartSelection';
import Image from 'next/image';
import {
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

export const RENDERED_INSTRUMENTS = [
  'bass',
  'bassghl',
  'drums',
  'guitar',
  'guitarghl',
  'keys',
  'rhythm',
  'rhythmghl',
  'vocals',
] as const;

export type AllowedInstrument = (typeof RENDERED_INSTRUMENTS)[number];

export const InstrumentImage = memo(function InstrumentImage({
  instrument,
  classNames,
  onClick,
  size,
}: {
  instrument: AllowedInstrument;
  classNames?: string;
  onClick?: (instrument: AllowedInstrument) => void;
  size: 'sm' | 'md';
}) {
  const clickCallback = useCallback(() => {
    if (onClick) {
      onClick(instrument);
    }
  }, [instrument, onClick]);
  return (
    <Image
      className={`inline-block ${classNames}`}
      key={instrument}
      alt={`Icon for instrument ${instrument}`}
      src={`/assets/instruments/${instrument}.png`}
      width={size == 'sm' ? 16 : 32}
      height={size == 'sm' ? 16 : 32}
      onClick={clickCallback}
    />
  );
});

export function preFilterInstruments(chartData: ChartResponseEncore) {
  return Object.keys(chartData)
    .filter(
      key =>
        key.startsWith('diff_') &&
        (chartData[key as keyof ChartResponseEncore] as number) >= 0,
    )
    .map(key => ({
      [key.replace('diff_', '')]: chartData[
        key as keyof ChartResponseEncore
      ] as number,
    }))
    .reduce((a, b) => ({...a, ...b}), {});
}

export function ChartInstruments({
  instruments,
  onClick,
  size,
}: {
  instruments: ReturnType<typeof preFilterInstruments>;
  onClick?: (instrument: AllowedInstrument) => void;
  size: 'sm' | 'md';
}) {
  return (
    <div className="inline-flex gap-1 align-middle">
      {Object.keys(instruments)
        // @ts-ignore Don't know how to force TS to know
        .filter(instrument => RENDERED_INSTRUMENTS.includes(instrument))
        // @ts-ignore Don't know how to force TS to know
        .map((instrument: AllowedInstrument) => {
          return (
            <InstrumentImage
              size={size}
              instrument={instrument}
              key={instrument}
              onClick={onClick}
            />
          );
        })}
    </div>
  );
}
