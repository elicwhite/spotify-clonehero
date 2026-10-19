import {ChartInfo} from '@/lib/chartSelection';
import {cn} from '@/lib/utils';
import Image from 'next/image';
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
  alt,
}: {
  instrument: AllowedInstrument;
  classNames?: string | undefined;
  onClick?: ((instrument: AllowedInstrument) => void) | undefined;
  responsive?: boolean | undefined;
  /** Named scale, or an exact square pixel size for a call site that has to
   *  match neighbouring glyphs (the chart editor's icon tiles). */
  size?: 'sm' | 'md' | 'lg' | number | undefined;
  /** Accessible name for the glyph. `null` renders it DECORATIVELY (`alt=""`
   *  plus `aria-hidden`), for a call site whose adjacent visible text already
   *  carries the name. */
  alt?: string | null | undefined;
}) {
  if (responsive != null && size != null) {
    throw new Error('responsive and size cannot be used together');
  }

  const clickCallback = useCallback(() => {
    if (onClick) {
      onClick(instrument);
    }
  }, [instrument, onClick]);

  const dimension =
    typeof size === 'number'
      ? size
      : size == 'sm'
        ? 16
        : size == 'md'
          ? 32
          : 64;
  const decorative = alt === null;

  return (
    <Image
      className={cn('inline-block', classNames)}
      key={instrument}
      alt={decorative ? '' : (alt ?? `Icon for instrument ${instrument}`)}
      aria-hidden={decorative ? true : undefined}
      src={`/assets/instruments/${instrument}.png`}
      width={dimension}
      height={dimension}
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
