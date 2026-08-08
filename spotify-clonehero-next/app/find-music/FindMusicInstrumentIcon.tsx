import {
  InstrumentImage,
  type AllowedInstrument,
} from '@/components/ChartInstruments';
import {cn} from '@/lib/utils';

import type {InstrumentId} from './types';

const ICON_BY_INSTRUMENT: Record<InstrumentId, AllowedInstrument> = {
  drums: 'drums',
  guitar: 'guitar',
  bass: 'bass',
  keys: 'keys',
  // The shared icon set has no separate Pro Drums asset. Keep the familiar
  // drums artwork and add a visible Pro marker so the filter stays distinct.
  proDrums: 'drums',
};

export default function FindMusicInstrumentIcon({
  instrument,
  size = 16,
  className,
}: {
  instrument: InstrumentId;
  size?: number;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center',
        className,
      )}
      aria-hidden="true">
      <InstrumentImage
        instrument={ICON_BY_INSTRUMENT[instrument]}
        size={size}
        alt={null}
      />
      {instrument === 'proDrums' ? (
        <span className="absolute -right-1 -top-1 rounded bg-background px-0.5 font-sans text-[7px] font-black leading-[9px] text-foreground shadow-sm ring-1 ring-border">
          P
        </span>
      ) : null}
    </span>
  );
}
