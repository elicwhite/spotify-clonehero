import {ChartInfo, ChartResponseEncore} from '@/lib/chartSelection';
import {memo, useCallback} from 'react';

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
  responsive,
  size,
}: {
  instrument: AllowedInstrument;
  classNames?: string;
  onClick?: (instrument: AllowedInstrument) => void;
  responsive?: boolean;
  size?: 'sm' | 'md' | 'lg';
}) {
  if (responsive != null && size != null) {
    throw new Error('responsive and size cannot be used together');
  }

  const clickCallback = useCallback(() => {
    if (onClick) {
      onClick(instrument);
    }
  }, [instrument, onClick]);
  return (
    <img
      className={`inline-block ${classNames}`}
      key={instrument}
      alt={`Icon for instrument ${instrument}`}
      src={`/assets/instruments/${instrument}.png`}
      width={size == 'sm' ? 16 : size == 'md' ? 32 : 64}
      height={size == 'sm' ? 16 : size == 'md' ? 32 : 64}
      onClick={clickCallback}
    />
  );
});

export function preFilterInstruments(chartData: ChartInfo) {
  return Object.keys(chartData)
    .filter(
      key =>
        key.startsWith('diff_') &&
        (chartData[key as keyof ChartInfo] as number) >= 0,
    )
    .map(key => ({
      [key.replace('diff_', '')]: chartData[key as keyof ChartInfo] as number,
    }))
    .reduce((a, b) => ({...a, ...b}), {});
}

export function ChartInstruments({
  instruments,
  onClick,
  size,
  classNames,
}: {
  instruments: ReturnType<typeof preFilterInstruments>;
  onClick?: (instrument: AllowedInstrument) => void;
  size: 'sm' | 'md' | 'lg';
  classNames?: string;
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
              classNames={classNames}
            />
          );
        })}
    </div>
  );
}
