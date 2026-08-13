import {
  InstrumentImage,
  type AllowedInstrument,
} from '@/components/ChartInstruments';
import {cn} from '@/lib/utils';

import type {InstrumentId} from './types';

const ICON_BY_INSTRUMENT: Record<InstrumentId, AllowedInstrument> = {
  guitar: 'guitar',
  bass: 'bass',
  keys: 'keys',
  drums: 'drums',
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
    </span>
  );
}
